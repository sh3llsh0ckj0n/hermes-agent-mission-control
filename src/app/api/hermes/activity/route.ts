import { NextResponse } from "next/server";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  return withHermesServiceUnavailable(async () => {
    const take = Math.min(Number(new URL(req.url).searchParams.get("take") || 40), 100);
    const events = await prisma.agentEvent.findMany({ orderBy: { createdAt: "desc" }, take });
    return NextResponse.json({ events });
  });
}
