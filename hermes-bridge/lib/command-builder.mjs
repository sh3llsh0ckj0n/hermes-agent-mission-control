import { createHash } from "node:crypto";

import { classifyRequestKind } from "./request-policy.mjs";
import { ValidationError } from "./errors.mjs";

function requiredString(value, label, maxLength = 20_000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} is required`);
  }
  if (value.includes("\0") || value.length > maxLength) {
    throw new ValidationError(`${label} is invalid`);
  }
  return value.trim();
}

function optionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${label} is invalid`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  return requiredString(normalized, label, maxLength);
}

function requiredPositionalString(value, label, maxLength) {
  const normalized = requiredString(value, label, maxLength);
  if (normalized.startsWith("-")) {
    throw new ValidationError(`${label} cannot be an option`);
  }
  return normalized;
}

function optionalPositionalString(value, label, maxLength) {
  const normalized = optionalString(value, label, maxLength);
  if (normalized?.startsWith("-")) {
    throw new ValidationError(`${label} cannot be an option`);
  }
  return normalized;
}

const BLOCK_KINDS = new Set([
  "capability",
  "dependency",
  "needs_input",
  "transient",
]);

export function requestIdempotencyKey(requestId) {
  const normalizedId = requiredString(requestId, "AgentRequest ID", 500);
  const digest = createHash("sha256").update(normalizedId, "utf8").digest("hex");
  return `agent-request-${digest.slice(0, 32)}`;
}

export function parseRequestPayload(request) {
  if (!request?.prompt) return {};
  try {
    const parsed = JSON.parse(request.prompt);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new ValidationError("Hermes request payload must be a JSON object");
  }
}

export function buildHermesCommand(request, { board = "default", runTimeoutMs = 240_000 } = {}) {
  const policy = classifyRequestKind(request?.kind);

  if (policy.kind === "diagnostic.status") {
    return {
      args: ["status"],
      timeoutMs: 12_000,
    };
  }

  const title = requiredString(request?.title, "Request title", 200);
  const prompt = typeof request?.prompt === "string" ? request.prompt : "";

  if (policy.kind === "oneshot" || policy.kind === "chat") {
    return {
      args: ["-z", requiredString(prompt || title, "Request prompt")],
      timeoutMs: runTimeoutMs,
    };
  }
  if (policy.kind === "kanban" || policy.kind === "kanban.create") {
    return {
      args: [
        "kanban",
        "--board",
        requiredString(board, "Hermes board", 200),
        "create",
        "--json",
        "--idempotency-key",
        requestIdempotencyKey(request?.id),
        title,
      ],
      timeoutMs: 20_000,
    };
  }
  if ([
    "kanban.complete",
    "kanban.block",
    "kanban.unblock",
    "kanban.promote",
    "kanban.archive",
  ].includes(policy.kind)) {
    const payload = parseRequestPayload(request);
    const configuredBoard = requiredString(board, "Hermes board", 200);
    const taskId = requiredPositionalString(payload.taskId, "Kanban task ID", 500);

    if (policy.kind === "kanban.complete") {
      const result = optionalString(payload.result, "Kanban result", 2_000);
      return {
        args: [
          "kanban",
          "--board",
          configuredBoard,
          "complete",
          ...(result ? ["--result", result] : []),
          taskId,
        ],
        timeoutMs: 20_000,
      };
    }

    if (policy.kind === "kanban.block") {
      const reason = requiredPositionalString(payload.reason, "Kanban block reason", 1_000);
      const blockKind = optionalString(payload.kind, "Kanban block kind", 50);
      if (blockKind && !BLOCK_KINDS.has(blockKind)) {
        throw new ValidationError("Kanban block kind is invalid");
      }
      return {
        args: [
          "kanban",
          "--board",
          configuredBoard,
          "block",
          ...(blockKind ? ["--kind", blockKind] : []),
          taskId,
          reason,
        ],
        timeoutMs: 20_000,
      };
    }

    if (policy.kind === "kanban.unblock") {
      const reason = optionalString(payload.reason, "Kanban unblock reason", 1_000);
      return {
        args: [
          "kanban",
          "--board",
          configuredBoard,
          "unblock",
          ...(reason ? ["--reason", reason] : []),
          taskId,
        ],
        timeoutMs: 20_000,
      };
    }

    if (policy.kind === "kanban.promote") {
      const reason = optionalPositionalString(payload.reason, "Kanban promote reason", 1_000);
      return {
        args: [
          "kanban",
          "--board",
          configuredBoard,
          "promote",
          "--json",
          taskId,
          ...(reason ? [reason] : []),
        ],
        timeoutMs: 20_000,
      };
    }

    return {
      args: ["kanban", "--board", configuredBoard, "archive", taskId],
      timeoutMs: 20_000,
    };
  }
  if (policy.kind.startsWith("cron.")) {
    const payload = parseRequestPayload(request);
    const op = policy.kind.slice("cron.".length);
    if (op === "create") {
      return {
        args: [
          "cron",
          "create",
          requiredString(payload.schedule, "Cron schedule", 500),
          requiredString(payload.prompt || payload.name, "Cron prompt", 20_000),
        ],
        timeoutMs: 20_000,
      };
    }
    return {
      args: ["cron", op, requiredString(payload.id || payload.name, "Cron ID or name", 500)],
      timeoutMs: 20_000,
    };
  }

  throw new ValidationError(
    `Request kind ${policy.kind} is not executed through the Hermes CLI`,
  );
}
