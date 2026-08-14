import { NextResponse } from "next/server";

import { buildHermesRequestData } from "@/lib/hermes-request";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import {
  isHermesBlockKind,
  isHermesTaskAction,
  isTaskActionAllowed,
  taskActionLabel,
  taskActionRequestKind,
  type HermesBlockKind,
  type HermesTaskAction,
} from "@/lib/hermes-task-actions";
import { prisma } from "@/lib/prisma";

type MirroredTask = { id: string; title: string; status: string };
type AgentRequestData = ReturnType<typeof buildHermesRequestData>;

type TaskActionDependencies = {
  findTask?: (id: string) => Promise<MirroredTask | null>;
  createAgentRequest?: (data: AgentRequestData) => Promise<unknown>;
};

type ParsedText = { value: string | null; error: string | null };

function parseOptionalText(value: unknown, label: string, maxLength: number): ParsedText {
  if (value === undefined || value === null || value === "") {
    return { value: null, error: null };
  }
  if (typeof value !== "string") {
    return { value: null, error: `${label} must be text` };
  }

  const normalized = value.trim();
  if (!normalized) return { value: null, error: null };
  if (normalized.includes("\0") || normalized.length > maxLength) {
    return { value: null, error: `${label} is invalid` };
  }
  return { value: normalized, error: null };
}

function parseTaskId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.startsWith("-") ||
    normalized.length > 500 ||
    normalized.includes("\0") ||
    /[\/\\\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function parseAction(value: unknown): HermesTaskAction | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isHermesTaskAction(normalized) ? normalized : null;
}

function parseBlockKind(value: unknown): { value: HermesBlockKind | null; error: string | null } {
  if (value === undefined || value === null || value === "") {
    return { value: null, error: null };
  }
  if (typeof value !== "string") {
    return { value: null, error: "blockKind is invalid" };
  }
  const normalized = value.trim().toLowerCase();
  if (!isHermesBlockKind(normalized)) {
    return { value: null, error: "blockKind is invalid" };
  }
  return { value: normalized, error: null };
}

function payloadForAction(
  action: HermesTaskAction,
  taskId: string,
  body: Record<string, unknown>,
): { payload?: Record<string, string>; error?: string } {
  const payload: Record<string, string> = { taskId };

  if (action === "complete") {
    const result = parseOptionalText(body.result, "result", 2_000);
    if (result.error) return { error: result.error };
    if (result.value) payload.result = result.value;
  }

  if (action === "block") {
    const reason = parseOptionalText(body.reason, "reason", 1_000);
    if (reason.error) return { error: reason.error };
    if (!reason.value) return { error: "reason required" };
    if (reason.value.startsWith("-")) return { error: "reason cannot be an option" };
    payload.reason = reason.value;

    const blockKind = parseBlockKind(body.blockKind);
    if (blockKind.error) return { error: blockKind.error };
    if (blockKind.value) payload.kind = blockKind.value;
  }

  if (action === "unblock" || action === "promote") {
    const reason = parseOptionalText(body.reason, "reason", 1_000);
    if (reason.error) return { error: reason.error };
    if (action === "promote" && reason.value?.startsWith("-")) {
      return { error: "reason cannot be an option" };
    }
    if (reason.value) payload.reason = reason.value;
  }

  return { payload };
}

export async function handleTaskActionRequest(
  req: Request,
  rawTaskId: unknown,
  dependencies: TaskActionDependencies = {},
) {
  const taskId = parseTaskId(rawTaskId);
  if (!taskId) {
    return NextResponse.json({ error: "invalid task ID" }, { status: 400 });
  }

  const rawBody = await req.json().catch(() => ({}));
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {};
  const action = parseAction(body.action);
  if (!action) {
    return NextResponse.json({ error: "unsupported task action" }, { status: 400 });
  }

  const findTask = dependencies.findTask ?? ((id: string) =>
    prisma.hermesTask.findUnique({
      where: { id },
      select: { id: true, title: true, status: true },
    }));
  const task = await findTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  if (!isTaskActionAllowed(task.status, action)) {
    return NextResponse.json(
      { error: `action ${action} is not allowed for task status ${task.status}` },
      { status: 409 },
    );
  }

  const parsedPayload = payloadForAction(action, task.id, body);
  if (!parsedPayload.payload) {
    return NextResponse.json({ error: parsedPayload.error }, { status: 400 });
  }

  const data = buildHermesRequestData({
    kind: taskActionRequestKind(action),
    title: `${taskActionLabel(action)} task: ${task.title}`.slice(0, 200),
    prompt: JSON.stringify(parsedPayload.payload),
  });
  const createAgentRequest = dependencies.createAgentRequest ?? ((requestData) =>
    prisma.agentRequest.create({ data: requestData }));
  const row = await createAgentRequest(data);

  return NextResponse.json({ request: row }, { status: 201 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withHermesServiceUnavailable(() => handleTaskActionRequest(req, id));
}
