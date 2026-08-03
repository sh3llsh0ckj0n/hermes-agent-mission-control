type HeaderReader = Pick<Headers, "get">;

export function parseAllowedEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(
  email: string | null | undefined,
  allowlist = process.env.ALLOWED_EMAILS,
): boolean {
  if (!email) return false;
  const allowedEmails = parseAllowedEmails(allowlist);
  return allowedEmails.length > 0 && allowedEmails.includes(email.trim().toLowerCase());
}

export function hasValidInternalSecret(
  headers: HeaderReader,
  configuredSecret = process.env.INTERNAL_API_SECRET,
): boolean {
  if (!configuredSecret) return false;
  const providedSecret = headers.get("x-internal-secret");
  return Boolean(providedSecret) && providedSecret === configuredSecret;
}

export function hasValidBearerSecret(
  headers: HeaderReader,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) return false;
  return headers.get("authorization") === `Bearer ${configuredSecret}`;
}
