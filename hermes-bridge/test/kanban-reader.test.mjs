import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  readKanbanTasksReadOnly,
  resolveKanbanDbPath,
  resolveKanbanRoot,
} from "../lib/kanban-reader.mjs";

test("resolves standard and profile Hermes homes to the shared root", () => {
  const homeDir = path.join(path.sep, "home", "jonny");
  const native = path.join(homeDir, ".hermes");
  assert.equal(resolveKanbanRoot({ env: {}, homeDir }), native);
  assert.equal(
    resolveKanbanRoot({ env: { HERMES_HOME: path.join(native, "profiles", "backup") }, homeDir }),
    native,
  );
  assert.equal(
    resolveKanbanRoot({ env: { HERMES_HOME: "/opt/hermes/profiles/backup" }, homeDir }),
    "/opt/hermes",
  );
});

test("resolves default, named-board, and explicit kanban database paths", () => {
  const homeDir = path.join(path.sep, "home", "jonny");
  assert.equal(
    resolveKanbanDbPath({ board: "default", env: {}, homeDir }),
    path.join(homeDir, ".hermes", "kanban.db"),
  );
  assert.equal(
    resolveKanbanDbPath({ board: "RigSpecs-Production", env: {}, homeDir }),
    path.join(homeDir, ".hermes", "kanban", "boards", "rigspecs-production", "kanban.db"),
  );
  assert.equal(
    resolveKanbanDbPath({ board: "default", env: { HERMES_KANBAN_DB: "~/custom.db" }, homeDir }),
    path.join(homeDir, "custom.db"),
  );
});

test("read-only mirror preserves a stuck todo instead of recomputing ready", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kanban-reader-"));
  const dbPath = path.join(root, "kanban.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      assignee TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO tasks (id, title, assignee, status, priority, result, created_at)
    VALUES
      ('t_parent', 'parent', NULL, 'done', 0, NULL, 1),
      ('t_child', 'child', NULL, 'todo', 0, NULL, 2),
      ('t_archived', 'archived', NULL, 'archived', 0, NULL, 3);
  `);
  db.close();

  const tasks = readKanbanTasksReadOnly({
    board: "default",
    env: { HERMES_KANBAN_HOME: root },
    homeDir: root,
  });
  assert.deepEqual(tasks.map((task) => [task.id, task.status]), [
    ["t_parent", "done"],
    ["t_child", "todo"],
  ]);

  const verify = new DatabaseSync(dbPath, { readOnly: true });
  const child = verify.prepare("SELECT status FROM tasks WHERE id = ?").get("t_child");
  verify.close();
  assert.equal(child.status, "todo");

  fs.rmSync(root, { recursive: true, force: true });
});
