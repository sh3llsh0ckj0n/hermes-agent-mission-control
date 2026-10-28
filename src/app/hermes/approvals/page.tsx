import { redirect } from "next/navigation";

import {
  ApprovalDenied,
  ApprovalIndexScreen,
  ApprovalReadFailed,
  ApprovalSchemaPending,
} from "@/components/approval-packages";
import { fixturePreviewEnabled, readApprovalViewer } from "@/lib/approval-access";
import { loadApprovalIndex } from "@/lib/approval-read";
import { fixtureApprovalIndex, type ApprovalIndexView } from "@/lib/approval-view";
import { isMissionControlSchemaPending } from "@/lib/mission-control";
import { logMissionControlFailure } from "@/lib/mc-diagnostics";

export const dynamic = "force-dynamic";

type IndexLoad =
  | { kind: "ok"; model: ApprovalIndexView }
  | { kind: "pending" }
  | { kind: "failed"; category: string };

async function loadIndex(): Promise<IndexLoad> {
  try {
    return { kind: "ok", model: await loadApprovalIndex() };
  } catch (error) {
    if (isMissionControlSchemaPending(error)) return { kind: "pending" };
    const classified = logMissionControlFailure("GET /hermes/approvals", error);
    return { kind: "failed", category: classified.category };
  }
}

export default async function ApprovalIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string }>;
}) {
  const params = await searchParams;
  if (params.fixture === "1" && fixturePreviewEnabled()) {
    return <ApprovalIndexScreen model={fixtureApprovalIndex()} />;
  }

  const access = await readApprovalViewer();
  if (!access.ok && access.reason === "unauthenticated") redirect("/login");
  if (!access.ok) return <ApprovalDenied />;

  const loaded = await loadIndex();
  if (loaded.kind === "pending") return <ApprovalSchemaPending />;
  if (loaded.kind === "failed") return <ApprovalReadFailed category={loaded.category} />;
  return <ApprovalIndexScreen model={loaded.model} />;
}
