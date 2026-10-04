import { NextResponse } from "next/server";

import { validProjectId, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

/** Project approval records. Bridge execution requests stay at /api/hermes/requests. */
export async function GET(req: Request) {
  return withMissionControl(async () => {
    const url = new URL(req.url);
    const project = url.searchParams.get("project");
    const status = url.searchParams.get("status");
    const approvals = await prisma.mcApproval.findMany({
      where: {
        ...(validProjectId(project) ? { projectId: project } : {}),
        ...(status ? { status: { in: status.split(",") } } : {}),
      },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ approvals });
  });
}
