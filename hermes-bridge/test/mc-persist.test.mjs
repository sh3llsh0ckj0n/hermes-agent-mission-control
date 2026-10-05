import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import { buildEvents, mcSchemaReady, persistReconciliation } from "../lib/mc-persist.mjs";
import { reconcileProject } from "../lib/reconcile.mjs";

const BOARD = "rigspecs-production-integrity";
const RECEIPT = `sha256:${"a".repeat(64)}`;

function fixtureRun({ kanbanStatus = "blocked", reconciledAt = "2026-10-03T00:00:00.000Z", bindings } = {}) {
  const receipts = [{
    id: RECEIPT,
    projectId: "mc-test",
    label: "fixture receipt",
    kind: "execution",
    paths: ["/evidence/r.md"],
    result: "PASS",
    rawResult: "PASS",
    qcVerdict: null,
    finishedAt: "2026-09-18T00:00:00.000Z",
    actionRequired: false,
    identity: null,
    integrity: "verified",
    integrityMethod: "sha256sums",
  }];
  const reconciliation = reconcileProject({
    projectId: "mc-test",
    boards: [{ board: BOARD, tasks: [{ id: "t_1", title: "fixture", status: kanbanStatus }, { id: "t_2", title: "other", status: "todo" }], runs: [] }],
    receipts,
    bindings: bindings ?? [{
      id: "b1",
      receipt_id: RECEIPT,
      task_id: `${BOARD}/t_1`,
      status: "approved",
      basis: "test",
      approved_by: "test",
      approved_at: "2026-10-03",
    }],
    reconciledAt,
  });
  return {
    config: { project_id: "mc-test", name: "MC Test", boards: [BOARD] },
    reconciliation,
    receipts,
    approvals: [{ approval_id: "mc-test-approval", scope: "s", requested_action: "a", status: "waiting" }],
    state: { milestones: [{ id: "m1", status: kanbanStatus === "done" ? "COMPLETE" : "IN_PROGRESS" }] },
  };
}

test("events are deterministic and only describe real changes", () => {
  const run = fixtureRun();
  const first = buildEvents({ projectId: "mc-test", previousTasks: new Map(), previousMilestones: new Map(), run });
  const again = buildEvents({ projectId: "mc-test", previousTasks: new Map(), previousMilestones: new Map(), run });
  assert.deepEqual(again, first);
  assert.ok(!first.some((event) => event.type === "kanban.status_changed"));
  const changed = buildEvents({
    projectId: "mc-test",
    previousTasks: new Map([[`${BOARD}/t_1`, "todo"]]),
    previousMilestones: new Map(),
    run,
  });
  assert.ok(changed.some((event) => event.type === "kanban.status_changed" && event.payload.from === "todo"));
});

test("persistence never deletes and never writes outside Mission Control tables", async () => {
  const statements = [];
  await persistReconciliation({
    query: async (text) => {
      statements.push(text);
      return { rows: [], rowCount: 1 };
    },
    run: fixtureRun(),
    mode: "preview",
  });
  assert.ok(!statements.some((text) => /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i.test(text)));
  for (const text of statements) {
    const tables = [...text.matchAll(/(?:INTO|FROM|UPDATE)\s+"(\w+)"/g)].map((match) => match[1]);
    for (const table of tables) assert.match(table, /^Mc/, text.slice(0, 60));
  }
  assert.ok(statements.filter((text) => /"McReconciliation"|"McEvent"/.test(text)).every((text) => /DO NOTHING/.test(text)));
});

// Runs only against a throwaway database with the migration applied, e.g.
// MC_TEST_DATABASE_URL=postgresql://hermes_bridge:...@127.0.0.1:54329/postgres
test("persisting against PostgreSQL is idempotent and append-only", { skip: !process.env.MC_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.MC_TEST_DATABASE_URL });
  const query = (text, params) => pool.query(text, params);
  try {
    assert.equal(await mcSchemaReady(query), true);

    const first = await persistReconciliation({ query, run: fixtureRun(), mode: "preview" });
    assert.ok(first.ledgerInserted >= 1);
    const replay = await persistReconciliation({ query, run: fixtureRun({ reconciledAt: "2026-10-03T00:05:00.000Z" }), mode: "preview" });
    assert.equal(replay.ledgerInserted, 0, "same intents are not re-recorded");

    const { rows: ledger } = await query(`SELECT "intentId", outcome, "oldStatus", "newStatus", "authoritativeEvidenceId" FROM "McReconciliation" WHERE "projectId"='mc-test'`);
    const repair = ledger.find((row) => row.outcome === "proposed_repair");
    assert.deepEqual(
      { from: repair.oldStatus, to: repair.newStatus, evidence: repair.authoritativeEvidenceId },
      { from: "blocked", to: "done", evidence: RECEIPT },
    );

    // Kanban later shows done: state updates, the earlier ledger row survives, an event is recorded.
    await persistReconciliation({ query, run: fixtureRun({ kanbanStatus: "done", reconciledAt: "2026-10-03T01:00:00.000Z" }), mode: "preview" });
    const { rows: [state] } = await query(`SELECT classification, "kanbanStatus" FROM "McTaskState" WHERE id=$1`, [`${BOARD}/t_1`]);
    assert.deepEqual(state, { classification: "consistent", kanbanStatus: "done" });
    const { rows: after } = await query(`SELECT count(*)::int AS n FROM "McReconciliation" WHERE "projectId"='mc-test'`);
    assert.equal(after[0].n, ledger.length);
    const { rows: events } = await query(`SELECT type FROM "McEvent" WHERE "projectId"='mc-test' AND type='kanban.status_changed'`);
    assert.equal(events.length, 1);

    await assert.rejects(query(`DELETE FROM "McReconciliation" WHERE "projectId"='mc-test'`), /permission denied|append-only/);
  } finally {
    await pool.end();
  }
});
