import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGatewayStatus,
  persistKanbanMirror,
} from "../lib/mirror-state.mjs";

test("a successful empty kanban mirror records a sync marker after cleanup", async () => {
  const calls = [];
  const syncedAt = new Date("2026-08-05T12:34:56.000Z");

  const marker = await persistKanbanMirror({
    tasks: [],
    board: "default",
    query: async (text, params) => {
      calls.push({ type: "query", text, params });
    },
    setStore: async (key, data) => {
      calls.push({ type: "store", key, data });
    },
    now: () => syncedAt,
  });

  assert.deepEqual(marker, {
    board: "default",
    total: 0,
    syncedAt: syncedAt.toISOString(),
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /DELETE FROM "HermesTask" WHERE board=\$1/);
  assert.deepEqual(calls[0].params, ["default"]);
  assert.deepEqual(calls[1], {
    type: "store",
    key: "hermes-tasks",
    data: marker,
  });
});

test("multiline Gateway Service running status parses as running", () => {
  const output = `◆ Gateway Service
  Status:       ✓ running
  Manager:      docker (foreground)

◆ Other Service
  Status:       stopped`;

  assert.equal(parseGatewayStatus(output), "running");
});

test("unknown gateway status stays unknown instead of guessing stopped", () => {
  const output = `◆ Gateway Service
  Status:       unavailable
  Manager:      unknown`;

  assert.equal(parseGatewayStatus(output), "unknown");
  assert.equal(parseGatewayStatus("Hermes status unavailable"), "unknown");
});

test("gateway reports stopped only for an explicit negative status", () => {
  assert.equal(
    parseGatewayStatus(`◆ Gateway Service
  Status:       stopped`),
    "stopped",
  );
  assert.equal(
    parseGatewayStatus(`◆ Gateway Service
  Status:       not running`),
    "stopped",
  );
});
