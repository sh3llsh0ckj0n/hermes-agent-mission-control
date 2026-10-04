import { createHash } from "node:crypto";

import { ValidationError } from "./errors.mjs";
import { parseQualifiedTaskId, qualifiedTaskId } from "./boards.mjs";

/**
 * Mission Control reconciliation engine.
 *
 * Pure and deterministic: the same snapshot, receipts, bindings and approvals
 * always produce the same verdicts and the same intent ids. It never performs
 * I/O and never mutates its inputs.
 *
 * Precedence: verified execution receipt > Mission Control run state > Kanban.
 * A Kanban label never overrides authoritative evidence, but evidence only
 * becomes authoritative for a task through explicit identity:
 *   embedded      — the receipt names the task itself (mc-receipt/v1)
 *   run-metadata  — the task's own Kanban run metadata names the receipt id
 *   approved-binding — a human-approved, git-tracked binding (hash-pinned)
 * Titles are never used for correlation.
 */

export const RECONCILIATION_VERSION = "mc-reconcile/1";
export const RECONCILE_MODES = Object.freeze(["off", "preview", "apply"]);

export const LIFECYCLE = Object.freeze({
  TODO: "TODO",
  READY: "READY",
  IN_PROGRESS: "IN_PROGRESS",
  REVIEW: "REVIEW",
  BLOCKED: "BLOCKED",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  DONE: "DONE",
  FAILED: "FAILED",
  ARCHIVED: "ARCHIVED",
  UNKNOWN: "UNKNOWN",
});

export const CLASSIFICATION = Object.freeze({
  CONSISTENT: "consistent",
  KANBAN_ONLY: "kanban_only",
  STALE_SAFE_REPAIR: "stale_safe_repair",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  WAITING_APPROVAL: "waiting_approval",
  ARCHIVED: "archived",
});

const AUTHORITATIVE_BASES = new Set(["embedded", "run-metadata", "approved-binding"]);
const CONTRADICTING_RUN_OUTCOMES = new Set([
  "blocked",
  "crashed",
  "timed_out",
  "gave_up",
  "spawn_failed",
  "failed",
]);
const ADVANCED_STATES = new Set([
  LIFECYCLE.READY,
  LIFECYCLE.IN_PROGRESS,
  LIFECYCLE.REVIEW,
  LIFECYCLE.DONE,
]);

export function resolveReconcileMode(value) {
  const mode = String(value ?? "").trim().toLowerCase() || "preview";
  if (!RECONCILE_MODES.includes(mode)) {
    throw new ValidationError(`RECONCILE_MODE must be one of ${RECONCILE_MODES.join(", ")}`);
  }
  return mode;
}

function digest(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export function repairIntentId({ taskId, fromStatus, toStatus, evidenceId }) {
  return `rec_${digest([RECONCILIATION_VERSION, "repair", taskId, fromStatus, toStatus, evidenceId])}`;
}

function requiredItemId(type, subject, evidenceIds) {
  return `rr_${digest([RECONCILIATION_VERSION, type, subject, [...evidenceIds].sort()])}`;
}

export function kanbanLifecycle(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "triage":
    case "todo":
    case "scheduled":
      return LIFECYCLE.TODO;
    case "ready":
      return LIFECYCLE.READY;
    case "running":
    case "claimed":
      return LIFECYCLE.IN_PROGRESS;
    case "review":
      return LIFECYCLE.REVIEW;
    case "blocked":
      return LIFECYCLE.BLOCKED;
    case "done":
      return LIFECYCLE.DONE;
    case "archived":
      return LIFECYCLE.ARCHIVED;
    default:
      return LIFECYCLE.UNKNOWN;
  }
}

function epochSecondsToIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Date(number * 1000).toISOString();
}

