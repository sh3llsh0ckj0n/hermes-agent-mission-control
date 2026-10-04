import { createHash } from "node:crypto";

import { appendAuditEntries } from "./reconcile.mjs";

/**
 * Persist one reconciliation run into the Mission Control tables.
 *
 * Writes only current-state upserts (McProject, McTaskState, McReceipt,
 * McApproval) and append-only inserts (McReconciliation, McEvent) guarded by
 * ON CONFLICT DO NOTHING, so replaying the same run changes nothing. It never
 * deletes and never touches Kanban.
 */

export const MC_TABLES = Object.freeze([
  "McProject",
  "McTaskState",
  "McReceipt",
  "McReconciliation",
  "McApproval",
  "McEvent",
]);

function eventId(parts) {
  return `evt_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`;
}

/** True when the additive migration has been applied. */
export async function mcSchemaReady(query) {
  const { rows } = await query(
    `SELECT count(*)::int AS present FROM unnest($1::text[]) AS t(name)
     WHERE to_regclass(format('public.%I', t.name)) IS NOT NULL`,
    [MC_TABLES],
  );
  return rows[0]?.present === MC_TABLES.length;
}

/**
 * Replay-safe events derived from the difference between the previous stored
 * state and this run. Ids are deterministic in the fact they describe.
 */
export function buildEvents({ projectId, previousTasks, previousMilestones, run }) {
  const events = [];
  const occurredAt = run.reconciliation.reconciledAt;

  for (const receipt of run.receipts) {
    events.push({
      id: eventId(["receipt.created", receipt.id]),
      type: "receipt.created",
      subjectId: receipt.id,
      payload: { label: receipt.label, result: receipt.result, integrity: receipt.integrity },
    });
    if (receipt.integrity === "verified") {
      events.push({
        id: eventId(["receipt.verified", receipt.id]),
        type: "receipt.verified",
        subjectId: receipt.id,
        payload: { method: receipt.integrityMethod },
      });
    }
  }

  for (const task of run.reconciliation.tasks) {
    const before = previousTasks.get(task.taskId);
    if (before && before !== task.kanbanStatus) {
      events.push({
        id: eventId(["kanban.status_changed", task.taskId, before, task.kanbanStatus, occurredAt]),
        type: "kanban.status_changed",
        subjectId: task.taskId,
        payload: { from: before, to: task.kanbanStatus },
      });
    }
  }

  for (const item of run.reconciliation.required) {
    events.push({
      id: eventId(["reconciliation.required", item.id]),
      type: "reconciliation.required",
      subjectId: item.taskId ?? item.subject,
      payload: { itemId: item.id, type: item.type },
    });
  }

  for (const milestone of run.state.milestones) {
    const before = previousMilestones.get(milestone.id);
    if (before && before !== milestone.status) {
      events.push({
        id: eventId(["project.milestone_changed", projectId, milestone.id, before, milestone.status, occurredAt]),
        type: "project.milestone_changed",
        subjectId: `${projectId}/${milestone.id}`,
        payload: { from: before, to: milestone.status },
      });
    }
  }

  return events.map((event) => ({ ...event, projectId, occurredAt }));
}

