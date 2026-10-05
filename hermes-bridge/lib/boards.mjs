import { ValidationError } from "./errors.mjs";
import { normalizeBoardSlug } from "./kanban-reader.mjs";

const MAX_BOARDS = 16;

/**
 * The boards the bridge is allowed to read, from configuration only.
 *
 * `HERMES_BOARDS` is a comma-separated allowlist. When it is unset the bridge
 * keeps its original single-board behaviour from `HERMES_BOARD`, so existing
 * deployments mirror exactly what they mirrored before.
 *
 * `HERMES_KANBAN_DB` points at one database file, so it cannot serve more than
 * one board; combining it with several boards would silently merge them.
 */
export function resolveBoardAllowlist(env = process.env) {
  const raw = String(env.HERMES_BOARDS ?? "").trim();
  const source = raw ? raw.split(",") : [env.HERMES_BOARD || "default"];

  const boards = [];
  for (const entry of source) {
    if (!entry.trim()) continue;
    const slug = normalizeBoardSlug(entry);
    if (!boards.includes(slug)) boards.push(slug);
  }

  if (!boards.length) throw new ValidationError("HERMES_BOARDS must name at least one board");
  if (boards.length > MAX_BOARDS) {
    throw new ValidationError(`HERMES_BOARDS allows at most ${MAX_BOARDS} boards`);
  }
  if (boards.length > 1 && String(env.HERMES_KANBAN_DB ?? "").trim()) {
    throw new ValidationError("HERMES_KANBAN_DB cannot be combined with more than one board");
  }
  return Object.freeze(boards);
}

/**
 * The bridge's board roles. Only the primary board (HERMES_BOARD) is mirrored
 * into HermesTask and is actionable; HermesTask is keyed by Kanban id alone,
 * and ids are only unique within a board. Every other allowlisted board is
 * read for reconciliation only (McTaskState is keyed by board + id).
 */
export function resolveBridgeBoards(env = process.env) {
  const primary = normalizeBoardSlug(env.HERMES_BOARD || "default");
  const allowlist = resolveBoardAllowlist(env);
  return Object.freeze({
    primary,
    mirror: Object.freeze([primary]),
    readable: Object.freeze(allowlist.includes(primary) ? [...allowlist] : [primary, ...allowlist]),
  });
}

/** Qualified task identity: board slug + Hermes task id. Unique across boards. */
export function qualifiedTaskId(board, kanbanId) {
  return `${normalizeBoardSlug(board)}/${String(kanbanId)}`;
}

export function parseQualifiedTaskId(value) {
  const match = /^([a-z0-9][a-z0-9_-]{0,63})\/([A-Za-z0-9_.-]{1,128})$/.exec(String(value ?? ""));
  if (!match) throw new ValidationError(`Invalid qualified task id: ${String(value).slice(0, 80)}`);
  return { board: match[1], kanbanId: match[2] };
}
