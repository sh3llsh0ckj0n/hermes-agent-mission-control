import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const HERMES_UNAVAILABLE_CODE = "HERMES_UNAVAILABLE";
export const HERMES_RETRY_AFTER_SECONDS = 30;

export function isHermesServiceUnavailableError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError;
}

export function hermesServiceUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      code: HERMES_UNAVAILABLE_CODE,
      error: "Hermes service is unavailable",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(HERMES_RETRY_AFTER_SECONDS),
      },
    },
  );
}

export async function withHermesServiceUnavailable<T extends Response>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (isHermesServiceUnavailableError(error)) {
      return hermesServiceUnavailableResponse();
    }

    throw error;
  }
}
