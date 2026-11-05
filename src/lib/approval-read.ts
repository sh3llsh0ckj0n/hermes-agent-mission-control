import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  APPROVAL_ID_PATTERN,
  buildApprovalIndex,
  ledgerSnapshots,
  presentApproval,
  receiptIdsFromEvidence,
  taskMentionsApproval,
  type ApprovalIndexView,
  type ApprovalPackageView,
  type ApprovalReceiptInput,
  type ApprovalTaskView,
} from "@/lib/approval-view";

type TaskRow = {
  id: string;
  projectId: string;
  board: string;
  kanbanId: string;
  title: string;
  kanbanStatus: string;
  normalizedStatus: string;
  reasons: Prisma.JsonValue;
  evidence: Prisma.JsonValue;
};

type ReceiptRow = {
  id: string;
  projectId: string;
  label: string;
  result: string;
  integrity: string;
  finishedAt: Date | null;
  qcVerdict: string | null;
};

function evidenceReceipts(evidence: Prisma.JsonValue): ApprovalReceiptInput[] {
  if (!Array.isArray(evidence)) return [];
  const receipts: ApprovalReceiptInput[] = [];
  for (const item of evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.receiptId !== "string") continue;
    receipts.push({
      id: row.receiptId,
      label: typeof row.label === "string" ? row.label : "Receipt",
      result: typeof row.result === "string" ? row.result : "UNKNOWN",
      integrity: typeof row.integrity === "string" ? row.integrity : "unverified",
      finishedAt: typeof row.finishedAt === "string" ? row.finishedAt : null,
      qcVerdict: typeof row.qcVerdict === "string" ? row.qcVerdict : null,
    });
  }
  return receipts;
}

function presentRow(
  approval: {
    id: string;
    projectId: string;
    scope: string;
    requestedAction: string;
    status: string;
    packageId: string | null;
    packageSha256: string | null;
    packageMatches: boolean | null;
    approver: string | null;
    decidedAt: Date | null;
    executionBoundary: string | null;
    updatedAt: Date;
  },
  project: { name: string; state: Prisma.JsonValue; lastReconciledAt: Date | null } | undefined,
  tasks: TaskRow[],
  receipts: ReceiptRow[],
  now: number,
): ApprovalPackageView {
  const related = tasks.filter(
    (task) => task.projectId === approval.projectId && taskMentionsApproval(task.reasons, approval.id),
  );
  const taskViews: ApprovalTaskView[] = related.map((task) => ({
    id: task.id,
    title: task.title,
    board: task.board,
    kanbanId: task.kanbanId,
    kanbanStatus: task.kanbanStatus,
    normalizedStatus: task.normalizedStatus,
  }));
  const wanted = new Set(related.flatMap((task) => receiptIdsFromEvidence(task.evidence)));
  const mirrored = receipts.filter(
    (receipt) => receipt.projectId === approval.projectId && wanted.has(receipt.id.toLowerCase()),
  );
  const receiptViews: ApprovalReceiptInput[] =
    mirrored.length > 0
      ? mirrored.map((receipt) => ({
          id: receipt.id,
          label: receipt.label,
          result: receipt.result,
          integrity: receipt.integrity,
          finishedAt: receipt.finishedAt?.toISOString() ?? null,
          qcVerdict: receipt.qcVerdict,
        }))
      : related.flatMap((task) => evidenceReceipts(task.evidence)).filter((receipt) => wanted.has(receipt.id.toLowerCase()));

  return presentApproval(
    {
      id: approval.id,
      projectId: approval.projectId,
      projectName: project?.name ?? approval.projectId,
      scope: approval.scope,
      requestedAction: approval.requestedAction,
      status: approval.status,
      packageId: approval.packageId,
      packageSha256: approval.packageSha256,
      packageMatches: approval.packageMatches,
      approver: approval.approver,
      decidedAt: approval.decidedAt,
      executionBoundary: approval.executionBoundary,
      updatedAt: approval.updatedAt,
      lastReconciledAt: project?.lastReconciledAt ?? null,
      ledgerSnapshot: project ? ledgerSnapshots(project.state).get(approval.id) ?? null : null,
      tasks: taskViews,
      receipts: receiptViews,
    },
    now,
  );
}

async function loadRows() {
  const [projects, approvals, tasks, receipts] = await Promise.all([
    prisma.mcProject.findMany({ orderBy: { id: "asc" } }),
    prisma.mcApproval.findMany({ orderBy: [{ projectId: "asc" }, { id: "asc" }] }),
    prisma.mcTaskState.findMany({
      select: {
        id: true,
        projectId: true,
        board: true,
        kanbanId: true,
        title: true,
        kanbanStatus: true,
        normalizedStatus: true,
        reasons: true,
        evidence: true,
      },
    }),
    prisma.mcReceipt.findMany({
      select: {
        id: true,
        projectId: true,
        label: true,
        result: true,
        integrity: true,
        finishedAt: true,
        qcVerdict: true,
      },
    }),
  ]);
  return { projects, approvals, tasks, receipts };
}

export async function loadApprovalIndex(now = Date.now()): Promise<ApprovalIndexView> {
  const { projects, approvals, tasks, receipts } = await loadRows();
  const byProject = new Map(projects.map((project) => [project.id, project]));
  return buildApprovalIndex(
    approvals.map((approval) => presentRow(approval, byProject.get(approval.projectId), tasks, receipts, now)),
  );
}

export async function loadApprovalDetail(id: string, now = Date.now()): Promise<ApprovalPackageView | null> {
  if (!APPROVAL_ID_PATTERN.test(id)) return null;
  const { projects, approvals, tasks, receipts } = await loadRows();
  const approval = approvals.find((item) => item.id === id);
  if (!approval) return null;
  const project = projects.find((item) => item.id === approval.projectId);
  return presentRow(approval, project, tasks, receipts, now);
}
