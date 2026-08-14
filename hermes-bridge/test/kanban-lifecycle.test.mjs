import assert from "node:assert/strict";
import test from "node:test";

import { buildHermesCommand } from "../lib/command-builder.mjs";
import { classifyRequestKind, deriveQueuedRequest } from "../lib/request-policy.mjs";

const BOARD = "mission-control";

function lifecycleRequest(kind, payload) {
  return {
    id: `request-${kind}`,
    kind,
    title: `Lifecycle ${kind}`,
    prompt: JSON.stringify(payload),
  };
}

test("all explicit kanban lifecycle kinds are local-write and approval-gated", () => {
  for (const action of ["complete", "block", "unblock", "promote", "archive"]) {
    const kind = `kanban.${action}`;
    const policy = classifyRequestKind(kind);
    const request = deriveQueuedRequest({ kind, title: action, sideEffecting: false });

    assert.equal(policy.risk, "local_write", kind);
    assert.equal(policy.requiresApproval, true, kind);
    assert.equal(request.sideEffecting, true, kind);
    assert.equal(request.status, "awaiting_approval", kind);
  }
});

test("kanban complete uses a fixed task ID and keeps result in one argument", () => {
  const result = "Done; echo remains data && not a shell command";
  const command = buildHermesCommand(
    lifecycleRequest("kanban.complete", { taskId: "task-1", result }),
    { board: BOARD },
  );

  assert.deepEqual(command.args, [
    "kanban", "--board", BOARD, "complete", "--result", result, "task-1",
  ]);
  assert.equal(command.timeoutMs, 20_000);
});

test("kanban block accepts only fixed kinds and keeps reason in one argument", () => {
  const reason = "Waiting for input; no shell interpretation";
  for (const kind of ["capability", "dependency", "needs_input", "transient"]) {
    const command = buildHermesCommand(
      lifecycleRequest("kanban.block", { taskId: "task-2", reason, kind }),
      { board: BOARD },
    );
    assert.deepEqual(command.args, [
      "kanban", "--board", BOARD, "block", "--kind", kind, "task-2", reason,
    ]);
  }

  assert.throws(
    () => buildHermesCommand(
      lifecycleRequest("kanban.block", {
        taskId: "task-2",
        reason,
        kind: "arbitrary --force",
      }),
      { board: BOARD },
    ),
    /block kind is invalid/i,
  );
  assert.throws(
    () => buildHermesCommand(
      lifecycleRequest("kanban.block", { taskId: "task-2", reason: "--ids" }),
      { board: BOARD },
    ),
    /cannot be an option/i,
  );
});

test("kanban unblock handles an optional bounded reason", () => {
  assert.deepEqual(
    buildHermesCommand(
      lifecycleRequest("kanban.unblock", { taskId: "task-3" }),
      { board: BOARD },
    ).args,
    ["kanban", "--board", BOARD, "unblock", "task-3"],
  );
  assert.deepEqual(
    buildHermesCommand(
      lifecycleRequest("kanban.unblock", { taskId: "task-3", reason: "Dependency cleared" }),
      { board: BOARD },
    ).args,
    ["kanban", "--board", BOARD, "unblock", "--reason", "Dependency cleared", "task-3"],
  );
});

test("kanban promote is JSON-only and can never add force", () => {
  const command = buildHermesCommand(
    lifecycleRequest("kanban.promote", {
      taskId: "task-4",
      reason: "Ready now",
      force: true,
      flags: ["--force"],
    }),
    { board: BOARD },
  );

  assert.deepEqual(command.args, [
    "kanban", "--board", BOARD, "promote", "--json", "task-4", "Ready now",
  ]);
  assert.equal(command.args.includes("--force"), false);
  assert.throws(
    () => buildHermesCommand(
      lifecycleRequest("kanban.promote", { taskId: "task-4", reason: "--force" }),
      { board: BOARD },
    ),
    /cannot be an option/i,
  );
});

test("kanban archive cannot produce permanent purge arguments", () => {
  const command = buildHermesCommand(
    lifecycleRequest("kanban.archive", {
      taskId: "task-5",
      rm: ["task-5"],
      purgeIds: ["task-5"],
    }),
    { board: BOARD },
  );

  assert.deepEqual(command.args, ["kanban", "--board", BOARD, "archive", "task-5"]);
  assert.equal(command.args.includes("--rm"), false);
  assert.throws(
    () => buildHermesCommand(
      lifecycleRequest("kanban.archive", { taskId: "--rm" }),
      { board: BOARD },
    ),
    /cannot be an option/i,
  );
});
