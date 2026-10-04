import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASSIFICATION,
  LIFECYCLE,
  RECONCILIATION_VERSION,
  appendAuditEntries,
  reconcileProject,
  resolveReconcileMode,
} from "../lib/reconcile.mjs";
import {
  appliedIntentIdsFromRuns,
  buildRepairCommands,
  verifyRepairPrecondition,
} from "../lib/repair-plan.mjs";

const BOARD = "rigspecs-production-integrity";
const AT = "2026-10-03T12:00:00.000Z";
const id = (hex) => `sha256:${hex.repeat(64).slice(0, 64)}`;

function receipt(overrides = {}) {
  return {
    id: id("a"),
    projectId: "rigspecs",
    label: "Approval B B2-B7 execution",
    kind: "execution",
    paths: ["/evidence/report.md"],
    result: "PASS",
    qcVerdict: null,
    finishedAt: "2026-09-18T23:21:00.000Z",
    actionRequired: false,
    identity: null,
    integrity: "verified",
    integrityMethod: "sha256sums",
    ...overrides,
  };
}

function task(overrides = {}) {
  return { id: "t_approvalb", title: "Approval B", status: "blocked", block_kind: "needs_input", ...overrides };
}

function binding(overrides = {}) {
  return {
    id: "bind-approval-b",
    receipt_id: id("a"),
    task_id: `${BOARD}/t_approvalb`,
    status: "approved",
    basis: "Jonathan confirmed this receipt executed this card",
    approved_by: "jonathan",
    approved_at: "2026-10-03T00:00:00Z",
    ...overrides,
  };
}

function run(input) {
  return reconcileProject({
    projectId: "rigspecs",
    boards: [{ board: BOARD, tasks: [task()], runs: [] }],
    receipts: [receipt()],
    bindings: [binding()],
    reconciledAt: AT,
    ...input,
  });
}

const verdict = (result, taskId = `${BOARD}/t_approvalb`) => result.tasks.find((entry) => entry.taskId === taskId);

test("verified completed receipt supersedes a stale BLOCKED Kanban card", () => {
  const result = run();
  const entry = verdict(result);
  assert.equal(entry.classification, CLASSIFICATION.STALE_SAFE_REPAIR);
  assert.equal(entry.normalizedStatus, LIFECYCLE.DONE);
  assert.equal(entry.kanbanStale, true);
  assert.equal(result.intents.length, 1);
  assert.deepEqual(
    {
      taskId: result.intents[0].taskId,
      oldStatus: result.intents[0].oldStatus,
      newStatus: result.intents[0].newStatus,
      evidence: result.intents[0].authoritativeEvidenceId,
      version: result.intents[0].reconciliationVersion,
    },
    { taskId: `${BOARD}/t_approvalb`, oldStatus: "blocked", newStatus: "done", evidence: id("a"), version: RECONCILIATION_VERSION },
  );
  assert.match(result.intents[0].intentId, /^rec_[0-9a-f]{32}$/);
});

test("newer contradictory evidence blocks automatic repair", () => {
  // A newer failed receipt for the same task.
  const failed = receipt({ id: id("b"), result: "FAIL", finishedAt: "2026-09-20T00:00:00.000Z" });
  const withFailure = run({
    receipts: [receipt(), failed],
    bindings: [binding(), binding({ id: "bind-2", receipt_id: id("b") })],
  });
  assert.equal(withFailure.intents.length, 0);
  assert.equal(verdict(withFailure).normalizedStatus, LIFECYCLE.FAILED);

  // A Kanban run that ended blocked after the passing receipt.
  const newerRun = run({
    boards: [{
      board: BOARD,
      tasks: [task()],
      runs: [{ id: 9, task_id: "t_approvalb", outcome: "blocked", ended_at: Date.parse("2026-09-25T00:00:00Z") / 1000 }],
    }],
  });
  assert.equal(newerRun.intents.length, 0);
  assert.equal(verdict(newerRun).classification, CLASSIFICATION.RECONCILIATION_REQUIRED);
  assert.match(verdict(newerRun).reasons[0], /after the passing evidence/);

  // A run that ended blocked BEFORE the receipt does not contradict it.
  const olderRun = run({
    boards: [{
      board: BOARD,
      tasks: [task()],
      runs: [{ id: 8, task_id: "t_approvalb", outcome: "blocked", ended_at: Date.parse("2026-09-10T00:00:00Z") / 1000 }],
    }],
  });
  assert.equal(olderRun.intents.length, 1);
});

