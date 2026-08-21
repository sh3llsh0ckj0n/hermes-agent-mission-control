import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { BridgeError, ValidationError } from "./errors.mjs";

const BOARD_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeBoardSlug(value) {
  const slug = String(value ?? "default").trim().toLowerCase();
  if (!BOARD_SLUG.test(slug)) {
    throw new ValidationError(
      "HERMES_BOARD must be 1-64 lowercase alphanumeric, hyphen, or underscore characters",
    );
  }
  return slug;
}

export function resolveKanbanRoot({ env = process.env, homeDir = os.homedir() } = {}) {
  const explicit = String(env.HERMES_KANBAN_HOME ?? "").trim();
  if (explicit) return path.resolve(expandHome(explicit, homeDir));

  const nativeRoot = path.resolve(homeDir, ".hermes");
  const configuredHome = String(env.HERMES_HOME ?? "").trim();
  if (!configuredHome) return nativeRoot;

  const resolvedHome = path.resolve(expandHome(configuredHome, homeDir));
  if (isInside(nativeRoot, resolvedHome)) return nativeRoot;
  if (path.basename(path.dirname(resolvedHome)) === "profiles") {
    return path.dirname(path.dirname(resolvedHome));
  }
  return resolvedHome;
}

export function resolveKanbanDbPath({
  board = "default",
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const override = String(env.HERMES_KANBAN_DB ?? "").trim();
  if (override) return path.resolve(expandHome(override, homeDir));

  const slug = normalizeBoardSlug(board);
  const root = resolveKanbanRoot({ env, homeDir });
  if (slug === "default") return path.join(root, "kanban.db");
  return path.join(root, "kanban", "boards", slug, "kanban.db");
}

export function readKanbanTasksReadOnly({
  board = "default",
  env = process.env,
  homeDir = os.homedir(),
  databaseFactory = (filename) => new DatabaseSync(filename, { readOnly: true }),
} = {}) {
  const filename = resolveKanbanDbPath({ board, env, homeDir });
  if (!fs.existsSync(filename)) {
    throw new BridgeError("hermes_state_read_failure", "Hermes kanban database was not found", {
      retryable: true,
    });
  }

  let database;
  try {
    database = databaseFactory(filename);
    return database.prepare(
      `SELECT id, title, assignee, status, priority, result
       FROM tasks
       WHERE status != 'archived'
       ORDER BY priority DESC, created_at ASC, id ASC`,
    ).all();
  } catch (error) {
    throw new BridgeError(
      "hermes_state_read_failure",
      error?.message || "Could not read Hermes kanban database",
      { retryable: true, cause: error },
    );
  } finally {
    try {
      database?.close();
    } catch {
      // Read-only mirror cleanup is best-effort.
    }
  }
}
