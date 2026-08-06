import assert from "node:assert/strict";
import test from "node:test";

import { resolveHermesTasksLastSync } from "../src/lib/hermes-service";

test("empty but successfully synced task boards use the DataStore marker", () => {
  const syncedAt = "2026-08-05T12:34:56.000Z";

  assert.equal(
    resolveHermesTasksLastSync(
      {
        board: "default",
        total: 0,
        syncedAt,
      },
      [],
    ),
    syncedAt,
  );
});

test("task sync resolution keeps the row timestamp fallback without fabricating syncs", () => {
  const fallback = new Date("2026-08-04T10:00:00.000Z");

  assert.equal(resolveHermesTasksLastSync(null, [{ syncedAt: fallback }]), fallback.toISOString());
  assert.equal(resolveHermesTasksLastSync(null, []), null);
  assert.equal(resolveHermesTasksLastSync({ syncedAt: "not-a-date" }, []), null);
});
