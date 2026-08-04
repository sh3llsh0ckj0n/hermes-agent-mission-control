import { NextResponse } from "next/server";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";
export async function GET() {
  return withHermesServiceUnavailable(async () => {
    const row = await prisma.dataStore.findUnique({ where: { key: "hermes-health" } });
    return NextResponse.json(row?.data ?? { online: false, gateway: "unknown", lastSeen: null });
  });
}
