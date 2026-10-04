import { NextResponse } from "next/server";

import { validProjectId, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  return withMissionControl(async () => {
    const project = new URL(req.url).searchParams.get("project");
    const receipts = await prisma.mcReceipt.findMany({
      where: validProjectId(project) ? { projectId: project } : {},
      orderBy: [{ finishedAt: "desc" }, { id: "asc" }],
      take: 500,
    });
    return NextResponse.json({ receipts });
  });
}
