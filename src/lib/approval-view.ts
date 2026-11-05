/**
 * Read-only view of RigSpecs approval packages.
 *
 * McApproval.status is a mirror of the JSON ledger. It is not validity.
 * A package is valid only when all of the following are true:
 * - recorded status is granted
 * - the mirror and the project-state ledger snapshot agree
 * - packageMatches is true for a pinned 64-hex SHA-256
 * - lastReconciledAt (the clock of that hash comparison) is within
 *   APPROVAL_INTEGRITY_FRESH_MS
 *
 * That window is 30 minutes, the same reconciliation staleness window
 * Mission Control already publishes. A match older than 30 minutes is stale
 * and the package is not valid.
 */

export const APPROVAL_INTEGRITY_FRESH_MS = 30 * 60 * 1000;
export const APPROVAL_INTEGRITY_FRESH_LABEL = "30 minutes";
export const APPROVAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

const FIXTURE_CLOCK = Date.parse("2026-10-28T20:00:00.000Z");
const FIXTURE_BANNER =
  "FIXTURE DATA — not a live approval, not a grant, and not the 31-row Black Rhino pilot.";

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const RECEIPT_ID = /^sha256:[0-9a-f]{64}$/i;
const SQL_STATEMENT =
  /\b(SELECT\s+[\s\S]+\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|DATABASE|SCHEMA|INDEX)|ALTER\s+TABLE|CREATE\s+(TABLE|ROLE|USER|INDEX|DATABASE)|REVOKE\s+|GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL|USAGE|CONNECT)\b)/i;
const FILESYSTEM_PATH = /~\/|\/home\/|^\/|^[A-Za-z]:\\/;

const RECORDED_STATUSES = new Set([
  "not_requested",
  "waiting",
  "granted",
  "rejected",
  "invalidated",
  "executed",
  "unrecorded",
]);

export type ApprovalBadge = "waiting" | "granted" | "rejected" | "invalidated" | "unavailable";
export type ApprovalVerification = "fresh-match" | "stale-match" | "mismatch" | "unavailable";

export interface ApprovalTaskView {
  id: string;
  title: string;
  board: string;
  kanbanId: string;
  kanbanStatus: string;
  normalizedStatus: string;
}

export interface ApprovalReceiptView {
  id: string;
  label: string;
  result: string;
  integrity: string;
  finishedAt: string | null;
  qcVerdict: string | null;
}

export interface ApprovalReceiptInput extends ApprovalReceiptView {
  paths?: readonly string[];
}

export interface LedgerSnapshot {
  status?: string | null;
  packageSha256?: string | null;
  packageMatches?: boolean | null;
}

export interface ApprovalAssessmentInput {
  id: string;
  projectId: string;
  projectName?: string | null;
  scope: string;
  requestedAction?: string | null;
  status?: string | null;
  packageId?: string | null;
  packageSha256?: string | null;
  packageMatches?: boolean | null;
  approver?: string | null;
  decidedAt?: Date | string | null;
  executionBoundary?: string | null;
  updatedAt?: Date | string | null;
  lastReconciledAt?: Date | string | null;
  ledgerSnapshot?: LedgerSnapshot | null;
  tasks?: ApprovalTaskView[];
  receipts?: ApprovalReceiptInput[];
  fixture?: boolean;
}

export interface ApprovalPackageView {
  id: string;
  projectId: string;
  projectName: string;
  scope: string;
  requestedAction: string | null;
  recordedStatus: string;
  badge: ApprovalBadge;
  packageValid: boolean;
  verification: ApprovalVerification;
  verificationLabel: string;
  pinnedSha256: string | null;
  packageIdRecorded: boolean;
  approver: string | null;
  decidedAt: string | null;
  executionBoundary: string | null;
  mirrorWrittenAt: string | null;
  lastSuccessfulSyncAt: string | null;
  syncFresh: boolean;
  freshnessThreshold: string;
  tasks: ApprovalTaskView[];
  receipts: ApprovalReceiptView[];
  notes: string[];
  fixture: boolean;
}