test("a receipt cannot affect a task it is not bound to", () => {
  const result = run({
    boards: [{ board: BOARD, tasks: [task(), task({ id: "t_other", title: "Approval B" })], runs: [] }],
  });
  assert.equal(verdict(result, `${BOARD}/t_other`).classification, CLASSIFICATION.KANBAN_ONLY);
  assert.deepEqual(result.intents.map((intent) => intent.taskId), [`${BOARD}/t_approvalb`]);

  // Embedded identity naming a different task wins over nothing and never leaks.
  const embedded = run({
    boards: [{ board: BOARD, tasks: [task(), task({ id: "t_other" })], runs: [] }],
    receipts: [receipt({ identity: { project_id: "rigspecs", task_id: `${BOARD}/t_other` } })],
    bindings: [],
  });
  assert.deepEqual(embedded.intents.map((intent) => intent.taskId), [`${BOARD}/t_other`]);

  // A binding that contradicts the receipt's own identity is refused.
  const conflicting = run({
    boards: [{ board: BOARD, tasks: [task(), task({ id: "t_other" })], runs: [] }],
    receipts: [receipt({ identity: { project_id: "rigspecs", task_id: `${BOARD}/t_other` } })],
  });
  assert.ok(conflicting.required.some((item) => item.type === "binding_conflicts_with_receipt"));
  assert.ok(!conflicting.intents.some((intent) => intent.taskId === `${BOARD}/t_approvalb`));

  // A receipt from another project never binds.
  const foreign = run({
    receipts: [receipt({ identity: { project_id: "other", task_id: `${BOARD}/t_approvalb` } })],
    bindings: [],
  });
  assert.equal(foreign.intents.length, 0);
  assert.ok(foreign.required.some((item) => item.type === "receipt_project_mismatch"));
});

test("approval-gated task cannot advance without a granted approval", () => {
  const gates = [{ task_id: `${BOARD}/t_approvalb`, approval_id: "approval-b" }];
  const waiting = run({ gates, approvals: [{ approval_id: "approval-b", status: "waiting" }] });
  assert.equal(waiting.intents.length, 0);
  assert.equal(verdict(waiting).normalizedStatus, LIFECYCLE.WAITING_APPROVAL);
  assert.equal(verdict(waiting).classification, CLASSIFICATION.RECONCILIATION_REQUIRED);

  // Kanban flipping the card to ready never makes it executable.
  const flipped = run({
    gates,
    approvals: [{ approval_id: "approval-b", status: "waiting" }],
    boards: [{ board: BOARD, tasks: [task({ status: "ready" })], runs: [] }],
    receipts: [],
    bindings: [],
  });
  assert.equal(verdict(flipped).normalizedStatus, LIFECYCLE.WAITING_APPROVAL);
  assert.equal(verdict(flipped).classification, CLASSIFICATION.RECONCILIATION_REQUIRED);

  // Without any progress it is simply waiting, distinct from BLOCKED and FAILED.
  const idle = run({ gates, approvals: [{ approval_id: "approval-b", status: "waiting" }], receipts: [], bindings: [] });
  assert.equal(verdict(idle).classification, CLASSIFICATION.WAITING_APPROVAL);

  // A granted approval for a package that has since changed does not count.
  const changed = run({
    gates: [{ ...gates[0], package: { sha256: "1".repeat(64), current_sha256: "2".repeat(64) } }],
    approvals: [{ approval_id: "approval-b", status: "granted", package_sha256: "1".repeat(64), approver: "j", decided_at: AT }],
  });
  assert.equal(changed.intents.length, 0);

  // A granted approval for the unchanged package lets verified evidence repair.
  const granted = run({
    gates: [{ ...gates[0], package: { sha256: "1".repeat(64), current_sha256: "1".repeat(64) } }],
    approvals: [{ approval_id: "approval-b", status: "granted", package_sha256: "1".repeat(64), approver: "j", decided_at: AT }],
  });
  assert.equal(granted.intents.length, 1);
});

