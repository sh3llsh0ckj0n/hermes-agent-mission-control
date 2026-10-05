/*
 * Board identity for Mission Control's Hermes task surfaces.
 *
 * Kanban task ids are only unique within a board. The mirrored HermesTask
 * table (and every action built on it) belongs to exactly one board: the
 * bridge's primary board. Other boards are visible read-only through the
 * reconciliation state (McTaskState, keyed by board + task id).
 *
 * The primary board is server configuration (HERMES_PRIMARY_BOARD, default
 * "default"), matching the bridge's HERMES_BOARD. It is never taken from a
 * request or from data rows.
 */

export const BOARD_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DEFAULT_PRIMARY_BOARD = "default";

export function isBoardSlug(value: unknown): value is string {
  return typeof value === "string" && BOARD_SLUG_PATTERN.test(value);
}

/** The board whose tasks are mirrored and actionable. Invalid config fails closed to the default. */
export function resolvePrimaryBoard(env: Record<string, string | undefined> = process.env): string {
  const configured = env.HERMES_PRIMARY_BOARD?.trim().toLowerCase();
  return configured && isBoardSlug(configured) ? configured : DEFAULT_PRIMARY_BOARD;
}

export type BoardSelection =
  | { kind: "primary"; board: string }
  | { kind: "other"; board: string }
  | { kind: "invalid" };

/** Interpret an optional `?board=` filter relative to the primary board. */
export function selectBoard(raw: string | null, primary: string): BoardSelection {
  if (raw === null || raw.trim() === "") return { kind: "primary", board: primary };
  const board = raw.trim().toLowerCase();
  if (!isBoardSlug(board)) return { kind: "invalid" };
  return board === primary ? { kind: "primary", board } : { kind: "other", board };
}
