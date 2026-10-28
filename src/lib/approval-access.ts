import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { isEmailAllowed } from "@/lib/security";

export type ApprovalAccess =
  | { ok: true; email: string }
  | { ok: false; reason: "unauthenticated" | "not_allowlisted" };

/**
 * Viewer gate for the read-only approval pages.
 * A Google session email must be on the existing allowlist.
 * INTERNAL_API_SECRET is intentionally not an input: it cannot view these pages.
 */
export function decideApprovalAccess(input: {
  email: string | null | undefined;
  allowlist?: string;
}): ApprovalAccess {
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!email) return { ok: false, reason: "unauthenticated" };
  if (!isEmailAllowed(email, input.allowlist)) return { ok: false, reason: "not_allowlisted" };
  return { ok: true, email };
}

export function fixturePreviewEnabled(
  env: { NODE_ENV?: string; APPROVAL_VIEW_FIXTURES?: string } = process.env,
) {
  return env.NODE_ENV !== "production" && env.APPROVAL_VIEW_FIXTURES === "1";
}

export async function readApprovalViewer(): Promise<ApprovalAccess> {
  const session = await getServerSession(authOptions);
  return decideApprovalAccess({ email: session?.user?.email });
}
