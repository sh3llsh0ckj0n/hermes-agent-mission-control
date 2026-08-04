import assert from "node:assert/strict";
import test from "node:test";

import { CLAIM_REQUESTS_SQL, claimRequests } from "../lib/queue.mjs";

function createPool(rows) {
  const available = [...rows];
  const calls = [];
  return {
    calls,
    async connect() {
      return {
        async query(text, params) {
          calls.push({ text, params });
          if (text === CLAIM_REQUESTS_SQL) {
            const row = available.shift();
            return { rows: row ? [row] : [] };
          }
          return { rows: [] };
        },
        release() {
          calls.push({ text: "RELEASE" });
        },
      };
    },
  };
}

test("queue claiming uses one row-locking UPDATE RETURNING statement", () => {
  assert.match(CLAIM_REQUESTS_SQL, /FOR UPDATE SKIP LOCKED/i);
  assert.match(CLAIM_REQUESTS_SQL, /UPDATE "AgentRequest"/i);
  assert.match(CLAIM_REQUESTS_SQL, /RETURNING request\.\*/i);
  assert.match(CLAIM_REQUESTS_SQL, /ORDER BY "createdAt" ASC, id ASC/i);
  assert.match(CLAIM_REQUESTS_SQL, /"startedAt" = now\(\)/i);
  assert.doesNotMatch(CLAIM_REQUESTS_SQL, /awaiting_approval|rejected|done|failed/);
});

test("concurrent claim calls receive disjoint request rows from an atomic query", async () => {
  const pool = createPool([
    { id: "first", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "second", createdAt: "2026-01-01T00:00:01.000Z" },
  ]);

  const [left, right] = await Promise.all([
    claimRequests(pool, { batchSize: 1 }),
    claimRequests(pool, { batchSize: 1 }),
  ]);

  assert.deepEqual(
    new Set([left[0].id, right[0].id]),
    new Set(["first", "second"]),
  );
  const claimCalls = pool.calls.filter((call) => call.text === CLAIM_REQUESTS_SQL);
  assert.equal(claimCalls.length, 2);
  for (const call of claimCalls) {
    const [safeKinds, approvedKinds, limit] = call.params;
    assert.deepEqual(safeKinds, ["briefing.generate"]);
    assert.ok(approvedKinds.includes("oneshot"));
    assert.ok(approvedKinds.includes("memory.write"));
    assert.ok(approvedKinds.includes("cron.remove"));
    assert.equal(limit, 1);
  }
});

test("queue claim rolls back and releases its client after query failure", async () => {
  const calls = [];
  const pool = {
    async connect() {
      return {
        async query(text) {
          calls.push(text);
          if (text === CLAIM_REQUESTS_SQL) throw new Error("database unavailable");
          return { rows: [] };
        },
        release() {
          calls.push("RELEASE");
        },
      };
    },
  };

  await assert.rejects(claimRequests(pool), /database unavailable/);
  assert.deepEqual(calls, ["BEGIN", CLAIM_REQUESTS_SQL, "ROLLBACK", "RELEASE"]);
});
