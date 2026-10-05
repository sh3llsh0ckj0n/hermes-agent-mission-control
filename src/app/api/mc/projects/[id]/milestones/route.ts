import { NextResponse } from "next/server";

import { notFound, projectMilestones, validProjectId, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validProjectId(id)) return notFound("Project");
  return withMissionControl(async () => {
    const project = await prisma.mcProject.findUnique({ where: { id } });
    if (!project) return notFound("Project");
    return NextResponse.json({
      projectId: id,
      lastReconciledAt: project.lastReconciledAt?.toISOString() ?? null,
      milestones: projectMilestones(project),
    });
  });
}
