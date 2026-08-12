import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleTaskCreateRequest } from "../src/app/api/hermes/tasks/route";
import { getHermesRequestPolicy } from "../src/lib/hermes-request";

function taskRequest(body: unknown): Request {
  return new Request("http://localhost/api/hermes/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("valid task POST queues a server-classified kanban.create request", async () => {
  let createdData: Record<string, unknown> | null = null;
  const response = await handleTaskCreateRequest(
    taskRequest({ title: "  Verify Mission Control kanban  " }),
    async (data) => {
      createdData = data;
      return { id: "request-1", ...data };
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(createdData, {
    origin: "web",
    kind: "kanban.create",
    title: "Verify Mission Control kanban",
    prompt: null,
    sideEffecting: true,
    status: "awaiting_approval",
  });
  assert.equal((await response.json()).request.id, "request-1");
});

test("empty and whitespace-only task titles are rejected without a write", async () => {
  for (const title of ["", "   "]) {
    let createCalls = 0;
    const response = await handleTaskCreateRequest(taskRequest({ title }), async () => {
      createCalls += 1;
      return {};
    });

    assert.equal(response.status, 400);
    assert.equal(createCalls, 0);
  }
});

test("task titles over 200 characters are rejected", async () => {
  let createCalls = 0;
  const response = await handleTaskCreateRequest(
    taskRequest({ title: "x".repeat(201) }),
    async () => {
      createCalls += 1;
      return {};
    },
  );

  assert.equal(response.status, 400);
  assert.equal(createCalls, 0);
});

test("client risk and status fields cannot downgrade task creation", async () => {
  const createdRows: Array<Record<string, unknown>> = [];
  await handleTaskCreateRequest(
    taskRequest({
      title: "Approval required",
      kind: "diagnostic.status",
      sideEffecting: false,
      status: "queued",
      risk: "read_only",
    }),
    async (data) => {
      createdRows.push(data);
      return { id: "request-2", ...data };
    },
  );

  const createdData = createdRows[0];
  assert.ok(createdData);
  assert.equal(createdData.kind, "kanban.create");
  assert.equal(createdData.sideEffecting, true);
  assert.equal(createdData.status, "awaiting_approval");
  assert.equal("risk" in createdData, false);
});

test("kanban.create remains local-write and approval-required", () => {
  const policy = getHermesRequestPolicy("kanban.create");
  assert.equal(policy.risk, "local_write");
  assert.equal(policy.requiresApproval, true);
  assert.equal(policy.sideEffecting, true);
});

const taskRouteSource = readFileSync(
  new URL("../src/app/api/hermes/tasks/route.ts", import.meta.url),
  "utf8",
);

test("task GET still reads mirrored HermesTask rows and the synchronization marker", () => {
  const getSource = taskRouteSource.match(/export async function GET[\s\S]*?^}\r?$/m);
  assert.ok(getSource);
  assert.match(getSource[0], /prisma\.hermesTask\.findMany/);
  assert.match(getSource[0], /prisma\.dataStore\.findUnique/);
  assert.match(getSource[0], /resolveHermesTasksLastSync/);
});

test("task creation queues AgentRequest and never writes HermesTask directly", () => {
  const postSource = taskRouteSource.slice(taskRouteSource.indexOf("export async function handleTaskCreateRequest"));
  assert.match(postSource, /buildHermesRequestData/);
  assert.match(postSource, /prisma\.agentRequest\.create/);
  assert.doesNotMatch(postSource, /prisma\.hermesTask\.(?:create|update|upsert)/);
});
