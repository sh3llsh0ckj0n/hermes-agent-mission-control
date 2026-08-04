import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../lib/logger.mjs";
import { parseDatabaseTransport } from "../lib/tls.mjs";

test("remote PostgreSQL verifies certificates by default", () => {
  const result = parseDatabaseTransport({
    databaseUrl: "postgresql://user:password@db.example.invalid:5432/hermes",
  });
  assert.equal(result.tlsMode, "verify-full");
  assert.deepEqual(result.ssl, { rejectUnauthorized: true });
});

test("local TLS opt-out is explicit and production fails closed", () => {
  const local = parseDatabaseTransport({
    databaseUrl: "postgresql://user:password@127.0.0.1:5432/hermes",
  });
  assert.equal(local.tlsMode, "disable");
  assert.equal(local.ssl, undefined);

  const explicitDevelopmentOptOut = parseDatabaseTransport({
    databaseUrl: "postgresql://user:password@db.example.invalid/hermes",
    tlsMode: "disable",
    nodeEnv: "development",
  });
  assert.equal(explicitDevelopmentOptOut.tlsMode, "disable");

  assert.throws(
    () =>
      parseDatabaseTransport({
        databaseUrl: "postgresql://user:password@db.example.invalid/hermes",
        tlsMode: "disable",
        nodeEnv: "production",
      }),
    /forbidden/i,
  );
});

test("custom CA files are loaded without exposing connection data", () => {
  const result = parseDatabaseTransport({
    databaseUrl: "postgresql://user:password@db.example.invalid/hermes",
    caFile: "/secure/ca.pem",
    readFile: (file, encoding) => {
      assert.equal(file, "/secure/ca.pem");
      assert.equal(encoding, "utf8");
      return "TEST CA";
    },
  });
  assert.deepEqual(result.ssl, { rejectUnauthorized: true, ca: "TEST CA" });
});

test("structured logs include identity and redact secrets and database credentials", () => {
  const lines = [];
  const logger = createLogger({
    instanceId: "bridge-test",
    sink: (line) => lines.push(line),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });

  const record = logger("error", "database_failed", {
    requestId: "request-1",
    databaseUrl: "postgresql://user:password@db.example.invalid/hermes",
    error: "token=supersecret postgresql://user:password@db.example.invalid/hermes",
  });

  assert.equal(record.timestamp, "2026-01-02T03:04:05.000Z");
  assert.equal(record.bridgeInstanceId, "bridge-test");
  assert.equal(record.requestId, "request-1");
  assert.equal(record.databaseUrl, "[redacted]");
  assert.doesNotMatch(lines[0], /supersecret|user:password|db\.example\.invalid/);
});
