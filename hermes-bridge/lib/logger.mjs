const REDACTED = "[redacted]";
const SECRET_KEY = /(database.?url|password|passwd|secret|token|api.?key|authorization|credential)/i;

function redactString(value) {
  return value
    .replace(/\bpostgres(?:ql)?:\/\/[^\s,;]+/gi, "[redacted-database-url]")
    .replace(
      /\b(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    );
}

export function redactLogValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactString(value);
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? REDACTED : redactLogValue(item, seen);
  }
  return output;
}

export function createLogger({
  instanceId,
  sink = (line) => console.log(line),
  now = () => new Date(),
} = {}) {
  if (!instanceId) throw new Error("bridge instance ID is required for logging");

  return function log(level, event, data = {}) {
    const record = {
      timestamp: now().toISOString(),
      level,
      event,
      bridgeInstanceId: instanceId,
      ...redactLogValue(data),
    };
    sink(JSON.stringify(record));
    return record;
  };
}
