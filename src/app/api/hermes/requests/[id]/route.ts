import { NextResponse } from "next/server";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withHermesServiceUnavailable(async () => {
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const action = (b.action || "").toString(); // approve | reject | edit
    const existing = await prisma.agentRequest.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!["awaiting_approval", "queued"].includes(existing.status))
      return NextResponse.json({ error: `cannot decide a ${existing.status} request` }, { status: 409 });

    const data: Record<string, unknown> = { decidedAt: new Date() };
    if (action === "approve") data.status = "approved";
    else if (action === "reject") data.status = "rejected";
    else if (action === "edit") { data.status = "approved"; if (b.prompt) data.prompt = b.prompt.toString(); if (b.title) data.title = b.title.toString().slice(0, 200); }
    else return NextResponse.json({ error: "action must be approve|reject|edit" }, { status: 400 });

    const row = await prisma.agentRequest.update({ where: { id }, data });
    return NextResponse.json({ request: row });
  });
}
