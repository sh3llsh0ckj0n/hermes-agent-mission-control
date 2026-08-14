import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { taskBoardEmptyMessage } from "../src/lib/dashboard";

const tasksPagePath = new URL("../src/app/tasks/page.tsx", import.meta.url);
const legacyRoutePath = new URL("../src/app/api/tasks/route.ts", import.meta.url);
const tasksPageSource = readFileSync(tasksPagePath, "utf8");

test("enabled Tasks page reads only the Hermes task endpoint", () => {
  assert.match(tasksPageSource, /["']\/api\/hermes\/tasks["']/);
  assert.doesNotMatch(tasksPageSource, /["']\/api\/tasks["']/);
});

test("Tasks page queues only a title and waits for the mirrored task", () => {
  assert.match(tasksPageSource, /New task/);
  assert.match(tasksPageSource, /method:\s*["']POST["']/);
  assert.match(tasksPageSource, /body:\s*JSON\.stringify\(\{ title: normalizedTitle \}\)/);
  assert.match(tasksPageSource, /Task queued for approval\./);
  assert.match(tasksPageSource, /will not be created until you approve it/);
  assert.match(tasksPageSource, /href=["']\/hermes["']/);
  assert.doesNotMatch(tasksPageSource, /setTaskData\([^)]*normalizedTitle/);
  assert.doesNotMatch(tasksPageSource, /assignee:\s*normalizedTitle|priority:\s*normalizedTitle/);
});

test("Tasks page exposes only state-authorized lifecycle actions", () => {
  assert.match(tasksPageSource, /taskActionsForStatus\(task\.status\)/);
  assert.match(tasksPageSource, /\/api\/hermes\/tasks\/\$\{encodeURIComponent\(task\.id\)\}\/action/);
  assert.match(tasksPageSource, /Queue completion/);
  assert.match(tasksPageSource, /This archives the task\. It does not permanently delete it\./);
  assert.match(tasksPageSource, /Queued for approval/);
  assert.doesNotMatch(tasksPageSource, /--force|--rm/);
});

test("lifecycle submission does not optimistically mutate mirrored task state", () => {
  const editorSource = tasksPageSource.slice(tasksPageSource.indexOf("function TaskActionEditor"));
  assert.doesNotMatch(editorSource, /setTaskData|task\.status\s*=|setTasks/);
  assert.match(editorSource, /will remain unchanged until the request is approved/);
});

test("enabled Tasks page contains no Notion or fabricated-task assumptions", () => {
  assert.doesNotMatch(tasksPageSource, /Synced with Notion/i);
  assert.doesNotMatch(tasksPageSource, /Add Task/i);
  assert.doesNotMatch(tasksPageSource, /Review Polymarket bot strategy/i);
  assert.doesNotMatch(tasksPageSource, /Build Hermy HQ dashboard/i);
  assert.doesNotMatch(tasksPageSource, /Daily brief automation/i);
  assert.equal(existsSync(legacyRoutePath), false);
});

test("empty synchronized task boards render an honest empty state", () => {
  assert.equal(
    taskBoardEmptyMessage({
      connected: true,
      taskCount: 0,
      lastSync: "2026-08-05T12:34:56.000Z",
    }),
    "No tasks yet",
  );
});

test("unsynchronized task boards report that the bridge has not reported", () => {
  assert.equal(
    taskBoardEmptyMessage({
      connected: true,
      taskCount: 0,
      lastSync: null,
    }),
    "Bridge has not reported",
  );
});
