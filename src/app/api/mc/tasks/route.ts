import { NextResponse } from "next/server";

import { validProjectId, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

/** Normalized task state (receipt > run > Kanban), filterable by project, board, classification. */
export async function GET(req: Request) {
  return withMissionControl(async () => {
    const url = new URL(req.url);
    const project = url.searchParams.get("project");
    const board = url.searchParams.get("board");
    const classification = url.searchParams.get("classification");
    const where = {
      ...(validProjectId(project) ? { projectId: project } : {}),
      ...(board ? { board } : {}),
      ...(classification ? { classification } : {}),
    };
    const tasks = await prisma.mcTaskState.findMany({ where, orderBy: { id: "asc" }, take: 500 });
    const counts: Record<string, number> = {};
    for (const task of tasks) counts[task.classification] = (counts[task.classification] ?? 0) + 1;
    return NextResponse.json({ tasks, counts, total: tasks.length });
  });
}