function parseMetadata(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Receipt ids a run's own metadata claims as its evidence. */
function runReceiptIds(run) {
  const metadata = parseMetadata(run.metadata);
  const ids = new Set();
  for (const candidate of [
    metadata?.receipt_id,
    metadata?.mc_identity?.receipt_id,
    ...(Array.isArray(metadata?.receipt_ids) ? metadata.receipt_ids : []),
  ]) {
    if (typeof candidate === "string" && candidate.startsWith("sha256:")) ids.add(candidate);
  }
  return ids;
}

function isGranted(approval, gate) {
  if (!approval || approval.status !== "granted") return false;
  // A changed package invalidates an approval bound to the old package hash.
  if (gate.package?.sha256 && approval.package_sha256 !== gate.package.sha256) return false;
  if (gate.package?.current_sha256 && approval.package_sha256 !== gate.package.current_sha256) {
    return false;
  }
  return true;
}

function summarizeReceipt(receipt, basis) {
  return {
    receiptId: receipt.id,
    label: receipt.label,
    basis,
    result: receipt.result,
    qcVerdict: receipt.qcVerdict ?? null,
    finishedAt: receipt.finishedAt ?? null,
    integrity: receipt.integrity,
    actionRequired: Boolean(receipt.actionRequired),
  };
}

function trustworthy(link) {
  // An approved binding pins the exact content hash a human reviewed.
  return link.receipt.integrity === "verified" || link.basis === "approved-binding";
}

/**
 * Index evidence links once for the whole project so that every receipt is
 * attributed to exactly the tasks its identity names — never more.
 */
function buildLinks({ projectId, boards, receipts, bindings }) {
  const receiptsById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const taskIds = new Set();
  for (const snapshot of boards) {
    for (const task of snapshot.tasks) taskIds.add(qualifiedTaskId(snapshot.board, task.id));
  }

  const links = new Map(); // taskId -> [{receipt, basis, bindingId?}]
  const linkedReceipts = new Set();
  const problems = [];
  const add = (taskId, receipt, basis, extra = {}) => {
    if (!links.has(taskId)) links.set(taskId, []);
    const list = links.get(taskId);
    if (!list.some((link) => link.receipt.id === receipt.id && link.basis === basis)) {
      list.push({ receipt, basis, ...extra });
    }
    linkedReceipts.add(receipt.id);
  };

  for (const receipt of receipts) {
    const identity = receipt.identity;
    if (!identity?.task_id) continue;
    if (identity.project_id && identity.project_id !== projectId) {
      problems.push({
        type: "receipt_project_mismatch",
        subject: receipt.id,
        receipts: [receipt.id],
        detail: `Receipt names project ${identity.project_id}, not ${projectId}`,
      });
      linkedReceipts.add(receipt.id);
      continue;
    }
    if (!taskIds.has(identity.task_id)) {
      problems.push({
        type: "receipt_unknown_task",
        subject: receipt.id,
        receipts: [receipt.id],
        detail: `Receipt names task ${identity.task_id}, which is not on an allowlisted board`,
      });
      linkedReceipts.add(receipt.id);
      continue;
    }
    add(identity.task_id, receipt, "embedded");
  }

  for (const snapshot of boards) {
    for (const run of snapshot.runs ?? []) {
      for (const receiptId of runReceiptIds(run)) {
        const receipt = receiptsById.get(receiptId);
        if (receipt) add(qualifiedTaskId(snapshot.board, run.task_id), receipt, "run-metadata", { runId: run.id });
      }
    }
  }

  for (const binding of bindings) {
    if (binding.status === "rejected") continue;
    const receipt = receiptsById.get(binding.receipt_id);
    if (!receipt) {
      // The bound bytes are gone or changed. A changed receipt is a new receipt;
      // the old binding must never transfer to it.
      problems.push({
        type: "binding_receipt_missing",
        subject: binding.receipt_id,
        receipts: [binding.receipt_id],
        detail: `Binding ${binding.id} names a receipt whose exact content was not found`,
      });
      continue;
    }
    if (!taskIds.has(binding.task_id)) {
      problems.push({
        type: "binding_unknown_task",
        subject: binding.receipt_id,
        receipts: [binding.receipt_id],
        detail: `Binding ${binding.id} names task ${binding.task_id}, which is not on an allowlisted board`,
      });
      linkedReceipts.add(receipt.id);
      continue;
    }
    if (receipt.identity?.task_id && receipt.identity.task_id !== binding.task_id) {
      problems.push({
        type: "binding_conflicts_with_receipt",
        subject: binding.task_id,
        receipts: [receipt.id],
        detail: `Binding ${binding.id} names ${binding.task_id} but the receipt names ${receipt.identity.task_id}`,
      });
      continue;
    }
    add(binding.task_id, receipt, binding.status === "approved" ? "approved-binding" : "proposed-binding", {
      bindingId: binding.id,
    });
  }

  return { links, linkedReceipts, problems };
}

function verdictForTask({ board, task, runs, links, gate, approval }) {
  const taskId = qualifiedTaskId(board, task.id);
  const kanbanStatus = String(task.status ?? "");
  const kanbanState = kanbanLifecycle(kanbanStatus);
  const gated = Boolean(gate);
  const approved = gated && isGranted(approval, gate);

  const base = {
    taskId,
    board,
    kanbanId: task.id,
    idempotencyKey: task.idempotency_key ?? null,
    title: task.title ?? "",
    kanbanStatus,
    blockKind: task.block_kind ?? null,
    approvalGate: gated
      ? {
          approvalId: gate.approval_id,
          status: approval?.status ?? "missing",
          granted: approved,
        }
      : null,
    evidence: links.map((link) => summarizeReceipt(link.receipt, link.basis)),
    reasons: [],
    recommendedResolution: null,
    kanbanStale: false,
  };
  const result = (normalizedStatus, classification, reasons, extra = {}) => ({
    ...base,
    normalizedStatus,
    classification,
    reasons,
    ...extra,
  });

  if (kanbanState === LIFECYCLE.ARCHIVED) {
    return result(LIFECYCLE.ARCHIVED, CLASSIFICATION.ARCHIVED, ["Archived on Kanban; history retained"]);
  }

  const authoritative = links.filter((link) => AUTHORITATIVE_BASES.has(link.basis));
  const proposed = links.filter((link) => link.basis === "proposed-binding");

  // Approval safety comes first: nothing advances a gated task without a
  // granted approval for the exact package, whatever Kanban or a receipt says.
  if (gated && !approved) {
    if (ADVANCED_STATES.has(kanbanState) || authoritative.some((link) => link.receipt.result === "PASS")) {
      return result(LIFECYCLE.WAITING_APPROVAL, CLASSIFICATION.RECONCILIATION_REQUIRED, [
        "Approval-gated task shows progress or completion without a granted approval for the current package",
      ], {
        recommendedResolution:
          "Record the approval decision (approver, time, package hash) or return the card to blocked; never advance it from Kanban alone",
      });
    }
    return result(LIFECYCLE.WAITING_APPROVAL, CLASSIFICATION.WAITING_APPROVAL, [
      `Waiting for approval ${gate.approval_id}`,
    ]);
  }

  if (!authoritative.length) {
    if (proposed.length) {
      const agrees =
        kanbanState === LIFECYCLE.DONE && proposed.every((link) => link.receipt.result === "PASS");
      if (agrees) {
        return result(LIFECYCLE.DONE, CLASSIFICATION.CONSISTENT, [
          "Kanban done; proposed evidence agrees (binding not yet approved)",
        ]);
      }
      return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
        "Only proposed (unapproved) evidence bindings exist and they do not agree with Kanban",
      ], { recommendedResolution: "Review and approve or reject the proposed binding" });
    }
    return result(kanbanState, CLASSIFICATION.KANBAN_ONLY, ["No linked execution evidence; Kanban is the only source"]);
  }

  const undated = authoritative.filter((link) => !link.receipt.finishedAt);
  if (undated.length) {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      "Evidence without a finish time cannot be ordered against other evidence",
    ], { recommendedResolution: "Add finished_at to the receipt source or review manually" });
  }

  const ordered = [...authoritative].sort(
    (a, b) => a.receipt.finishedAt.localeCompare(b.receipt.finishedAt) || a.receipt.id.localeCompare(b.receipt.id),
  );
  const newest = ordered[ordered.length - 1];
  const tied = ordered.filter(
    (link) => link.receipt.finishedAt === newest.receipt.finishedAt && link.receipt.result !== newest.receipt.result,
  );
  if (tied.length) {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      "Contradictory evidence finished at the same time",
    ], { recommendedResolution: "Decide which receipt reflects the final state" });
  }

  if (!trustworthy(newest)) {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      `Newest evidence integrity is ${newest.receipt.integrity}; it cannot be treated as authoritative`,
    ], { recommendedResolution: "Verify the receipt against its manifest or approve a hash-pinned binding" });
  }

  const receipt = newest.receipt;
  if (receipt.result === "FAIL") {
    if (kanbanState === LIFECYCLE.DONE) {
      return result(LIFECYCLE.FAILED, CLASSIFICATION.RECONCILIATION_REQUIRED, [
        "Kanban says done but the newest verified evidence failed",
      ], { recommendedResolution: "Reopen the card or supersede the failed receipt with a newer passing one" });
    }
    return result(LIFECYCLE.FAILED, CLASSIFICATION.CONSISTENT, ["Newest verified evidence failed; Kanban is not done"]);
  }

  if (receipt.result !== "PASS") {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      `Newest evidence result ${receipt.result} does not map to a Kanban lifecycle state`,
    ], { recommendedResolution: "Review the receipt and record the intended task state" });
  }

  if (receipt.qcVerdict && receipt.qcVerdict !== "PASS") {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      `Evidence passed but QC verdict is ${receipt.qcVerdict}`,
    ], { recommendedResolution: "Resolve the QC concerns before treating the task as complete" });
  }
  if (receipt.actionRequired) {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      "Evidence passed but records that a human action is still required",
    ], { recommendedResolution: "Complete the recorded action, then re-run reconciliation" });
  }

  const contradictingRuns = runs.filter(
    (run) =>
      CONTRADICTING_RUN_OUTCOMES.has(String(run.outcome ?? "").toLowerCase()) &&
      epochSecondsToIso(run.ended_at) &&
      epochSecondsToIso(run.ended_at) > receipt.finishedAt,
  );
  if (contradictingRuns.length) {
    return result(kanbanState, CLASSIFICATION.RECONCILIATION_REQUIRED, [
      `A Kanban run ended ${contradictingRuns.map((run) => run.outcome).join(", ")} after the passing evidence`,
    ], { recommendedResolution: "Newer contradictory evidence exists; decide which outcome is current" });
  }

  if (kanbanState === LIFECYCLE.DONE) {
    return result(LIFECYCLE.DONE, CLASSIFICATION.CONSISTENT, ["Kanban done; verified evidence agrees"]);
  }

  return result(LIFECYCLE.DONE, CLASSIFICATION.STALE_SAFE_REPAIR, [
    `Verified evidence ${receipt.id} (${receipt.finishedAt}) proves completion; Kanban still says ${kanbanStatus}`,
  ], {
    kanbanStale: true,
    authoritativeEvidenceId: receipt.id,
    recommendedResolution: `Mark ${taskId} done with reconciliation metadata`,
  });
}

