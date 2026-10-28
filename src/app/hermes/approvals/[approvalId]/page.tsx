import { notFound, redirect } from "next/navigation";

import {
  ApprovalDenied,
  ApprovalDetailScreen,
  ApprovalMissing,
  ApprovalReadFailed,
  ApprovalSchemaPending,
} from "@/components/approval-packages";
import { fixturePreviewEnabled, readApprovalViewer } from "@/lib/approval-access";
import { loadApprovalDetail } from "@/lib/approval-read";
import { APPROVAL_ID_PATTERN, fixtureApprovalDetail, type ApprovalPackageView } from "@/lib/approval-view";
import { isMissionControlSchemaPending } from "@/lib/mission-control";
import { logMissionControlFailure } from "@/lib/mc-diagnostics";

export const dynamic = "force-dynamic";

type DetailLoad =
  | { kind: "ok"; item: ApprovalPackageView | null }
  | { kind: "pending" }
  | { kind: "failed"; category: string };

async function loadDetail(approvalId: string): Promise<DetailLoad> {
  try {
    return { kind: "ok", item: await loadApprovalDetail(approvalId) };
  } catch (error) {
    if (isMissionControlSchemaPending(error)) return { kind: "pending" };
    const classified = logMissionControlFailure("GET /hermes/approvals/[approvalId]", error);
    return { kind: "failed", category: classified.category };
  }
}

export default async function ApprovalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ approvalId: string }>;
  searchParams: Promise<{ fixture?: string }>;
}) {
  const [{ approvalId }, query] = await Promise.all([params, searchParams]);
  if (!APPROVAL_ID_PATTERN.test(approvalId)) notFound();

  if (query.fixture === "1" && fixturePreviewEnabled()) {
    const fixture = fixtureApprovalDetail(approvalId);
    if (!fixture) return <ApprovalMissing />;
    return <ApprovalDetailScreen item={fixture} />;
  }

  const access = await readApprovalViewer();
  if (!access.ok && access.reason === "unauthenticated") redirect("/login");
  if (!access.ok) return <ApprovalDenied />;

  const loaded = await loadDetail(approvalId);
  if (loaded.kind === "pending") return <ApprovalSchemaPending />;
  if (loaded.kind === "failed") return <ApprovalReadFailed category={loaded.category} />;
  if (!loaded.item) return <ApprovalMissing />;
  return <ApprovalDetailScreen item={loaded.item} />;
}
