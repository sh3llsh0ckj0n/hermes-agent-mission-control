import { NextResponse } from "next/server";
import { resolvePrimaryBoard, selectBoard } from "@/lib/hermes-boards";
import {
  resolveHermesTasksLastSync,
  withHermesServiceUnavailable,
} from "@/lib/hermes-service";
import { withMissionControl } from "@/lib/mission-control";
import { buildHermesRequestData } from "@/lib/hermes-request";
import { prisma } from "@/lib/prisma";

const MAX_TASK_TITLE_LENGTH = 200;

type AgentRequestData = ReturnType<typeof buildHermesRequestData>;
type CreateAgentRequest = (data: AgentRequestData) => Promise<unknown>;

type MirroredTaskRow = {
  id: string;
  board: string;
  title: string;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
  updatedAt: Date;
  syncedAt: Date;
};

type ReconciledTaskRow = {
  kanbanId: string;
  board: string;
  title: string;
  kanbanStatus: string;
  normalizedStatus: string;
  classification: string;
  reconciledAt: Date;
};

type TaskListDependencies = {
  primaryBoard?: string;
  findPrimaryTasks?: (board: string) => Promise<MirroredTaskRow[]>;
  findSyncMarker?: () => Promise<{ data: unknown } | null>;
  findBoardTasks?: (board: string) => Promise<ReconciledTaskRow[]>;
};

function countByStatus(statuses: string[]) {
  const counts: Record<string, number> = {};
  for (const status of statuses) counts[status] = (counts[status] || 0) + 1;
  return counts;
}

/**
 * Task list for one board. Without `?board=` (or with the primary board) this
 * is the mirrored, actionable primary board — the scope every existing caller
 * (Tasks page, PalmOS) has always counted. Any other board is served read-only
 * from reconciliation state, keyed by board, so equal task ids on different
 * boards never mix.
 */
export async function handleTaskListRequest(req: Request, dependencies: TaskListDependencies = {}) {
  const primary = dependencies.primaryBoard ?? resolvePrimaryBoard();
  const selection = selectBoard(new URL(req.url).searchParams.get("board"), primary);
  if (selection.kind === "invalid") {
    return NextResponse.json({ error: "invalid board" }, { status: 400 });
  }

  if (selection.kind === "primary") {
    const findPrimaryTasks = dependencies.findPrimaryTasks ?? ((board: string) =>
      prisma.hermesTask.findMany({
        where: { board },
        orderBy: [{ status: "asc" }, { priority: "desc" }],
        take: 200,
      }));
    const findSyncMarker = dependencies.findSyncMarker ?? (() =>
      prisma.dataStore.findUnique({ where: { key: "hermes-tasks" }, select: { data: true } }));
    const [tasks, syncMarker] = await Promise.all([findPrimaryTasks(selection.board), findSyncMarker()]);
    const lastSync = resolveHermesTasksLastSync(syncMarker?.data, tasks);
    return NextResponse.json({
      board: selection.board,
      primaryBoard: primary,
      actionable: true,
      tasks,
      counts: countByStatus(tasks.map((task) => task.status)),
      total: tasks.length,
      lastSync,
    });
  }

  const findBoardTasks = dependencies.findBoardTasks ?? ((board: string) =>
    prisma.mcTaskState.findMany({
      where: { board },
      orderBy: { kanbanId: "asc" },
      take: 500,
      select: {
        kanbanId: true,
        board: true,
        title: true,
        kanbanStatus: true,
        normalizedStatus: true,
        classification: true,
        reconciledAt: true,
      },
    }));
  const rows = await findBoardTasks(selection.board);
  const tasks = rows
    .filter((row) => row.board === selection.board)
    .map((row) => ({
      id: row.kanbanId,
      board: row.board,
      title: row.title,
      assignee: null,
      status: row.kanbanStatus,
      priority: null,
      result: null,
      normalizedStatus: row.normalizedStatus,
      classification: row.classification,
    }));
  const lastSync = rows.reduce<string | null>((latest, row) => {
    const value = row.reconciledAt.toISOString();
    return !latest || value > latest ? value : latest;
  }, null);
  return NextResponse.json({
    board: selection.board,
    primaryBoard: primary,
    // Actions exist only for the primary board; other boards are read-only.
    actionable: false,
    tasks,
    counts: countByStatus(tasks.map((task) => task.status)),
    total: tasks.length,
    lastSync,
  });
}

export async function GET(req: Request) {
  return withMissionControl(() => handleTaskListRequest(req));
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