test("reconciliation is idempotent", () => {
  const first = run();
  const second = run();
  assert.deepEqual(second, first);

  // Once the repair has landed, the same evidence finds nothing to do.
  const repaired = run({ boards: [{ board: BOARD, tasks: [task({ status: "done" })], runs: [] }] });
  assert.equal(repaired.intents.length, 0);
  assert.equal(verdict(repaired).classification, CLASSIFICATION.CONSISTENT);
});

test("processing the same receipt twice causes no duplicate action", () => {
  const duplicated = run({
    receipts: [receipt(), receipt({ paths: ["/evidence/copy.md"] })],
    bindings: [binding(), binding({ id: "bind-dup" })],
  });
  assert.equal(duplicated.intents.length, 1);
  assert.equal(verdict(duplicated).evidence.length, 1);

  const first = appendAuditEntries([], duplicated, { mode: "preview", at: AT });
  const replay = appendAuditEntries(first.ledger, duplicated, { mode: "preview", at: "2026-10-04T00:00:00Z" });
  assert.equal(replay.added.length, 0);
  assert.equal(replay.ledger.length, first.ledger.length);

  // Repair execution is a no-op once the card carries this intent id.
  const intent = duplicated.intents[0];
  const applied = appliedIntentIdsFromRuns([
    { metadata: JSON.stringify({ mc_reconciliation: { intent_id: intent.intentId } }) },
  ]);
  assert.equal(verifyRepairPrecondition(intent, duplicated, { appliedIntentIds: applied }), "already-applied");
});

test("audit history is preserved and every entry carries reconciliation metadata", () => {
  const prior = [Object.freeze({ intentId: "rec_old", mode: "preview", outcome: "proposed_repair", timestamp: "2026-09-01T00:00:00Z" })];
  const result = run();
  const { ledger, added } = appendAuditEntries(prior, result, { mode: "preview", at: AT });
  assert.equal(ledger[0], prior[0]);
  assert.equal(ledger.length, prior.length + added.length);
  const entry = added.find((candidate) => candidate.outcome === "proposed_repair");
  for (const field of ["oldStatus", "newStatus", "reason", "authoritativeEvidenceId", "timestamp", "reconciliationVersion"]) {
    assert.ok(entry[field], `${field} recorded`);
  }
  assert.ok(Object.isFrozen(entry));

  // Repair commands append a comment and carry the same metadata on the closing run.
  const commands = buildRepairCommands(result.intents[0], { timestamp: AT });
  assert.deepEqual(commands[0].slice(0, 4), ["kanban", "--board", BOARD, "comment"]);
  assert.equal(commands[1][3], "complete");
  const metadata = JSON.parse(commands[1][commands[1].indexOf("--metadata") + 1]);
  assert.deepEqual(Object.keys(metadata.mc_reconciliation).sort(), [
    "authoritative_evidence_id",
    "intent_id",
    "new_status",
    "old_status",
    "project_id",
    "reason",
    "reconciliation_version",
    "task_id",
    "timestamp",
  ]);
  assert.ok(!commands.flat().some((arg) => /archive|delete|edit/.test(arg)));
});

