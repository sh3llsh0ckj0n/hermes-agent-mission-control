import { NextResponse } from "next/server";
import {
  resolveHermesTasksLastSync,
  withHermesServiceUnavailable,
} from "@/lib/hermes-service";
import { buildHermesRequestData } from "@/lib/hermes-request";
import { prisma } from "@/lib/prisma";

const MAX_TASK_TITLE_LENGTH = 200;

type AgentRequestData = ReturnType<typeof buildHermesRequestData>;
type CreateAgentRequest = (data: AgentRequestData) => Promise<unknown>;

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

export async function handleTaskCreateRequest(
  req: Request,
  createAgentRequest: CreateAgentRequest = (data) =>
    prisma.agentRequest.create({ data }),
) {
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (title.length > MAX_TASK_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `title must be ${MAX_TASK_TITLE_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const data = buildHermesRequestData({
    kind: "kanban.create",
    title,
  });
  const row = await createAgentRequest(data);

  return NextResponse.json({ request: row }, { status: 201 });
}

export async function POST(req: Request) {
  return withHermesServiceUnavailable(() => handleTaskCreateRequest(req));
}
