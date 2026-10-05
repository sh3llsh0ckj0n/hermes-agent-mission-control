import { NextResponse } from "next/server";

import { validProjectId, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

/** The append-only reconciliation ledger plus everything currently awaiting a human decision. */
export async function GET(req: Request) {
  return withMissionControl(async () => {
    const url = new URL(req.url);
    const project = url.searchParams.get("project");
    const take = Math.min(Math.max(Number(url.searchParams.get("take")) || 100, 1), 500);
    const projectFilter = validProjectId(project) ? { projectId: project } : {};
    const [ledger, required, orphanReceipts] = await Promise.all([
      prisma.mcReconciliation.findMany({ where: projectFilter, orderBy: { createdAt: "desc" }, take }),
      prisma.mcTaskState.findMany({
        where: { ...projectFilter, classification: "reconciliation_required" },
        orderBy: { id: "asc" },
      }),
      prisma.mcReconciliation.findMany({
        where: { ...projectFilter, outcome: "reconciliation_required", taskId: null },
        orderBy: { createdAt: "desc" },
        take,
      }),
    ]);
    return NextResponse.json({ ledger, required, orphanReceipts });
  });
}
