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