export async function persistReconciliation({ query, run, mode }) {
  const { reconciliation, state, receipts, approvals, config } = run;
  const projectId = config.project_id;
  const at = reconciliation.reconciledAt;

  const { rows: previousRows } = await query(
    `SELECT id, "kanbanStatus" FROM "McTaskState" WHERE "projectId" = $1`,
    [projectId],
  );
  const { rows: projectRows } = await query(`SELECT state FROM "McProject" WHERE id = $1`, [projectId]);
  const previousTasks = new Map(previousRows.map((row) => [row.id, row.kanbanStatus]));
  const previousMilestones = new Map(
    (projectRows[0]?.state?.milestones ?? []).map((milestone) => [milestone.id, milestone.status]),
  );

  await query(
    `INSERT INTO "McProject" (id, name, boards, state, "reconcileMode", "lastReconciledAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, boards = EXCLUDED.boards, state = EXCLUDED.state,
       "reconcileMode" = EXCLUDED."reconcileMode", "lastReconciledAt" = EXCLUDED."lastReconciledAt", "updatedAt" = now()`,
    [projectId, config.name, config.boards, JSON.stringify(state), mode, at],
  );

  for (const task of reconciliation.tasks) {
    await query(
      `INSERT INTO "McTaskState" (id, "projectId", board, "kanbanId", "idempotencyKey", title, "kanbanStatus",
         "normalizedStatus", classification, "kanbanStale", evidence, reasons, "recommendedResolution",
         "reconciliationVersion", "reconciledAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (id) DO UPDATE SET "idempotencyKey" = EXCLUDED."idempotencyKey", title = EXCLUDED.title,
         "kanbanStatus" = EXCLUDED."kanbanStatus", "normalizedStatus" = EXCLUDED."normalizedStatus",
         classification = EXCLUDED.classification, "kanbanStale" = EXCLUDED."kanbanStale",
         evidence = EXCLUDED.evidence, reasons = EXCLUDED.reasons,
         "recommendedResolution" = EXCLUDED."recommendedResolution",
         "reconciliationVersion" = EXCLUDED."reconciliationVersion", "reconciledAt" = EXCLUDED."reconciledAt",
         "updatedAt" = now()
       WHERE "McTaskState"."projectId" = EXCLUDED."projectId"`,
      [
        task.taskId,
        projectId,
        task.board,
        task.kanbanId,
        task.idempotencyKey,
        String(task.title).slice(0, 300),
        task.kanbanStatus,
        task.normalizedStatus,
        task.classification,
        task.kanbanStale,
        JSON.stringify(task.evidence),
        JSON.stringify(task.reasons),
        task.recommendedResolution,
        reconciliation.reconciliationVersion,
        at,
      ],
    );
  }

  for (const receipt of receipts) {
    await query(
      `INSERT INTO "McReceipt" (id, "projectId", label, kind, paths, result, "rawResult", "qcVerdict", "finishedAt",
         "actionRequired", integrity, identity, "firstSeenAt", "lastSeenAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
       ON CONFLICT (id) DO UPDATE SET paths = EXCLUDED.paths, integrity = EXCLUDED.integrity, "lastSeenAt" = now()`,
      [
        receipt.id,
        projectId,
        receipt.label,
        receipt.kind,
        receipt.paths,
        receipt.result,
        receipt.rawResult ?? null,
        receipt.qcVerdict ?? null,
        receipt.finishedAt ?? null,
        Boolean(receipt.actionRequired),
        receipt.integrity,
        receipt.identity ? JSON.stringify(receipt.identity) : null,
      ],
    );
  }

  for (const approval of approvals) {
    await query(
      `INSERT INTO "McApproval" (id, "projectId", scope, "requestedAction", status, "packageId", "packageSha256",
         "packageMatches", approver, "decidedAt", "executionBoundary", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (id) DO UPDATE SET scope = EXCLUDED.scope, "requestedAction" = EXCLUDED."requestedAction",
         status = EXCLUDED.status, "packageId" = EXCLUDED."packageId", "packageSha256" = EXCLUDED."packageSha256",
         "packageMatches" = EXCLUDED."packageMatches", approver = EXCLUDED.approver,
         "decidedAt" = EXCLUDED."decidedAt", "executionBoundary" = EXCLUDED."executionBoundary", "updatedAt" = now()
       WHERE "McApproval"."projectId" = EXCLUDED."projectId"`,
      [
        approval.approval_id,
        projectId,
        approval.scope,
        approval.requested_action,
        approval.status,
        approval.package_id ?? null,
        approval.package_sha256 ?? null,
        approval.package_matches ?? null,
        approval.approver ?? null,
        approval.decided_at ?? null,
        approval.execution_boundary ?? null,
      ],
    );
  }

  const { added } = appendAuditEntries([], reconciliation, { mode, at });
  let ledgerInserted = 0;
  for (const entry of added) {
    const result = await query(
      `INSERT INTO "McReconciliation" (id, "intentId", mode, "projectId", "taskId", board, outcome, "oldStatus",
         "newStatus", reason, "authoritativeEvidenceId", "reconciliationVersion", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT ("intentId", mode) DO NOTHING`,
      [
        `${entry.intentId}:${entry.mode}`,
        entry.intentId,
        entry.mode,
        projectId,
        entry.taskId,
        entry.board,
        entry.outcome,
        entry.oldStatus,
        entry.newStatus,
        String(entry.reason).slice(0, 2_000),
        entry.authoritativeEvidenceId,
        entry.reconciliationVersion,
        at,
      ],
    );
    ledgerInserted += result?.rowCount ?? 0;
  }

  let eventsInserted = 0;
  for (const event of buildEvents({ projectId, previousTasks, previousMilestones, run })) {
    const result = await query(
      `INSERT INTO "McEvent" (id, type, "projectId", "subjectId", payload, "occurredAt")
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.type, event.projectId, event.subjectId, JSON.stringify(event.payload), event.occurredAt],
    );
    eventsInserted += result?.rowCount ?? 0;
  }

  return { tasks: reconciliation.tasks.length, receipts: receipts.length, ledgerInserted, eventsInserted };
}