export interface ApprovalIndexView {
  fixture: boolean;
  banner: string | null;
  freshnessLabel: string;
  packages: ApprovalPackageView[];
  pending: ApprovalPackageView[];
  historical: ApprovalPackageView[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : date.toISOString();
}

function publicText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || SQL_STATEMENT.test(trimmed) || FILESYSTEM_PATH.test(trimmed)) return null;
  return trimmed;
}

function verificationLabel(verification: ApprovalVerification): string {
  switch (verification) {
    case "fresh-match":
      return `Fresh match. The pinned SHA-256 matched within ${APPROVAL_INTEGRITY_FRESH_LABEL}.`;
    case "stale-match":
      return `Stale match. The hash matched, but that evidence is older than ${APPROVAL_INTEGRITY_FRESH_LABEL}. Not valid.`;
    case "mismatch":
      return "Hash mismatch. The package bytes no longer match the pinned SHA-256. Not valid.";
    case "unavailable":
      return "Unavailable. No fresh integrity result is on record. A mirrored status of granted is not valid.";
  }
}

function publicTask(task: ApprovalTaskView): ApprovalTaskView | null {
  const id = publicText(task.id);
  const kanbanId = publicText(task.kanbanId);
  if (!id || !kanbanId) return null;
  return {
    id,
    title: publicText(task.title) ?? "Task",
    board: publicText(task.board) ?? "board",
    kanbanId,
    kanbanStatus: publicText(task.kanbanStatus) ?? "unknown",
    normalizedStatus: publicText(task.normalizedStatus) ?? "unknown",
  };
}

function publicReceipt(receipt: ApprovalReceiptInput): ApprovalReceiptView | null {
  if (!RECEIPT_ID.test(receipt.id)) return null;
  return {
    id: receipt.id.toLowerCase(),
    label: publicText(receipt.label) ?? "Receipt",
    result: publicText(receipt.result) ?? "UNKNOWN",
    integrity: publicText(receipt.integrity) ?? "unverified",
    finishedAt: iso(receipt.finishedAt),
    qcVerdict: publicText(receipt.qcVerdict),
  };
}

