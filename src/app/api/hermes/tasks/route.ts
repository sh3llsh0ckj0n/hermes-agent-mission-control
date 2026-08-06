import { NextResponse } from "next/server";
import {
  resolveHermesTasksLastSync,
  withHermesServiceUnavailable,
} from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withHermesServiceUnavailable(async () => {
    const [tasks, syncMarker] = await Promise.all([
      prisma.hermesTask.findMany({
        orderBy: [{ status: "asc" }, { priority: "desc" }],
        take: 200,
      }),
      prisma.dataStore.findUnique({
        where: { key: "hermes-tasks" },
        select: { data: true },
      }),
    ]);
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    const lastSync = resolveHermesTasksLastSync(syncMarker?.data, tasks);
    return NextResponse.json({ tasks, counts, total: tasks.length, lastSync });
  });
}
