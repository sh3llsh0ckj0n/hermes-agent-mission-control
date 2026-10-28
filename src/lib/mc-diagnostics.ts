import { Prisma } from "@prisma/client";

/**
 * Sanitized classifier for Mission Control read failures.
 * Prisma messages, metadata, and stacks can contain SQL and connection
 * strings, so callers may log only the fields returned here.
 *
 * A timeout category means this request's Prisma code was P1008 or P2024.
 * It does not establish the cause of any earlier PalmOS 500.
 */
export type DatabaseFailureCategory = "timeout" | "schema_pending" | "unavailable" | "unknown";

export interface DatabaseFailureClassification {
  category: DatabaseFailureCategory;
  prismaCode: string | null;
}

const TIMEOUT_CODES = new Set(["P1008", "P2024"]);

export function classifyDatabaseFailure(error: unknown): DatabaseFailureClassification {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return { category: "unavailable", prismaCode: null };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021") return { category: "schema_pending", prismaCode: "P2021" };
    if (TIMEOUT_CODES.has(error.code)) return { category: "timeout", prismaCode: error.code };
    return { category: "unknown", prismaCode: error.code };
  }
  return { category: "unknown", prismaCode: null };
}

export function logMissionControlFailure(route: string, error: unknown) {
  const classified = classifyDatabaseFailure(error);
  console.error(
    JSON.stringify({
      event: "mission_control_read_failure",
      route: route.slice(0, 160),
      category: classified.category,
      prismaCode: classified.prismaCode,
    }),
  );
  return classified;
}
