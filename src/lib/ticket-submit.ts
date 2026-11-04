/*
 * Submit-only ticket intake for an outside router (POST /api/hermes/submit).
 *
 * The caller can only *propose* a kanban ticket. Every submission becomes an
 * AgentRequest { kind: "kanban.create", status: "awaiting_approval" } on the
 * server-configured primary board; nothing runs until the owner approves it
 * in Mission Control. The caller cannot choose the kind, status, board, or
 * origin, and its token is refused on every other route (see route-policy).
 */
import { NextResponse } from "next/server";

import { resolvePrimaryBoard } from "@/lib/hermes-boards";
import { buildHermesRequestData } from "@/lib/hermes-request";
import { hasValidTicketSubmitToken, resolveTicketSubmitToken } from "@/lib/security";

export const TICKET_SUBMITTER = "codex";
export const TICKET_ASSIGNEES = ["atlas", "weaver", "amber", "claude", "artemis"] as const;
export type TicketAssignee = (typeof TICKET_ASSIGNEES)[number];

export const MAX_TICKET_TITLE_LENGTH = 200;
export const MAX_TICKET_BODY_LENGTH = 4_000;
export const MAX_SUBMIT_BYTES = 16 * 1024;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const SUBMIT_RATE_LIMIT = 20;
export const SUBMIT_RATE_WINDOW_MS = 60 * 60 * 1000;

const ALLOWED_FIELDS = new Set(["title", "body", "assignee", "idempotencyKey"]);
// Titles are single-line; bodies may contain newlines and tabs.
const TITLE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
const BODY_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type TicketSubmission = {
  title: string;
  body: string | null;
  assignee: TicketAssignee | null;
  idempotencyKey: string;
};

export type SubmittedRequest = {
  id: string;
  kind: string;
  status: string;
  title: string;
  createdAt: Date | string;
};

export type TicketCreateData = ReturnType<typeof buildHermesRequestData> & {
  submitter: string;
  idempotencyKey: string;
};

export type TicketSubmitDependencies = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  findByIdempotencyKey: (key: string) => Promise<SubmittedRequest | null>;
  /** Submissions by this submitter created at or after `since`, oldest first (only the oldest is needed). */
  recentSubmissions: (
    submitter: string,
    since: Date,
  ) => Promise<{ count: number; oldest: Date | null }>;
  create: (data: TicketCreateData) => Promise<SubmittedRequest>;
  log?: (entry: Record<string, unknown>) => void;
};

type Validation =
  | { ok: true; value: TicketSubmission }
  | { ok: false; error: string };

function invalid(error: string): Validation {
  return { ok: false, error };
}

export function validateTicketSubmission(input: unknown): Validation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalid("body must be a JSON object");
  }
  const record = input as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length > 0) {
    return invalid(`unsupported field(s): ${unknown.slice(0, 5).join(", ").slice(0, 200)}`);
  }

  if (typeof record.title !== "string") return invalid("title is required");
  const title = record.title.trim();
  if (!title) return invalid("title is required");
  if (title.length > MAX_TICKET_TITLE_LENGTH) {
    return invalid(`title must be ${MAX_TICKET_TITLE_LENGTH} characters or fewer`);
  }
  if (TITLE_FORBIDDEN.test(title)) return invalid("title contains control characters");
  // The title is a positional CLI argument; a leading dash would read as an option.
  if (title.startsWith("-")) return invalid("title cannot start with '-'");

  let body: string | null = null;
  if (record.body !== undefined && record.body !== null) {
    if (typeof record.body !== "string") return invalid("body must be text");
    const trimmed = record.body.trim();
    if (trimmed.length > MAX_TICKET_BODY_LENGTH) {
      return invalid(`body must be ${MAX_TICKET_BODY_LENGTH} characters or fewer`);
    }
    if (BODY_FORBIDDEN.test(trimmed)) return invalid("body contains control characters");
    body = trimmed || null;
  }

  let assignee: TicketAssignee | null = null;
  if (record.assignee !== undefined && record.assignee !== null && record.assignee !== "") {
    if (typeof record.assignee !== "string") return invalid("assignee must be text");
    const normalized = record.assignee.trim().toLowerCase();
    if (!(TICKET_ASSIGNEES as readonly string[]).includes(normalized)) {
      return invalid(`assignee must be one of: ${TICKET_ASSIGNEES.join(", ")}`);
    }
    assignee = normalized as TicketAssignee;
  }

  if (typeof record.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(record.idempotencyKey)) {
    return invalid(
      "idempotencyKey is required: 8-128 characters of letters, digits, '.', '_', ':' or '-'",
    );
  }

  return {
    ok: true,
    value: { title, body, assignee, idempotencyKey: record.idempotencyKey },
  };
}

