import { ValidationError } from "./errors.mjs";
import { normalizeBoardSlug } from "./kanban-reader.mjs";
import { CLASSIFICATION, RECONCILIATION_VERSION } from "./reconcile.mjs";

/**
 * The eventual Kanban repair path, defined but NOT wired into the bridge.
 *
 * Nothing in this release executes these commands. They exist so the repair
 * contract can be reviewed and tested before any write authority is granted:
 *
 *  1. A repair is only ever a previously computed intent (stale_safe_repair).
 *  2. Immediately before executing, reconciliation is re-run on fresh state and
 *     must reproduce the identical intent id; otherwise the repair is refused.
 *  3. If the card already carries this intent id in its run metadata, the
 *     repair is a no-op (idempotent replay).
 *  4. Every mutation carries the reconciliation metadata: old/new status,
 *     reason, authoritative evidence id, timestamp, reconciliation version.
 *  5. Only the single transition blocked|todo|ready|review -> done exists.
 */

export const REPAIR_AUTHOR = "mission-control-reconciler";
const REPAIRABLE_FROM = new Set(["blocked", "todo", "triage", "ready", "review", "scheduled"]);

export function repairMetadata(intent, timestamp) {
  return {
    mc_reconciliation: {
      intent_id: intent.intentId,
      project_id: intent.projectId,
      task_id: intent.taskId,
      old_status: intent.oldStatus,
      new_status: intent.newStatus,
      reason: intent.reason,
      authoritative_evidence_id: intent.authoritativeEvidenceId,
      timestamp,
      reconciliation_version: intent.reconciliationVersion,
    },
  };
}

/**
 * Validate an intent against freshly recomputed reconciliation output.
 * Returns "execute", "already-applied", or throws with the refusal reason.
 */
export function verifyRepairPrecondition(intent, freshResult, { appliedIntentIds = new Set() } = {}) {
  if (intent.reconciliationVersion !== RECONCILIATION_VERSION) {
    throw new ValidationError("Intent was computed by a different reconciliation version");
  }
  if (appliedIntentIds.has(intent.intentId)) return "already-applied";

  const task = freshResult.tasks.find((candidate) => candidate.taskId === intent.taskId);
  if (task?.kanbanStatus === "done") return "already-applied";

  const fresh = freshResult.intents.find((candidate) => candidate.intentId === intent.intentId);
  if (!fresh || task?.classification !== CLASSIFICATION.STALE_SAFE_REPAIR) {
    throw new ValidationError("Fresh reconciliation no longer proposes this repair");
  }
  if (!REPAIRABLE_FROM.has(String(intent.oldStatus)) || intent.newStatus !== "done") {
    throw new ValidationError("Only a transition to done is a deterministic repair");
  }
  return "execute";
}

/**
 * Hermes CLI argument arrays for one repair: an explanatory comment, then the
 * completion carrying structured metadata on the closing run. History is only
 * appended to; nothing is edited or deleted.
 */
export function buildRepairCommands(intent, { timestamp }) {
  const board = normalizeBoardSlug(intent.board);
  const kanbanId = String(intent.kanbanId ?? "");
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(kanbanId)) throw new ValidationError("Invalid Kanban task id");
  const metadata = repairMetadata(intent, timestamp);
  const note =
    `[mission-control reconciliation ${intent.reconciliationVersion}] ` +
    `${intent.oldStatus} -> ${intent.newStatus}. ${intent.reason} ` +
    `Evidence: ${intent.authoritativeEvidenceId}. Intent: ${intent.intentId}.`;

  return [
    ["kanban", "--board", board, "comment", "--author", REPAIR_AUTHOR, kanbanId, note],
    [
      "kanban",
      "--board",
      board,
      "complete",
      "--result",
      `Reconciled from verified evidence ${intent.authoritativeEvidenceId}`,
      "--metadata",
      JSON.stringify(metadata),
      kanbanId,
    ],
  ];
}

/** Intent ids already applied, read from the cards' own run metadata. */
export function appliedIntentIdsFromRuns(runs) {
  const ids = new Set();
  for (const run of runs ?? []) {
    try {
      const metadata = typeof run.metadata === "string" ? JSON.parse(run.metadata) : run.metadata;
      const id = metadata?.mc_reconciliation?.intent_id;
      if (typeof id === "string") ids.add(id);
    } catch {
      // Unparseable metadata never counts as an applied repair.
    }
  }
  return ids;
}