/**
 * Reconcile every allowlisted board of one project.
 *
 * @param {object} input
 * @param {string} input.projectId
 * @param {Array<{board: string, tasks: object[], runs?: object[]}>} input.boards
 * @param {object[]} input.receipts From loadReceipts().
 * @param {object[]} [input.bindings] Git-tracked receipt↔task bindings.
 * @param {object[]} [input.gates] Approval gates: {task_id, approval_id, package?}.
 * @param {object[]} [input.approvals] Approval records.
 * @param {string} input.reconciledAt ISO timestamp, supplied so output is replayable.
 */
export function reconcileProject({
  projectId,
  boards,
  receipts,
  bindings = [],
  gates = [],
  approvals = [],
  reconciledAt,
}) {
  if (!projectId) throw new ValidationError("projectId is required");
  if (!reconciledAt) throw new ValidationError("reconciledAt is required");
  for (const binding of bindings) parseQualifiedTaskId(binding.task_id);

  const seenBoards = new Set();
  for (const snapshot of boards) {
    if (seenBoards.has(snapshot.board)) throw new ValidationError(`Board ${snapshot.board} supplied twice`);
    seenBoards.add(snapshot.board);
  }

  const { links, linkedReceipts, problems } = buildLinks({ projectId, boards, receipts, bindings });
  const gatesByTask = new Map(gates.map((gate) => [gate.task_id, gate]));
  const approvalsById = new Map(approvals.map((approval) => [approval.approval_id, approval]));

  const tasks = [];
  for (const snapshot of [...boards].sort((a, b) => a.board.localeCompare(b.board))) {
    const runsByTask = new Map();
    for (const run of snapshot.runs ?? []) {
      if (!runsByTask.has(run.task_id)) runsByTask.set(run.task_id, []);
      runsByTask.get(run.task_id).push(run);
    }
    for (const task of [...snapshot.tasks].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const taskId = qualifiedTaskId(snapshot.board, task.id);
      const gate = gatesByTask.get(taskId);
      tasks.push(
        verdictForTask({
          board: snapshot.board,
          task,
          runs: runsByTask.get(task.id) ?? [],
          links: links.get(taskId) ?? [],
          gate,
          approval: gate ? approvalsById.get(gate.approval_id) : null,
        }),
      );
    }
  }

  const intents = tasks
    .filter((task) => task.classification === CLASSIFICATION.STALE_SAFE_REPAIR)
    .map((task) => {
      const fromStatus = task.kanbanStatus;
      const toStatus = "done";
      return {
        intentId: repairIntentId({ taskId: task.taskId, fromStatus, toStatus, evidenceId: task.authoritativeEvidenceId }),
        projectId,
        taskId: task.taskId,
        board: task.board,
        kanbanId: task.kanbanId,
        oldStatus: fromStatus,
        newStatus: toStatus,
        reason: task.reasons[0],
        authoritativeEvidenceId: task.authoritativeEvidenceId,
        reconciliationVersion: RECONCILIATION_VERSION,
      };
    });

  const required = [];
  for (const task of tasks.filter((t) => t.classification === CLASSIFICATION.RECONCILIATION_REQUIRED)) {
    const evidenceIds = task.evidence.map((item) => item.receiptId);
    required.push({
      id: requiredItemId("task", task.taskId, evidenceIds),
      type: "task",
      status: "RECONCILIATION_REQUIRED",
      taskId: task.taskId,
      title: task.title,
      kanbanStatus: task.kanbanStatus,
      missionControlStatus: task.normalizedStatus,
      evidence: task.evidence,
      conflicts: task.reasons,
      recommendedResolution: task.recommendedResolution,
    });
  }
  for (const problem of problems) {
    required.push({
      id: requiredItemId(problem.type, problem.subject, problem.receipts),
      type: problem.type,
      status: "RECONCILIATION_REQUIRED",
      subject: problem.subject,
      evidence: problem.receipts,
      conflicts: [problem.detail],
      recommendedResolution: "Correct the binding or receipt identity; nothing is inferred automatically",
    });
  }
  const orphans = receipts.filter((receipt) => !linkedReceipts.has(receipt.id));
  for (const receipt of orphans) {
    required.push({
      id: requiredItemId("orphan_receipt", receipt.id, [receipt.id]),
      type: "orphan_receipt",
      status: "RECONCILIATION_REQUIRED",
      subject: receipt.id,
      evidence: [summarizeReceipt(receipt, "none")],
      conflicts: ["Receipt is not bound to any task by embedded identity, run metadata, or an approved binding"],
      recommendedResolution:
        "Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used",
    });
  }
  required.sort((a, b) => a.id.localeCompare(b.id));

  const counts = {};
  for (const task of tasks) counts[task.classification] = (counts[task.classification] ?? 0) + 1;

  return {
    projectId,
    reconciliationVersion: RECONCILIATION_VERSION,
    reconciledAt,
    boards: [...seenBoards].sort(),
    counts,
    tasks,
    intents,
    required,
    orphanReceipts: orphans.map((receipt) => receipt.id),
  };
}

