export const REQUIRED_CORE_ENV = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ALLOWED_EMAILS",
  "NEXT_PUBLIC_OWNER_NAME",
  "NEXT_PUBLIC_BASE_URL",
] as const;

type CoreEnvironment = Record<string, string | undefined>;

export function getMissingCoreEnv(environment: CoreEnvironment = process.env): string[] {
  return REQUIRED_CORE_ENV.filter((name) => !environment[name]?.trim());
}

export function validateCoreEnv(environment: CoreEnvironment = process.env): void {
  const missing = getMissingCoreEnv(environment);
  if (missing.length > 0) {
    throw new Error(
      `Missing required core environment variables: ${missing.join(", ")}. ` +
      "Copy .env.example to .env.local and provide real values before running Next.js.",
    );
  }
}
