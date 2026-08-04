export type HermesRiskLevel =
  | "read_only"
  | "local_write"
  | "external_write"
  | "privileged"
  | "destructive";

export type HermesRequestPolicy = {
  kind: string;
  risk: HermesRiskLevel;
  requiresApproval: boolean;
  sideEffecting: boolean;
};

export const RISK_LEVELS: Readonly<{
  READ_ONLY: "read_only";
  LOCAL_WRITE: "local_write";
  EXTERNAL_WRITE: "external_write";
  PRIVILEGED: "privileged";
  DESTRUCTIVE: "destructive";
}>;

export class UnknownRequestKindError extends Error {
  code: "UNKNOWN_REQUEST_KIND";
}

export function normalizeRequestKind(kind: unknown): string;
export function classifyRequestKind(kind: unknown): HermesRequestPolicy;
export function deriveQueuedRequest<T extends { kind?: unknown }>(
  input: T,
): Omit<T, "kind"> & {
  kind: string;
  sideEffecting: boolean;
  status: "queued" | "awaiting_approval";
};
export function claimableRequestKinds(): {
  safe: string[];
  approved: string[];
};
export function listRequestPolicies(): Array<
  Omit<HermesRequestPolicy, "sideEffecting">
>;
