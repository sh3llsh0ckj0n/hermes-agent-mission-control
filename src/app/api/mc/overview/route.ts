import { NextResponse } from "next/server";

import { summarizeProject, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

/** One read for dashboards: every project's normalized summary plus bus health. */
export async function GET() {
  return withMissionControl(async () => {
    const [projects, health, pendingRequests] = await Promise.all([
      prisma.mcProject.findMany({ orderBy: { id: "asc" } }),
      prisma.dataStore.findUnique({ where: { key: "hermes-health" } }),
      prisma.agentRequest.count({ where: { status: "awaiting_approval" } }),
    ]);
    const now = Date.now();
    const summaries = projects.map((project) => summarizeProject(project, now));
    return NextResponse.json(
      {
        generatedAt: new Date(now).toISOString(),
        projects: summaries,
        approvals: {
          requestsAwaiting: pendingRequests,
          projectApprovalsWaiting: summaries.reduce(
            (total, project) => total + (project.launch?.pending_approvals ?? 0),
            0,
          ),
        },
        reconciliation: {
          required: summaries.reduce((total, project) => total + project.reconciliation.required, 0),
          safeRepairs: summaries.reduce((total, project) => total + project.reconciliation.safeRepairs, 0),
        },
        health: health?.data ?? { online: false, gateway: "unknown", lastSeen: null },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
