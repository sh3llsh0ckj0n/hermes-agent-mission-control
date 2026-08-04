const SAFE_MESSAGE_LIMIT = 600;

export class BridgeError extends Error {
  constructor(category, message, options = {}) {
    super(sanitizeErrorMessage(message), options);
    this.name = "BridgeError";
    this.category = category;
    this.retryable = Boolean(options.retryable);
  }
}

export class ValidationError extends BridgeError {
  constructor(message) {
    super("validation_failure", message, { retryable: false });
    this.name = "ValidationError";
  }
}

export class UnsafePathError extends BridgeError {
  constructor(message) {
    super("unsafe_path", message, { retryable: false });
    this.name = "UnsafePathError";
  }
}

export function sanitizeErrorMessage(value) {
  const firstLine = String(value || "Bridge operation failed").split(/\r?\n/, 1)[0];
  return firstLine
    .replace(/\bpostgres(?:ql)?:\/\/[^\s,;]+/gi, "[redacted-database-url]")
    .replace(
      /\b(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .slice(0, SAFE_MESSAGE_LIMIT);
}

export function classifyError(error) {
  if (error instanceof BridgeError) return error;
  const message = sanitizeErrorMessage(error?.message || error);
  if (error?.code && String(error.code).startsWith("PG")) {
    return new BridgeError("database_failure", message, { retryable: true });
  }
  return new BridgeError("unexpected_failure", message, { retryable: false });
}
