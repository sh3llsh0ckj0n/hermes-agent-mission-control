import { NextResponse } from "next/server";

import { summarizeProject, withMissionControl } from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withMissionControl(async () => {
    const projects = await prisma.mcProject.findMany({ orderBy: { id: "asc" } });
    const now = Date.now();
    return NextResponse.json({ projects: projects.map((project) => summarizeProject(project, now)) });
  });
}
