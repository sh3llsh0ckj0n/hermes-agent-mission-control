import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHermesRequestData,
  getHermesRequestPolicy,
  isUnknownHermesRequestKind,
} from "../src/lib/hermes-request";

test("Hermes request kinds receive server-owned risk classifications", () => {
  const matrix = {
    oneshot: "privileged",
    chat: "privileged",
    kanban: "local_write",
    "kanban.create": "local_write",
    "kanban.update": "local_write",
    "cron.create": "privileged",
    "cron.edit": "privileged",
    "cron.pause": "external_write",
    "cron.resume": "external_write",
    "cron.run": "privileged",
    "cron.remove": "destructive",
    "wiki.write": "local_write",
    "memory.write": "local_write",
    "memory.update": "local_write",
    "memory.remove": "destructive",
    "briefing.generate": "read_only",
  } as const;

  for (const [kind, expectedRisk] of Object.entries(matrix)) {
    const policy = getHermesRequestPolicy(kind);
    assert.equal(policy.risk, expectedRisk, kind);
    assert.equal(
      policy.requiresApproval,
      expectedRisk !== "read_only",
      `${kind} approval requirement`,
    );
  }
});

test("clients cannot downgrade side-effecting Hermes work", () => {
  const request = buildHermesRequestData({
    kind: "memory.write",
    title: "Write memory",
    prompt: "{}",
    sideEffecting: false,
  });

  assert.equal(request.sideEffecting, true);
  assert.equal(request.status, "awaiting_approval");

  const promptRequest = buildHermesRequestData({
    kind: "oneshot",
    title: "Please only read status",
    sideEffecting: false,
  });
  assert.equal(promptRequest.sideEffecting, true);
  assert.equal(promptRequest.status, "awaiting_approval");
});

test("unknown Hermes request kinds fail closed", () => {
  assert.throws(
    () =>
      buildHermesRequestData({
        kind: "future.superpower",
        title: "Unknown work",
        sideEffecting: false,
      }),
    (error) => isUnknownHermesRequestKind(error),
  );
});

test("only classified read-only requests enter the queue without approval", () => {
  const request = buildHermesRequestData({
    kind: "briefing.generate",
    title: "Generate brief",
  });

  assert.equal(request.sideEffecting, false);
  assert.equal(request.status, "queued");
});