export function taskMentionsApproval(reasons: unknown, approvalId: string): boolean {
  if (!APPROVAL_ID_PATTERN.test(approvalId)) return false;
  const text = JSON.stringify(reasons ?? "");
  const escaped = approvalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`).test(text);
}

export function receiptIdsFromEvidence(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return [];
  const ids: string[] = [];
  for (const item of evidence) {
    if (!item || typeof item !== "object" || !("receiptId" in item)) continue;
    const receiptId = (item as { receiptId?: unknown }).receiptId;
    if (typeof receiptId === "string" && RECEIPT_ID.test(receiptId)) ids.push(receiptId.toLowerCase());
  }
  return ids;
}

export function ledgerSnapshots(state: unknown): Map<string, LedgerSnapshot> {
  const snapshots = new Map<string, LedgerSnapshot>();
  if (!state || typeof state !== "object" || Array.isArray(state)) return snapshots;
  const approvals = (state as { approvals?: unknown }).approvals;
  if (!Array.isArray(approvals)) return snapshots;
  for (const item of approvals) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.approvalId !== "string" || !APPROVAL_ID_PATTERN.test(row.approvalId)) continue;
    snapshots.set(row.approvalId, {
      status: typeof row.status === "string" ? row.status : null,
      packageSha256: typeof row.packageSha256 === "string" ? row.packageSha256 : null,
      packageMatches: typeof row.packageMatches === "boolean" ? row.packageMatches : null,
    });
  }
  return snapshots;
}

export function presentApproval(input: ApprovalAssessmentInput, now = Date.now()): ApprovalPackageView {
  const recordedStatus =
    input.status && RECORDED_STATUSES.has(input.status) ? input.status : "unavailable";
  const pinnedSha256 =
    input.packageSha256 && SHA256_HEX.test(input.packageSha256) ? input.packageSha256.toLowerCase() : null;
  const lastSuccessfulSyncAt = iso(input.lastReconciledAt);
  const notes: string[] = [];

  let disagree = false;
  const snapshot = input.ledgerSnapshot;
  if (snapshot) {
    const statusDiffers = snapshot.status != null && snapshot.status !== input.status;
    const hashDiffers =
      snapshot.packageSha256 != null &&
      snapshot.packageSha256.toLowerCase() !== (pinnedSha256 ?? input.packageSha256 ?? "").toLowerCase();
    const matchDiffers =
      typeof snapshot.packageMatches === "boolean" && snapshot.packageMatches !== input.packageMatches;
    disagree = statusDiffers || hashDiffers || matchDiffers;
    if (disagree) {
      notes.push("Mirrored approval and the project-state ledger snapshot disagree.");
    }
  }

  let syncFresh = false;
  let verification: ApprovalVerification = "unavailable";
  if (!disagree && input.packageMatches === false) {
    verification = "mismatch";
    notes.push("An altered package does not stay granted. The hash comparison failed.");
  } else if (!disagree && input.packageMatches === true && pinnedSha256 && lastSuccessfulSyncAt) {
    const age = now - Date.parse(lastSuccessfulSyncAt);
    if (age < 0) {
      verification = "unavailable";
      notes.push("The reconciliation timestamp is in the future, so the hash comparison is not fresh.");
    } else if (age > APPROVAL_INTEGRITY_FRESH_MS) {
      verification = "stale-match";
      notes.push("Integrity evidence is stale and is not a valid grant.");
    } else {
      verification = "fresh-match";
      syncFresh = true;
    }
  } else if (!disagree && input.packageMatches === true && pinnedSha256) {
    notes.push("No successful mirror sync time is on record, so the hash comparison is not fresh.");
  } else if (!disagree && recordedStatus === "granted") {
    notes.push("Mirrored status is granted. That alone is not a valid package.");
  }

  if (lastSuccessfulSyncAt && !syncFresh) {
    const age = now - Date.parse(lastSuccessfulSyncAt);
    syncFresh = age >= 0 && age <= APPROVAL_INTEGRITY_FRESH_MS;
  }

  const label = verificationLabel(verification);
  notes.push(label);

  let badge: ApprovalBadge = "unavailable";
  if (!disagree && recordedStatus === "waiting") badge = "waiting";
  else if (!disagree && recordedStatus === "rejected") badge = "rejected";
  else if (!disagree && recordedStatus === "invalidated") badge = "invalidated";
  else if (!disagree && verification === "mismatch") badge = "invalidated";
  else if (!disagree && recordedStatus === "granted" && verification === "fresh-match") badge = "granted";

  const packageValid = badge === "granted" && verification === "fresh-match";
  const requestedAction = publicText(input.requestedAction);
  const executionBoundary = publicText(input.executionBoundary);
  if (input.requestedAction && !requestedAction) {
    notes.push("Recorded action withheld because it contained a statement or a filesystem path.");
  }

  return {
    id: input.id,
    projectId: input.projectId,
    projectName: publicText(input.projectName) ?? input.projectId,
    scope: publicText(input.scope) ?? "Scope withheld",
    requestedAction,
    recordedStatus,
    badge,
    packageValid,
    verification,
    verificationLabel: label,
    pinnedSha256,
    packageIdRecorded: Boolean(input.packageId && input.packageId.trim()),
    approver: publicText(input.approver),
    decidedAt: iso(input.decidedAt),
    executionBoundary,
    mirrorWrittenAt: iso(input.updatedAt),
    lastSuccessfulSyncAt,
    syncFresh,
    freshnessThreshold: APPROVAL_INTEGRITY_FRESH_LABEL,
    tasks: (input.tasks ?? []).map(publicTask).filter((task): task is ApprovalTaskView => task !== null),
    receipts: (input.receipts ?? [])
      .map(publicReceipt)
      .filter((receipt): receipt is ApprovalReceiptView => receipt !== null),
    notes,
    fixture: Boolean(input.fixture),
  };
}

export function buildApprovalIndex(
  packages: ApprovalPackageView[],
  options: { fixture?: boolean; banner?: string | null } = {},
): ApprovalIndexView {
  return {
    fixture: Boolean(options.fixture),
    banner: options.banner ?? null,
    freshnessLabel: APPROVAL_INTEGRITY_FRESH_LABEL,
    packages,
    pending: packages.filter((item) => item.badge === "waiting"),
    historical: packages.filter((item) => item.badge !== "waiting"),
  };
}

function fixtureHash(byte: string) {
  return byte.repeat(32);
}

function fixtureInput(
  id: string,
  overrides: Partial<ApprovalAssessmentInput>,
): ApprovalAssessmentInput {
  return {
    id,
    projectId: "fixture-catalog",
    projectName: "Fixture Catalog",
    scope: `Fixture scope for ${id}`,
    requestedAction: "Fixture review action. No executable SQL.",
    executionBoundary: "Fixture boundary only",
    approver: null,
    decidedAt: null,
    packageId: "fixture-package",
    updatedAt: new Date(FIXTURE_CLOCK - 5 * 60 * 1000).toISOString(),
    lastReconciledAt: new Date(FIXTURE_CLOCK - 5 * 60 * 1000).toISOString(),
    fixture: true,
    tasks: [],
    receipts: [],
    ...overrides,
  };
}

export function fixtureAssessments(now = FIXTURE_CLOCK): ApprovalAssessmentInput[] {
  const fresh = new Date(now - 5 * 60 * 1000).toISOString();
  const stale = new Date(now - APPROVAL_INTEGRITY_FRESH_MS - 60_000).toISOString();
  const receiptId = `sha256:${fixtureHash("c1")}`;
  return [
    fixtureInput("fixture-granted-fresh", {
      scope: "Fixture grant with a fresh hash match",
      status: "granted",
      packageSha256: fixtureHash("a1"),
      packageMatches: true,
      approver: "fixture-reviewer",
      decidedAt: "2026-10-20T12:00:00.000Z",
      lastReconciledAt: fresh,
      updatedAt: fresh,
      tasks: [
        {
          id: "fixture-board/t_fixture",
          title: "Fixture Kanban card",
          board: "fixture-board",
          kanbanId: "t_fixture",
          kanbanStatus: "blocked",
          normalizedStatus: "WAITING_APPROVAL",
        },
      ],
      receipts: [
        {
          id: receiptId,
          label: "Fixture execution receipt",
          result: "PASS",
          integrity: "verified",
          finishedAt: "2026-10-20T12:05:00.000Z",
          qcVerdict: "PASS",
        },
      ],
    }),
    fixtureInput("fixture-granted-stale", {
      scope: "Fixture grant whose hash match is stale",
      status: "granted",
      packageSha256: fixtureHash("b2"),
      packageMatches: true,
      approver: "fixture-reviewer",
      decidedAt: "2026-10-01T00:00:00.000Z",
      lastReconciledAt: stale,
      updatedAt: stale,
    }),
    fixtureInput("fixture-granted-mismatch", {
      scope: "Fixture grant whose package bytes changed",
      status: "granted",
      packageSha256: fixtureHash("c3"),
      packageMatches: false,
      approver: "fixture-reviewer",
      decidedAt: "2026-10-18T00:00:00.000Z",
      lastReconciledAt: fresh,
      updatedAt: fresh,
    }),
    fixtureInput("fixture-rejected", {
      scope: "Fixture rejection",
      status: "rejected",
      packageSha256: fixtureHash("d4"),
      packageMatches: true,
      approver: "fixture-reviewer",
      decidedAt: "2026-10-19T00:00:00.000Z",
      lastReconciledAt: fresh,
      updatedAt: fresh,
    }),
    fixtureInput("fixture-waiting", {
      scope: "Fixture package waiting for a decision",
      status: "waiting",
      packageSha256: fixtureHash("e5"),
      packageMatches: null,
      lastReconciledAt: fresh,
      updatedAt: fresh,
    }),
    fixtureInput("fixture-unavailable", {
      scope: "Fixture package with no integrity evidence",
      status: "granted",
      packageSha256: null,
      packageMatches: null,
      packageId: null,
      lastReconciledAt: null,
      updatedAt: null,
    }),
  ];
}

export function fixtureApprovalIndex(now = FIXTURE_CLOCK): ApprovalIndexView {
  return buildApprovalIndex(
    fixtureAssessments(now).map((item) => presentApproval(item, now)),
    { fixture: true, banner: FIXTURE_BANNER },
  );
}

export function fixtureApprovalDetail(id: string, now = FIXTURE_CLOCK): ApprovalPackageView | null {
  const match = fixtureAssessments(now).find((item) => item.id === id);
  return match ? presentApproval(match, now) : null;
}
