import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleTaskActionRequest } from "../src/app/api/hermes/tasks/[id]/action/route";
import {
  isTaskActionAllowed,
  taskActionsForStatus,
} from "../src/lib/hermes-task-actions";

function actionRequest(body: unknown): Request {
  return new Request("http://localhost/api/hermes/tasks/task-1/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(task: { id: string; title: string; status: string } | null) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    value: {
      findTask: async () => task,
      createAgentRequest: async (data: Record<string, unknown>) => {
        created.push(data);
        return { id: "request-1", ...data };
      },
    },
  };
}

test("server maps lifecycle actions to approval-gated request kinds", async () => {
  const cases = [
    { action: "complete", status: "ready", body: { result: "Verified" } },
    { action: "block", status: "ready", body: { reason: "Needs input", blockKind: "needs_input" } },
    { action: "unblock", status: "blocked", body: { reason: "Input received" } },
    { action: "promote", status: "todo", body: { reason: "Ready" } },
    { action: "archive", status: "ready", body: {} },
  ] as const;

  for (const entry of cases) {
    const deps = dependencies({ id: "mirrored-task", title: "Mirrored title", status: entry.status });
    const response = await handleTaskActionRequest(
      actionRequest({ action: entry.action, ...entry.body }),
      "mirrored-task",
      deps.value,
    );

    assert.equal(response.status, 201, entry.action);
    assert.equal(deps.created.length, 1, entry.action);
    assert.equal(deps.created[0].kind, `kanban.${entry.action}`, entry.action);
    assert.equal(deps.created[0].status, "awaiting_approval", entry.action);
    assert.equal(deps.created[0].sideEffecting, true, entry.action);
    assert.equal(JSON.parse(String(deps.created[0].prompt)).taskId, "mirrored-task", entry.action);
  }
});

test("unknown actions fail before mirrored lookup or request creation", async () => {
  let findCalls = 0;
  let createCalls = 0;
  const response = await handleTaskActionRequest(
    actionRequest({ action: "purge" }),
    "task-1",
    {
      findTask: async () => {
        findCalls += 1;
        return null;
      },
      createAgentRequest: async () => {
        createCalls += 1;
        return {};
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(findCalls, 0);
  assert.equal(createCalls, 0);
});

test("option-shaped task IDs are rejected before mirrored lookup", async () => {
  let findCalls = 0;
  const response = await handleTaskActionRequest(
    actionRequest({ action: "archive" }),
    "--rm",
    {
      findTask: async () => {
        findCalls += 1;
        return null;
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(findCalls, 0);
});

test("missing mirrored task returns 404 without creating AgentRequest", async () => {
  const deps = dependencies(null);
  const response = await handleTaskActionRequest(
    actionRequest({ action: "archive" }),
    "missing-task",
    deps.value,
  );

  assert.equal(response.status, 404);
  assert.equal(deps.created.length, 0);
});

test("client fields cannot override mirrored identity or server policy", async () => {
  const deps = dependencies({ id: "trusted-task", title: "Trusted title", status: "ready" });
  await handleTaskActionRequest(
    actionRequest({
      action: "complete",
      result: "Done",
      taskId: "alternate-task",
      title: "Client title",
      kind: "diagnostic.status",
      risk: "read_only",
      sideEffecting: false,
      status: "queued",
      board: "attacker-board",
    }),
    "trusted-task",
    deps.value,
  );

  const created = deps.created[0];
  assert.ok(created);
  assert.equal(created.kind, "kanban.complete");
  assert.equal(created.title, "Complete task: Trusted title");
  assert.equal(created.sideEffecting, true);
  assert.equal(created.status, "awaiting_approval");
  assert.deepEqual(JSON.parse(String(created.prompt)), {
    taskId: "trusted-task",
    result: "Done",
  });
});

test("server rejects actions not allowed by mirrored task status", async () => {
  for (const status of ["running", "review", "blocked"]) {
    const deps = dependencies({ id: "task-1", title: "Task", status });
    const response = await handleTaskActionRequest(
      actionRequest({ action: "complete" }),
      "task-1",
      deps.value,
    );

    assert.equal(response.status, 409, status);
    assert.equal(deps.created.length, 0, status);
  }
});

test("block requires a reason and rejects unsupported block kinds", async () => {
  for (const body of [
    { action: "block", reason: "" },
    { action: "block", reason: "Wait", blockKind: "arbitrary" },
    { action: "block", reason: "--ids" },
    { action: "promote", reason: "--force" },
  ]) {
    const status = body.action === "promote" ? "todo" : "ready";
    const deps = dependencies({ id: "task-1", title: "Task", status });
    const response = await handleTaskActionRequest(actionRequest(body), "task-1", deps.value);
    assert.equal(response.status, 400);
    assert.equal(deps.created.length, 0);
  }
});

test("state/action controls are conservative and omit running or review", () => {
  assert.deepEqual(taskActionsForStatus("todo"), ["promote", "block", "archive"]);
  assert.deepEqual(taskActionsForStatus("ready"), ["complete", "block", "archive"]);
  assert.deepEqual(taskActionsForStatus("blocked"), ["unblock", "archive"]);
  assert.deepEqual(taskActionsForStatus("scheduled"), ["unblock", "archive"]);
  assert.deepEqual(taskActionsForStatus("running"), []);
  assert.deepEqual(taskActionsForStatus("review"), []);
  assert.equal(isTaskActionAllowed("ready", "complete"), true);
  assert.equal(isTaskActionAllowed("todo", "complete"), false);
});

const actionRouteSource = readFileSync(
  new URL("../src/app/api/hermes/tasks/[id]/action/route.ts", import.meta.url),
  "utf8",
);

test("action route creates only AgentRequest and never mutates HermesTask", () => {
  assert.match(actionRouteSource, /prisma\.hermesTask\.findUnique/);
  assert.match(actionRouteSource, /prisma\.agentRequest\.create/);
  assert.doesNotMatch(actionRouteSource, /prisma\.hermesTask\.(?:create|update|upsert|delete)/);
  assert.doesNotMatch(actionRouteSource, /\b(?:exec|spawn)\s*\(/);
});
