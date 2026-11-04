import { createHash, timingSafeEqual } from "node:crypto";

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

/*
 * Ticket-submit token (TICKET_SUBMIT_TOKEN).
 *
 * A dedicated, submit-only bearer credential for an outside router. It is
 * accepted on POST /api/hermes/submit and nowhere else; it is never an
 * alternative to INTERNAL_API_SECRET or a NextAuth session.
 */
export const TICKET_SUBMIT_MIN_TOKEN_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time string comparison (hashing first removes the length leak). */
export function constantTimeEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * The configured submit token, or null when it is unset, too short, or equal
 * to INTERNAL_API_SECRET (a shared value would let one credential act as the
 * other, so the route fails closed instead).
 */
export function resolveTicketSubmitToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const token = env.TICKET_SUBMIT_TOKEN?.trim();
  if (!token || token.length < TICKET_SUBMIT_MIN_TOKEN_LENGTH) return null;
  const internal = env.INTERNAL_API_SECRET?.trim();
  if (internal && constantTimeEqual(token, internal)) return null;
  return token;
}

/** The bearer credential from an Authorization header, or null. */
export function readBearerToken(headers: HeaderReader): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export function hasValidTicketSubmitToken(
  headers: HeaderReader,
  configuredToken: string | null = resolveTicketSubmitToken(),
): boolean {
  if (!configuredToken) return false;
  const provided = readBearerToken(headers);
  return provided !== null && constantTimeEqual(provided, configuredToken);
}
