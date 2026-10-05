import assert from "node:assert/strict";
import test from "node:test";

import { handleTaskActionRequest } from "../src/app/api/hermes/tasks/[id]/action/route";
import { handleTaskListRequest } from "../src/app/api/hermes/tasks/route";
import { resolvePrimaryBoard, selectBoard } from "../src/lib/hermes-boards";

const RIGSPECS = "rigspecs-production-integrity";
const SYNCED = new Date("2026-10-05T04:00:00Z");

function mirrored(id: string, board: string, status = "ready") {
  return { id, board, title: `${board} ${id}`, assignee: null, status, priority: 0, result: null, updatedAt: SYNCED, syncedAt: SYNCED };
}

function reconciled(kanbanId: string, board: string, kanbanStatus = "blocked") {
  return {
    kanbanId,
    board,
    title: `${board} ${kanbanId}`,
    kanbanStatus,
    normalizedStatus: "BLOCKED",
    classification: "kanban_only",
    reconciledAt: SYNCED,
  };
}

/** A store holding the same task id on two boards, as Kanban allows. */
function store() {
  const queries: string[] = [];
  const hermesTask = [mirrored("t_same", "default"), mirrored("t_default_only", "default", "todo")];
  const mcTaskState = [reconciled("t_same", RIGSPECS), reconciled("t_rig_only", RIGSPECS), reconciled("t_same", "homelab-recovery")];
  return {
    queries,
    deps: {
      primaryBoard: "default",
      findPrimaryTasks: async (board: string) => {
        queries.push(`primary:${board}`);
        return hermesTask.filter((task) => task.board === board);
      },
      findSyncMarker: async () => ({ data: { board: "default", total: 2, syncedAt: SYNCED.toISOString() } }),
      findBoardTasks: async (board: string) => {
        queries.push(`board:${board}`);
        return mcTaskState.filter((task) => task.board === board);
      },
    },
  };
}

const list = (query = "") => new Request(`http://localhost/api/hermes/tasks${query}`);

test("primary board resolves from server config and fails closed to default", () => {
  assert.equal(resolvePrimaryBoard({}), "default");
  assert.equal(resolvePrimaryBoard({ HERMES_PRIMARY_BOARD: "Default" }), "default");
  assert.equal(resolvePrimaryBoard({ HERMES_PRIMARY_BOARD: "homelab-recovery" }), "homelab-recovery");
  assert.equal(resolvePrimaryBoard({ HERMES_PRIMARY_BOARD: "../etc" }), "default");
  assert.deepEqual(selectBoard(null, "default"), { kind: "primary", board: "default" });
  assert.deepEqual(selectBoard("", "default"), { kind: "primary", board: "default" });
  assert.deepEqual(selectBoard(RIGSPECS, "default"), { kind: "other", board: RIGSPECS });
  assert.deepEqual(selectBoard("bad board", "default"), { kind: "invalid" });
});

test("default task list stays scoped to the primary board (existing callers and PalmOS count)", async () => {
  const { deps, queries } = store();
  const response = await handleTaskListRequest(list(), deps);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(queries, ["primary:default"]);
  assert.equal(body.board, "default");
  assert.equal(body.actionable, true);
  // PalmOS reads exactly these two fields for its "Open tasks" figure.
  assert.equal(body.total, 2);
  assert.deepEqual(body.counts, { ready: 1, todo: 1 });
  assert.ok(body.tasks.every((task: { board: string }) => task.board === "default"));
  assert.equal(body.lastSync, SYNCED.toISOString());

  // Naming the primary board explicitly is the same scope.
  const explicit = await (await handleTaskListRequest(list("?board=default"), deps)).json();
  assert.deepEqual(explicit, body);
});

test("explicit board filter returns only that board, read-only", async () => {
  const { deps, queries } = store();
  const response = await handleTaskListRequest(list(`?board=${RIGSPECS}`), deps);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(queries, [`board:${RIGSPECS}`]);
  assert.equal(body.board, RIGSPECS);
  assert.equal(body.actionable, false);
  assert.deepEqual(body.tasks.map((task: { id: string }) => task.id).sort(), ["t_rig_only", "t_same"]);
  assert.ok(body.tasks.every((task: { board: string }) => task.board === RIGSPECS));

  const invalid = await handleTaskListRequest(list("?board=..%2Fx"), deps);
  assert.equal(invalid.status, 400);
});

test("identical task ids on different boards never mix", async () => {
  const { deps } = store();
  const primary = await (await handleTaskListRequest(list(), deps)).json();
  const rig = await (await handleTaskListRequest(list(`?board=${RIGSPECS}`), deps)).json();
  const homelab = await (await handleTaskListRequest(list("?board=homelab-recovery"), deps)).json();
  const same = (body: { tasks: Array<{ id: string; board: string }> }) => body.tasks.filter((task) => task.id === "t_same");
  assert.deepEqual(same(primary).map((task) => task.board), ["default"]);
  assert.deepEqual(same(rig).map((task) => task.board), [RIGSPECS]);
  assert.deepEqual(same(homelab).map((task) => task.board), ["homelab-recovery"]);
});

function actionDeps(task: { id: string; board: string; title: string; status: string } | null, primaryBoard = "default") {
  const created: Array<Record<string, unknown>> = [];
  let lookups = 0;
  return {
    created,
    lookups: () => lookups,
    value: {
      primaryBoard,
      findTask: async () => {
        lookups += 1;
        return task;
      },
      createAgentRequest: async (data: Record<string, unknown>) => {
        created.push(data);
        return { id: "request-1", ...data };
      },
    },
  };
}

const action = (body: unknown) =>
  new Request("http://localhost/api/hermes/tasks/t_same/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("actions on a non-primary-board task are rejected before anything is queued", async () => {
  // A stored row that belongs to another board (e.g. mirrored by an older bridge).
  const deps = actionDeps({ id: "t_same", board: RIGSPECS, title: "RigSpecs card", status: "ready" });
  const response = await handleTaskActionRequest(action({ action: "complete" }), "t_same", deps.value);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /primary board \(default\)/);
  assert.equal(deps.created.length, 0);
});

test("a client-named non-primary board is refused, never used to pick a board", async () => {
  const deps = actionDeps({ id: "t_same", board: "default", title: "Default card", status: "ready" });
  for (const board of [RIGSPECS, "homelab-recovery"]) {
    const response = await handleTaskActionRequest(action({ action: "complete", board }), "t_same", deps.value);
    assert.equal(response.status, 409, board);
  }
  const invalid = await handleTaskActionRequest(action({ action: "complete", board: "../x" }), "t_same", deps.value);
  assert.equal(invalid.status, 400);
  assert.equal(deps.lookups(), 0, "refused before the task lookup");
  assert.equal(deps.created.length, 0);
});

test("with the same id on two boards, an action targets the primary board and says so", async () => {
  const deps = actionDeps({ id: "t_same", board: "default", title: "Default card", status: "ready" });
  const response = await handleTaskActionRequest(action({ action: "complete", board: "default" }), "t_same", deps.value);
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(String(deps.created[0].prompt)), { taskId: "t_same", board: "default" });
});

test("a different configured primary board moves the boundary with it", async () => {
  const deps = actionDeps({ id: "t_same", board: "default", title: "Default card", status: "ready" }, RIGSPECS);
  const response = await handleTaskActionRequest(action({ action: "complete" }), "t_same", deps.value);
  assert.equal(response.status, 409);
  assert.equal(deps.created.length, 0);
});
