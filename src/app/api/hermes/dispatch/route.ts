import { NextResponse } from "next/server";
import {
  buildHermesRequestData,
  isUnknownHermesRequestKind,
} from "@/lib/hermes-request";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

// POST { kind?, title, prompt? } → classify and queue work for Hermes.
// Client-provided risk flags are intentionally ignored.
export async function POST(req: Request) {
  return withHermesServiceUnavailable(async () => {
    const b = await req.json().catch(() => ({}));
    const title = (b.title || b.prompt || "").toString().trim();
    if (!title) return NextResponse.json({ error: "title or prompt required" }, { status: 400 });
    let data;
    try {
      data = buildHermesRequestData({
        kind: b.kind || "oneshot",
        title: title.slice(0, 200),
        prompt: (b.prompt ?? b.title ?? "").toString() || null,
        sideEffecting: b.sideEffecting,
      });
    } catch (error) {
      if (isUnknownHermesRequestKind(error)) {
        return NextResponse.json({ error: "unsupported Hermes request kind" }, { status: 400 });
      }
      throw error;
    }
    const row = await prisma.agentRequest.create({
      data,
    });
    return NextResponse.json({ request: row });
  });
}
