import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withHermesServiceUnavailable } from "@/lib/hermes-service";

/*
 * Mission Control normalized state, read side.
 *
 * The bridge computes and stores this state (reconciliation of Kanban against
 * execution receipts). These helpers only read and shape it; nothing here
 * re-derives task state or talks to Hermes.
 */

export const MC_SCHEMA_PENDING_CODE = "MC_SCHEMA_PENDING";
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Older than this, a project's reconciliation is reported as stale. */
export const RECONCILIATION_STALE_AFTER_MS = 30 * 60 * 1000;

export type AttentionSeverity = "critical" | "warning" | "info";

export interface ProjectAttention {
  id: string;
  severity: AttentionSeverity;
  title: string;
}

interface LaunchState {
  integrity_locked_current?: number | null;
  integrity_locked_target?: number | null;
  target_reached?: boolean;
  contained_products?: number | null;
  published_products?: number | null;
  promoted_catalog_count?: number | null;
  revenue_ready_count?: number | null;
  revenue_eligible_count?: number | null;
  batch_status?: string | null;
  indexing_status?: string | null;
  pending_approvals?: number;
  critical_blockers?: string[];
  metrics_as_of?: string | null;
}

interface MilestoneState {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

interface ProjectStateDocument {
  launch?: LaunchState;
  milestones?: MilestoneState[];
  reconciliation?: {
    counts?: Record<string, number>;
    required?: number;
    safeRepairs?: number;
    orphanReceipts?: number;
  };
}

export interface ProjectRow {
  id: string;
  name: string;
  boards: string[];
  state: unknown;
  reconcileMode: string;
  lastReconciledAt: Date | null;
}

function asState(value: unknown): ProjectStateDocument {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ProjectStateDocument) : {};
}

export function projectPath(id: string) {
  return `/hermes/projects/${encodeURIComponent(id)}`;
}

/** What needs a person, decided here so dashboards (PalmOS) never re-derive it. */
export function projectAttention(row: ProjectRow, now = Date.now()): ProjectAttention[] {
  const state = asState(row.state);
  const items: ProjectAttention[] = [];
  const reconciliation = state.reconciliation ?? {};

  for (const blocker of state.launch?.critical_blockers ?? []) {
    items.push({ id: `blocker:${blocker}`, severity: "critical", title: blocker });
  }
  if ((reconciliation.required ?? 0) > 0) {
    items.push({
      id: "reconciliation-required",
      severity: "warning",
      title: `${reconciliation.required} item${reconciliation.required === 1 ? "" : "s"} need reconciliation`,
    });
  }
  const pending = state.launch?.pending_approvals ?? 0;
  if (pending > 0) {
    items.push({ id: "approvals", severity: "warning", title: `${pending} approval${pending === 1 ? "" : "s"} waiting` });
  }
  const last = row.lastReconciledAt?.getTime();
  if (!last || now - last > RECONCILIATION_STALE_AFTER_MS) {
    items.push({
      id: "reconciliation-stale",
      severity: "warning",
      title: last ? "Reconciliation has not run recently" : "Reconciliation has not run yet",
    });
  }
  return items;
}

export function nextAutomaticAction(row: ProjectRow): string {
  switch (row.reconcileMode) {
    case "off":
      return "Reconciliation is off";
    case "apply":
      return "Reconcile and apply approved deterministic repairs";
    default:
      return "Preview reconciliation each bridge cycle; no Kanban writes";
  }
}

export function summarizeProject(row: ProjectRow, now = Date.now()) {
  const state = asState(row.state);
  const last = row.lastReconciledAt?.getTime() ?? null;
  return {
    id: row.id,
    name: row.name,
    boards: row.boards,
    path: projectPath(row.id),
    reconcileMode: row.reconcileMode,
    lastReconciledAt: row.lastReconciledAt?.toISOString() ?? null,
    reconciliationStale: last === null || now - last > RECONCILIATION_STALE_AFTER_MS,
    launch: state.launch ?? null,
    milestones: (state.milestones ?? []).map(({ id, name, status }) => ({ id, name, status })),
    reconciliation: {
      counts: state.reconciliation?.counts ?? {},
      required: state.reconciliation?.required ?? 0,
      safeRepairs: state.reconciliation?.safeRepairs ?? 0,
      orphanReceipts: state.reconciliation?.orphanReceipts ?? 0,
    },
    attention: projectAttention(row, now),
    nextAutomaticAction: nextAutomaticAction(row),
  };
}

export function projectMilestones(row: ProjectRow) {
  return asState(row.state).milestones ?? [];
}

export function isMissionControlSchemaPending(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

export function missionControlSchemaPendingResponse() {
  return NextResponse.json(
    { code: MC_SCHEMA_PENDING_CODE, error: "Mission Control state tables are not migrated yet" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/** Wrap a read so an unmigrated database answers 503 with a distinct code. */
export async function withMissionControl<T extends Response>(handler: () => Promise<T>) {
  return withHermesServiceUnavailable(async () => {
    try {
      return await handler();
    } catch (error) {
      if (isMissionControlSchemaPending(error)) return missionControlSchemaPendingResponse();
      throw error;
    }
  });
}

export function validProjectId(id: string | null | undefined): id is string {
  return typeof id === "string" && PROJECT_ID_PATTERN.test(id);
}

export function notFound(what: string) {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}
