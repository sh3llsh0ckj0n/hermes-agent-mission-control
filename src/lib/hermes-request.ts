import {
  classifyRequestKind,
  deriveQueuedRequest,
  UnknownRequestKindError,
} from "../../hermes-bridge/lib/request-policy.mjs";

export type HermesRequestInput = {
  origin?: string;
  kind: unknown;
  title: string;
  prompt?: string | null;
  sideEffecting?: unknown;
};

export function buildHermesRequestData(input: HermesRequestInput) {
  const queued = deriveQueuedRequest({
    origin: input.origin ?? "web",
    kind: input.kind,
    title: input.title,
    prompt: input.prompt ?? null,
  });

  return {
    origin: queued.origin,
    kind: queued.kind,
    title: queued.title,
    prompt: queued.prompt,
    sideEffecting: queued.sideEffecting,
    status: queued.status,
  };
}

export function getHermesRequestPolicy(kind: unknown) {
  return classifyRequestKind(kind);
}

export function isUnknownHermesRequestKind(
  error: unknown,
): error is UnknownRequestKindError {
  return error instanceof UnknownRequestKindError;
}
