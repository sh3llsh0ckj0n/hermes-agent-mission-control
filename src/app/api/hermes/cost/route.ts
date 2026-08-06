import { NextResponse } from "next/server";
import { normalizeHermesUsageReport } from "@/lib/dashboard";
import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withHermesServiceUnavailable(async () => {
    const row = await prisma.dataStore.findUnique({ where: { key: "hermes-cost" } });
    return NextResponse.json(normalizeHermesUsageReport(row?.data));
  });
}
