import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  buildHermesCommand,
  requestIdempotencyKey,
} from "../lib/command-builder.mjs";
import {
  checkHermesCompatibility,
  runProcess,
  validateExecutable,
} from "../lib/process-runner.mjs";

test("user content remains a single argument and never becomes a shell command", () => {
  const prompt = "status; rm -rf / && echo unsafe";
  const command = buildHermesCommand({
    kind: "oneshot",
    title: "Inspect",
    prompt,
  });

  assert.deepEqual(command.args, ["-z", prompt]);
  assert.equal(command.args.length, 2);
});

test("Hermes executable validation rejects control characters", () => {
  assert.equal(validateExecutable("hermes"), "hermes");
  assert.throws(() => validateExecutable("hermes\n--unsafe"), /control/i);
  assert.throws(() => validateExecutable(""), /non-empty/i);
});

test("missing Hermes executable fails clearly without becoming retryable", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      const error = new Error("spawn hermes ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
    });
    return child;
  };

  await assert.rejects(
    runProcess("missing-hermes", ["--version"], { spawnImpl }),
    (error) =>
      error.category === "hermes_cli_failure" &&
      error.retryable === false &&
      /not found/i.test(error.message),
  );
});

test("process timeouts are classified without invoking a shell", async () => {
  let spawnOptions;
  const spawnImpl = (_executable, _args, options) => {
    spawnOptions = options;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    };
    return child;
  };

  await assert.rejects(
    runProcess("hermes", ["status"], {
      timeoutMs: 5,
      maxOutputBytes: 1024,
      spawnImpl,
    }),
    (error) => error.category === "timeout",
  );
  assert.equal(spawnOptions.shell, false);
});

test("CLI compatibility check accepts the exact Hermes Agent v0.20 output", async () => {
  const compatible = await checkHermesCompatibility({
    executable: "hermes",
    run: async () => ({
      stdout: "Hermes Agent v0.20.0 (2026.8.3)",
      stderr: "",
    }),
  });
  assert.equal(compatible, "0.20.0");
});

test("CLI compatibility check rejects malformed and out-of-range versions", async () => {
  for (const output of [
    "Hermes version unknown",
    "Hermes Agent v0.16.99",
    "Hermes Agent v0.21.0",
    "Hermes Agent v1.0.0",
  ]) {
    await assert.rejects(
      checkHermesCompatibility({
        executable: "hermes",
        run: async () => ({ stdout: output, stderr: "" }),
      }),
      /recognizable version|incompatible/i,
    );
  }
});

test("kanban create uses a deterministic request-derived idempotency key", () => {
  const request = {
    id: "request-kanban-001",
    kind: "kanban.create",
    title: "Ship release; echo not-a-command",
    prompt: "",
  };
  const first = buildHermesCommand(request, { board: "mission-control" });
  const second = buildHermesCommand(request, { board: "mission-control" });
  const key = requestIdempotencyKey(request.id);

  assert.deepEqual(first, second);
  assert.deepEqual(first.args, [
    "kanban",
    "--board",
    "mission-control",
    "create",
    "--json",
    "--idempotency-key",
    key,
    request.title,
  ]);
  assert.match(key, /^agent-request-[a-f0-9]{32}$/);
  assert.notEqual(key, requestIdempotencyKey("request-kanban-002"));
  assert.equal(first.args.at(-1), request.title);
});

test("invalid configured compatibility ranges fail before invoking Hermes", async () => {
  let invoked = false;
  await assert.rejects(
    checkHermesCompatibility({
      executable: "hermes",
      minimumVersion: "0.21.0",
      maximumVersionExclusive: "0.21.0",
      run: async () => {
        invoked = true;
        return { stdout: "Hermes Agent v0.20.0", stderr: "" };
      },
    }),
    /must be lower/i,
  );
  assert.equal(invoked, false);
});