test("an orphan receipt becomes RECONCILIATION_REQUIRED and is never title-matched", () => {
  const result = run({ bindings: [] });
  assert.equal(result.intents.length, 0);
  assert.deepEqual(result.orphanReceipts, [id("a")]);
  const orphan = result.required.find((item) => item.type === "orphan_receipt");
  assert.equal(orphan.status, "RECONCILIATION_REQUIRED");
  // The card titled "Approval B" is untouched despite the identical title.
  assert.equal(verdict(result).classification, CLASSIFICATION.KANBAN_ONLY);
});

test("multiple Kanban boards stay isolated", () => {
  const result = run({
    boards: [
      { board: BOARD, tasks: [task()], runs: [] },
      { board: "homelab-recovery", tasks: [task()], runs: [] },
    ],
  });
  assert.equal(verdict(result).classification, CLASSIFICATION.STALE_SAFE_REPAIR);
  assert.equal(verdict(result, "homelab-recovery/t_approvalb").classification, CLASSIFICATION.KANBAN_ONLY);
  assert.deepEqual(result.intents.map((intent) => intent.board), [BOARD]);

  // Run metadata on one board cannot claim a receipt for the same id on another.
  const crossRun = run({
    boards: [
      { board: BOARD, tasks: [task()], runs: [] },
      {
        board: "homelab-recovery",
        tasks: [task()],
        runs: [{ id: 1, task_id: "t_approvalb", outcome: "completed", metadata: JSON.stringify({ receipt_id: id("c") }) }],
      },
    ],
    receipts: [receipt(), receipt({ id: id("c"), label: "homelab receipt" })],
  });
  assert.equal(verdict(crossRun, "homelab-recovery/t_approvalb").evidence[0].receiptId, id("c"));
  assert.ok(!verdict(crossRun).evidence.some((item) => item.receiptId === id("c")));

  assert.throws(
    () => run({ boards: [{ board: BOARD, tasks: [], runs: [] }, { board: BOARD, tasks: [], runs: [] }] }),
    /supplied twice/,
  );
});

test("QC concerns, action-required and unverified integrity are never auto-repaired", () => {
  for (const overrides of [{ qcVerdict: "CONCERNS" }, { actionRequired: true }, { result: "UNKNOWN" }]) {
    const result = run({ receipts: [receipt(overrides)] });
    assert.equal(result.intents.length, 0, JSON.stringify(overrides));
    assert.equal(verdict(result).classification, CLASSIFICATION.RECONCILIATION_REQUIRED);
  }
  // Unverified bytes become authoritative only through an approved, hash-pinned binding.
  const unverified = receipt({ integrity: "unverified", identity: { project_id: "rigspecs", task_id: `${BOARD}/t_approvalb` } });
  assert.equal(run({ receipts: [unverified], bindings: [] }).intents.length, 0);
  assert.equal(run({ receipts: [receipt({ integrity: "unverified" })] }).intents.length, 1);
  // A proposed binding is never authoritative.
  assert.equal(run({ bindings: [binding({ status: "proposed" })] }).intents.length, 0);
});

test("a binding whose receipt bytes changed is flagged, not transferred", () => {
  const result = run({ receipts: [receipt({ id: id("d") })] });
  assert.equal(result.intents.length, 0);
  assert.ok(result.required.some((item) => item.type === "binding_receipt_missing"));
});

test("repair precondition refuses an intent fresh reconciliation no longer proposes", () => {
  const stale = run();
  const fresh = run({ receipts: [receipt({ qcVerdict: "CONCERNS" })] });
  assert.throws(() => verifyRepairPrecondition(stale.intents[0], fresh), /no longer proposes/);
  assert.equal(verifyRepairPrecondition(stale.intents[0], stale), "execute");
});

test("RECONCILE_MODE defaults to preview and rejects unknown modes", () => {
  assert.equal(resolveReconcileMode(undefined), "preview");
  assert.equal(resolveReconcileMode("OFF"), "off");
  assert.throws(() => resolveReconcileMode("auto"), /RECONCILE_MODE/);
});
