import { NextResponse } from "next/server";
import { buildHermesRequestData } from "@/lib/hermes-request";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withHermesServiceUnavailable(async () => {
    const row = await prisma.dataStore.findUnique({ where: { key: "hermes-briefing" } });
    return NextResponse.json(row?.data ?? { generatedAt: null, summary: null, sections: [] });
  });
}

// POST → ask the bridge to (re)generate the chief-of-staff brief now.
export async function POST() {
  return withHermesServiceUnavailable(async () => {
    const row = await prisma.agentRequest.create({
      data: buildHermesRequestData({
        kind: "briefing.generate",
        title: "Generate chief-of-staff brief",
        prompt: "now",
      }),
    });
    return NextResponse.json({ request: row });
  });
}