/** Stored key, namespaced by submitter so it cannot collide with other origins. */
export function storedIdempotencyKey(clientKey: string, submitter = TICKET_SUBMITTER): string {
  return `${submitter}:${clientKey}`;
}

/** The payload the bridge reads from AgentRequest.prompt for kanban.create. */
export function buildTicketPayload(submission: TicketSubmission, board: string) {
  return {
    board,
    ...(submission.body ? { body: submission.body } : {}),
    ...(submission.assignee ? { assignee: submission.assignee } : {}),
    initialStatus: "blocked" as const,
    submitter: TICKET_SUBMITTER,
  };
}

export function buildTicketCreateData(
  submission: TicketSubmission,
  board: string,
): TicketCreateData {
  const data = buildHermesRequestData({
    origin: TICKET_SUBMITTER,
    kind: "kanban.create",
    title: submission.title,
    prompt: JSON.stringify(buildTicketPayload(submission, board)),
  });
  // Policy classifies kanban.create as approval-gated; refuse to write
  // anything else should that ever change.
  if (data.kind !== "kanban.create" || data.status !== "awaiting_approval") {
    throw new Error("kanban.create is no longer approval-gated; refusing external submission");
  }
  return {
    ...data,
    submitter: TICKET_SUBMITTER,
    idempotencyKey: storedIdempotencyKey(submission.idempotencyKey),
  };
}

function publicView(row: SubmittedRequest) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

async function readLimitedText(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function defaultLog(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "ticket_submit", ...entry }));
}

export async function handleTicketSubmit(
  req: Request,
  deps: TicketSubmitDependencies,
): Promise<NextResponse> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? (() => new Date());
  const audit = { submitter: TICKET_SUBMITTER };

  // Defense in depth: the proxy enforces this too, but the handler never
  // relies on it (and the proxy's development bypass does not apply here).
  const configured = resolveTicketSubmitToken(env);
  if (!configured) {
    log({ ...audit, outcome: "rejected", reason: "not_configured" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasValidTicketSubmitToken(req.headers, configured)) {
    log({ ...audit, outcome: "rejected", reason: "bad_token" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return NextResponse.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SUBMIT_BYTES) {
    log({ ...audit, outcome: "rejected", reason: "too_large" });
    return NextResponse.json({ error: `request body exceeds ${MAX_SUBMIT_BYTES} bytes` }, { status: 413 });
  }
  const text = await readLimitedText(req, MAX_SUBMIT_BYTES);
  if (text === null) {
    log({ ...audit, outcome: "rejected", reason: "too_large" });
    return NextResponse.json({ error: `request body exceeds ${MAX_SUBMIT_BYTES} bytes` }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }
  const validation = validateTicketSubmission(parsed);
  if (!validation.ok) {
    log({ ...audit, outcome: "rejected", reason: "invalid" });
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const submission = validation.value;
  const key = storedIdempotencyKey(submission.idempotencyKey);

  const existing = await deps.findByIdempotencyKey(key);
  if (existing) {
    log({ ...audit, outcome: "replayed", requestId: existing.id, idempotencyKey: submission.idempotencyKey });
    return NextResponse.json({ request: publicView(existing), replayed: true }, { status: 200 });
  }

  const windowStart = new Date(now().getTime() - SUBMIT_RATE_WINDOW_MS);
  const recent = await deps.recentSubmissions(TICKET_SUBMITTER, windowStart);
  if (recent.count >= SUBMIT_RATE_LIMIT) {
    const resetAt = (recent.oldest?.getTime() ?? now().getTime()) + SUBMIT_RATE_WINDOW_MS;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now().getTime()) / 1000));
    log({ ...audit, outcome: "rejected", reason: "rate_limited" });
    return NextResponse.json(
      { error: `rate limit exceeded: ${SUBMIT_RATE_LIMIT} submissions per hour` },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const data = buildTicketCreateData(submission, resolvePrimaryBoard(env));
  let row: SubmittedRequest;
  try {
    row = await deps.create(data);
  } catch (error) {
    // A concurrent submission with the same key won the insert.
    if (!isUniqueViolation(error)) throw error;
    const winner = await deps.findByIdempotencyKey(key);
    if (!winner) throw error;
    log({ ...audit, outcome: "replayed", requestId: winner.id, idempotencyKey: submission.idempotencyKey });
    return NextResponse.json({ request: publicView(winner), replayed: true }, { status: 200 });
  }

  log({ ...audit, outcome: "created", requestId: row.id, idempotencyKey: submission.idempotencyKey });
  return NextResponse.json({ request: publicView(row), replayed: false }, { status: 201 });
}
