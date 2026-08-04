import fs from "node:fs";

import { ValidationError } from "./errors.mjs";

const TLS_MODES = new Set(["verify-full", "disable"]);

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function parseDatabaseTransport({
  databaseUrl,
  tlsMode,
  caFile,
  nodeEnv = "development",
  readFile = fs.readFileSync,
} = {}) {
  if (!databaseUrl) {
    throw new ValidationError(
      "DATABASE_URL is required and must be a direct PostgreSQL connection string",
    );
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new ValidationError("DATABASE_URL is not a valid URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new ValidationError(
      "DATABASE_URL must use postgres:// or postgresql://, not a proxy protocol",
    );
  }

  const local = isLoopback(parsed.hostname);
  const mode = tlsMode || (local ? "disable" : "verify-full");
  if (!TLS_MODES.has(mode)) {
    throw new ValidationError(
      "BRIDGE_DB_TLS_MODE must be verify-full or disable",
    );
  }
  if (nodeEnv === "production" && mode === "disable") {
    throw new ValidationError(
      "BRIDGE_DB_TLS_MODE=disable is forbidden when NODE_ENV=production",
    );
  }
  if (!local && mode === "disable" && !tlsMode) {
    throw new ValidationError(
      "Remote PostgreSQL requires verified TLS unless BRIDGE_DB_TLS_MODE=disable is explicitly set for development",
    );
  }

  if (mode === "disable") return { ssl: undefined, tlsMode: mode, local };

  const ssl = { rejectUnauthorized: true };
  if (caFile) {
    try {
      ssl.ca = readFile(caFile, "utf8");
    } catch {
      throw new ValidationError("BRIDGE_DB_CA_FILE could not be read");
    }
  }
  return { ssl, tlsMode: mode, local };
}
