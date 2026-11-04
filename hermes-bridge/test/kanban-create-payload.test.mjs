import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHermesCommand,
  KANBAN_CREATE_ASSIGNEES,
  requestIdempotencyKey,
} from "../lib/command-builder.mjs";

const BOARD = "mission-control";

function submitted(payload, overrides = {}) {
  return {
    id: "request-submit-001",
    kind: "kanban.create",
    title: "Investigate flaky reconcile job",
    prompt: JSON.stringify(payload),
    ...overrides,
  };
}

test("submitted tickets pass body and assignee and start blocked", () => {
  const request = submitted({
    board: BOARD,
    body: "--looks-like-a-flag\nsecond line",
    assignee: "atlas",
    initialStatus: "blocked",
    submitter: "codex",
  });
  const { args } = buildHermesCommand(request, { board: BOARD });
  assert.deepEqual(args, [
    "kanban",
    "--board",
    BOARD,
    "create",
    "--json",
    "--idempotency-key",
    requestIdempotencyKey(request.id),
    "--body=--looks-like-a-flag\nsecond line",
    "--assignee=atlas",
    "--initial-status",
    "blocked",
    request.title,
  ]);
});

test("body and assignee are optional in the payload", () => {
  const { args } = buildHermesCommand(
    submitted({ board: BOARD, initialStatus: "blocked" }),
    { board: BOARD },
  );
  assert.deepEqual(args.slice(7), ["--initial-status", "blocked", "Investigate flaky reconcile job"]);
});

test("dashboard and legacy kanban.create requests keep title-only behaviour", () => {
  for (const prompt of [null, "", "Plain text prompt from dispatch"]) {
    const { args } = buildHermesCommand(
      submitted({}, { prompt }),
      { board: BOARD },
    );
    assert.equal(args.length, 8, String(prompt));
    assert.equal(args.at(-1), "Investigate flaky reconcile job");
  }
});

test("payload values outside the allowlists are refused", () => {
  for (const payload of [
    { board: "other-board" },
    { assignee: "root" },
    { assignee: "atlas --priority 9" },
    { initialStatus: "running" },
    { initialStatus: "done" },
    { body: "x".repeat(4_001) },
    { body: "nul\u0000" },
    { body: 42 },
  ]) {
    assert.throws(
      () => buildHermesCommand(submitted(payload), { board: BOARD }),
      /board|assignee|initial status|body/i,
      JSON.stringify(payload).slice(0, 80),
    );
  }
  assert.throws(
    () => buildHermesCommand(submitted({}, { prompt: "{not json" }), { board: BOARD }),
    /JSON object/,
  );
});

test("bridge assignee allowlist is the submit-route allowlist", () => {
  // Keep in sync with TICKET_ASSIGNEES in src/lib/ticket-submit.ts
  // (tests/ticket-submit.test.ts asserts the same list on that side).
  assert.deepEqual([...KANBAN_CREATE_ASSIGNEES], ["atlas", "weaver", "amber", "claude", "artemis"]);
});
