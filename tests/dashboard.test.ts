import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_FALLBACKS,
  briefingFallback,
  collectionFallback,
  deriveHermesStatus,
  summarizeTasks,
} from "../src/lib/dashboard";

test("dashboard reports connection failure honestly", () => {
  assert.deepEqual(deriveHermesStatus(null, false), {
    status: "unknown",
    label: "Unknown",
    detail: DASHBOARD_FALLBACKS.notConnected,
  });
  assert.equal(
    collectionFallback({ connected: false, hasData: false }),
    DASHBOARD_FALLBACKS.notConnected,
  );
});

test("dashboard does not infer bridge status before the first report", () => {
  assert.deepEqual(deriveHermesStatus({ online: false, lastSeen: null }, true), {
    status: "unknown",
    label: "Unknown",
    detail: DASHBOARD_FALLBACKS.bridgeNotReported,
  });
  assert.equal(
    collectionFallback({ connected: true, hasData: false, bridgeReported: false }),
    DASHBOARD_FALLBACKS.bridgeNotReported,
  );
});

test("dashboard uses a no-data state for an empty briefing", () => {
  assert.equal(
    briefingFallback({ generatedAt: null, summary: null, sections: [] }, true),
    DASHBOARD_FALLBACKS.noData,
  );
  assert.equal(
    briefingFallback({ generatedAt: "2026-08-03T12:00:00.000Z", summary: "Ready", sections: [] }, true),
    null,
  );
});

test("task overview derives todo, active, and completed counts", () => {
  assert.deepEqual(
    summarizeTasks([
      { id: "1", title: "Plan", status: "todo" },
      { id: "2", title: "Run", status: "in_progress" },
      { id: "3", title: "Review", status: "review" },
      { id: "4", title: "Ship", status: "completed" },
    ]),
    { todo: 1, active: 2, completed: 1 },
  );
});