/**
 * Append this run's outcomes to an audit ledger. Existing entries are never
 * modified or removed; an entry already present (same id and mode) is skipped,
 * so replaying the same reconciliation adds nothing.
 */
export function appendAuditEntries(ledger, result, { mode, at }) {
  const mode_ = resolveReconcileMode(mode);
  const existing = new Set(ledger.map((entry) => `${entry.intentId}:${entry.mode}`));
  const added = [];
  const push = (entry) => {
    const key = `${entry.intentId}:${entry.mode}`;
    if (existing.has(key)) return;
    existing.add(key);
    added.push(Object.freeze(entry));
  };

  for (const intent of result.intents) {
    push({
      intentId: intent.intentId,
      mode: mode_,
      projectId: result.projectId,
      taskId: intent.taskId,
      board: intent.board,
      outcome: mode_ === "apply" ? "repair_pending_execution" : "proposed_repair",
      oldStatus: intent.oldStatus,
      newStatus: intent.newStatus,
      reason: intent.reason,
      authoritativeEvidenceId: intent.authoritativeEvidenceId,
      reconciliationVersion: intent.reconciliationVersion,
      timestamp: at,
    });
  }
  for (const item of result.required) {
    push({
      intentId: item.id,
      mode: mode_,
      projectId: result.projectId,
      taskId: item.taskId ?? null,
      board: item.taskId ? parseQualifiedTaskId(item.taskId).board : null,
      outcome: "reconciliation_required",
      oldStatus: item.kanbanStatus ?? null,
      newStatus: null,
      reason: item.conflicts.join("; "),
      authoritativeEvidenceId: null,
      reconciliationVersion: result.reconciliationVersion,
      timestamp: at,
    });
  }

  return { ledger: [...ledger, ...added], added };
}
