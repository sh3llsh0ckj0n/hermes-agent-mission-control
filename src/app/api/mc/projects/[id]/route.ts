import { NextResponse } from "next/server";

import { notFound, summarizeProject, validProjectId, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validProjectId(id)) return notFound("Project");
  return withMissionControl(async () => {
    const project = await prisma.mcProject.findUnique({ where: { id } });
    if (!project) return notFound("Project");
    const [approvals, required] = await Promise.all([
      prisma.mcApproval.findMany({ where: { projectId: id }, orderBy: { id: "asc" } }),
      prisma.mcTaskState.findMany({
        where: { projectId: id, classification: "reconciliation_required" },
        orderBy: { id: "asc" },
      }),
    ]);
    return NextResponse.json({ project: summarizeProject(project), state: project.state, approvals, required });
  });
}
