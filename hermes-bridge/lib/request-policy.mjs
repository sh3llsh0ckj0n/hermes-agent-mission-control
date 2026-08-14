export const RISK_LEVELS = Object.freeze({
  READ_ONLY: "read_only",
  LOCAL_WRITE: "local_write",
  EXTERNAL_WRITE: "external_write",
  PRIVILEGED: "privileged",
  DESTRUCTIVE: "destructive",
});

const REQUEST_POLICIES = Object.freeze({
  oneshot: RISK_LEVELS.PRIVILEGED,
  chat: RISK_LEVELS.PRIVILEGED,
  kanban: RISK_LEVELS.LOCAL_WRITE,
  "kanban.create": RISK_LEVELS.LOCAL_WRITE,
  "kanban.complete": RISK_LEVELS.LOCAL_WRITE,
  "kanban.block": RISK_LEVELS.LOCAL_WRITE,
  "kanban.unblock": RISK_LEVELS.LOCAL_WRITE,
  "kanban.promote": RISK_LEVELS.LOCAL_WRITE,
  "kanban.archive": RISK_LEVELS.LOCAL_WRITE,
  "cron.create": RISK_LEVELS.PRIVILEGED,
  "cron.edit": RISK_LEVELS.PRIVILEGED,
  "cron.pause": RISK_LEVELS.EXTERNAL_WRITE,
  "cron.resume": RISK_LEVELS.EXTERNAL_WRITE,
  "cron.run": RISK_LEVELS.PRIVILEGED,
  "cron.remove": RISK_LEVELS.DESTRUCTIVE,
  "wiki.write": RISK_LEVELS.LOCAL_WRITE,
  "memory.write": RISK_LEVELS.LOCAL_WRITE,
  "memory.update": RISK_LEVELS.LOCAL_WRITE,
  "memory.remove": RISK_LEVELS.DESTRUCTIVE,
  "briefing.generate": RISK_LEVELS.READ_ONLY,
  "diagnostic.status": RISK_LEVELS.READ_ONLY,
});

export class UnknownRequestKindError extends Error {
  constructor(kind) {
    super(`Unsupported Hermes request kind: ${String(kind || "(empty)")}`);
    this.name = "UnknownRequestKindError";
    this.code = "UNKNOWN_REQUEST_KIND";
  }
}

export function normalizeRequestKind(kind) {
  return typeof kind === "string" ? kind.trim().toLowerCase() : "";
}

export function classifyRequestKind(kind) {
  const normalizedKind = normalizeRequestKind(kind);
  const risk = REQUEST_POLICIES[normalizedKind];
  if (!risk) throw new UnknownRequestKindError(normalizedKind);

  const requiresApproval = risk !== RISK_LEVELS.READ_ONLY;
  return Object.freeze({
    kind: normalizedKind,
    risk,
    requiresApproval,
    sideEffecting: requiresApproval,
  });
}

export function deriveQueuedRequest(input) {
  const policy = classifyRequestKind(input?.kind);
  return {
    ...input,
    kind: policy.kind,
    sideEffecting: policy.sideEffecting,
    status: policy.requiresApproval ? "awaiting_approval" : "queued",
  };
}

export function claimableRequestKinds() {
  const safe = [];
  const approved = [];

  for (const kind of Object.keys(REQUEST_POLICIES).sort()) {
    const policy = classifyRequestKind(kind);
    if (policy.requiresApproval) approved.push(kind);
    else safe.push(kind);
  }

  return { safe, approved };
}

export function listRequestPolicies() {
  return Object.entries(REQUEST_POLICIES)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, risk]) => ({
      kind,
      risk,
      requiresApproval: risk !== RISK_LEVELS.READ_ONLY,
    }));
}
