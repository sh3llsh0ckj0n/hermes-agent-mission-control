import { NextResponse } from "next/server";
import {
  getHermesRequestPolicy,
  isUnknownHermesRequestKind,
} from "@/lib/hermes-request";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withHermesServiceUnavailable(async () => {
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const action = (b.action || "").toString(); // approve | reject | edit
    const existing = await prisma.agentRequest.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    let policy;
    try {
      policy = getHermesRequestPolicy(existing.kind);
    } catch (error) {
      if (isUnknownHermesRequestKind(error)) {
        return NextResponse.json({ error: "request kind is not executable" }, { status: 409 });
      }
      throw error;
    }
    const canDecide =
      existing.status === "awaiting_approval" ||
      (existing.status === "queued" && policy.requiresApproval);
    if (!canDecide)
      return NextResponse.json({ error: `cannot decide a ${existing.status} request` }, { status: 409 });

    const data: Record<string, unknown> = {
      decidedAt: new Date(),
      sideEffecting: policy.sideEffecting,
    };
    if (action === "approve") data.status = "approved";
    else if (action === "reject") data.status = "rejected";
    else if (action === "edit") { data.status = "approved"; if (b.prompt) data.prompt = b.prompt.toString(); if (b.title) data.title = b.title.toString().slice(0, 200); }
    else return NextResponse.json({ error: "action must be approve|reject|edit" }, { status: 400 });

    const row = await prisma.agentRequest.update({ where: { id }, data });
    return NextResponse.json({ request: row });
  });
}
