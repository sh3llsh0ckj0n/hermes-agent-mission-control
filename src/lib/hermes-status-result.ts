export type HermesStatusResult = {
  model: string | null;
  provider: string | null;
  gateway: {
    status: string | null;
    running: boolean | null;
    manager: string | null;
  };
  terminal: {
    backend: string | null;
    sudoEnabled: boolean | null;
  };
  jobs: {
    active: number | null;
    total: number | null;
  };
  sessions: {
    active: number | null;
    lastActivity: string | null;
  };
  python: string | null;
  raw: string;
};

type ParsedSection =
  | "environment"
  | "terminal"
  | "gateway"
  | "jobs"
  | "sessions";

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const BOX_DRAWING = /[\u2500-\u257f]/g;

const SECTION_NAMES = new Map<string, ParsedSection>([
  ["environment", "environment"],
  ["terminal backend", "terminal"],
  ["gateway service", "gateway"],
  ["scheduled jobs", "jobs"],
  ["sessions", "sessions"],
]);

function cleanLine(line: string): string {
  return line.replace(ANSI_ESCAPE, "").replace(BOX_DRAWING, " ").trim();
}

function cleanHeading(line: string): string {
  return cleanLine(line)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cleanValue(value: string): string | null {
  const clean = value
    .trim()
    .replace(/^[✓✔✗✕×⚠●○]+\s*/u, "")
    .trim();
  return clean || null;
}

function parseGatewayRunning(status: string | null): boolean | null {
  if (!status) return null;
  if (/\b(?:not\s+running|stopped|offline)\b/i.test(status)) return false;
  if (/\b(?:running|online)\b/i.test(status)) return true;
  return null;
}

function parseEnabled(value: string | null): boolean | null {
  if (!value) return null;
  if (/\b(?:disabled|off|false|no)\b/i.test(value)) return false;
  if (/\b(?:enabled|on|true|yes)\b/i.test(value)) return true;
  return null;
}

function parseCount(value: string, pattern: RegExp): number | null {
  const match = value.match(pattern);
  if (!match) return null;
  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseHermesStatusResult(output: unknown): HermesStatusResult {
  const raw = typeof output === "string" ? output : String(output ?? "");
  const result: HermesStatusResult = {
    model: null,
    provider: null,
    gateway: { status: null, running: null, manager: null },
    terminal: { backend: null, sudoEnabled: null },
    jobs: { active: null, total: null },
    sessions: { active: null, lastActivity: null },
    python: null,
    raw,
  };

  let section: ParsedSection | null = null;

  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = cleanLine(sourceLine);
    if (!line) continue;

    if (!line.includes(":")) {
      section = SECTION_NAMES.get(cleanHeading(sourceLine)) ?? null;
      continue;
    }

    const separator = line.indexOf(":");
    const key = cleanHeading(line.slice(0, separator));
    const value = cleanValue(line.slice(separator + 1));

    if (section === "environment") {
      if (key === "model") result.model = value;
      if (key === "provider") result.provider = value;
      if (key === "python") result.python = value;
      continue;
    }

    if (section === "terminal") {
      if (key === "backend") result.terminal.backend = value;
      if (key === "sudo") result.terminal.sudoEnabled = parseEnabled(value);
      continue;
    }

    if (section === "gateway") {
      if (key === "status") {
        result.gateway.status = value;
        result.gateway.running = parseGatewayRunning(value);
      }
      if (key === "manager") result.gateway.manager = value;
      continue;
    }

    if (section === "jobs" && key === "jobs" && value) {
      result.jobs.active = parseCount(value, /^([\d,]+)\s+active\b/i);
      result.jobs.total = parseCount(value, /(?:^|,\s*)([\d,]+)\s+total\b/i);
      continue;
    }

    if (section === "sessions") {
      if (key === "active" && value) {
        result.sessions.active = parseCount(value, /^([\d,]+)\s+sessions?\b/i);
      }
      if (key === "last activity") result.sessions.lastActivity = value;
    }
  }

  return result;
}
