import { NextResponse } from "next/server";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

// POST { kind?, title, prompt?, sideEffecting? } → queue work for Hermes.
// Side-effecting work waits for approval; safe work is queued immediately.
export async function POST(req: Request) {
  return withHermesServiceUnavailable(async () => {
    const b = await req.json().catch(() => ({}));
    const title = (b.title || b.prompt || "").toString().trim();
    if (!title) return NextResponse.json({ error: "title or prompt required" }, { status: 400 });
    const sideEffecting = Boolean(b.sideEffecting);
    const row = await prisma.agentRequest.create({
      data: {
        origin: "web",
        kind: (b.kind || "oneshot").toString(),
        title: title.slice(0, 200),
        prompt: (b.prompt ?? b.title ?? "").toString() || null,
        sideEffecting,
        status: sideEffecting ? "awaiting_approval" : "queued",
      },
    });
    return NextResponse.json({ request: row });
  });
}
