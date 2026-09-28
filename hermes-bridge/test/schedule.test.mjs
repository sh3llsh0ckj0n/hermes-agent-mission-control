import assert from "node:assert/strict";
import test from "node:test";

import { createIntervalGate, localDateKey } from "../lib/schedule.mjs";

test("local date key uses the host calendar day, not UTC", () => {
  // 20:04 on Sep 27 in the host zone; toISOString() would roll to Sep 28 in any zone west of UTC.
  const evening = new Date(2026, 8, 27, 20, 4, 0);
  assert.equal(localDateKey(evening), "2026-09-27");
  assert.equal(localDateKey(new Date(2026, 0, 5, 0, 0, 0)), "2026-01-05");
});

test("interval gate runs a job first, then only after its interval", () => {
  let clock = 1_000;
  const gate = createIntervalGate({ now: () => clock });
  assert.equal(gate.isDue("crons", 300_000), true);
  gate.markRun("crons");
  clock += 299_999;
  assert.equal(gate.isDue("crons", 300_000), false);
  clock += 1;
  assert.equal(gate.isDue("crons", 300_000), true);
});

test("interval gate tracks jobs independently", () => {
  let clock = 0;
  const gate = createIntervalGate({ now: () => clock });
  gate.markRun("cost");
  clock = 60_000;
  assert.equal(gate.isDue("cost", 900_000), false);
  assert.equal(gate.isDue("crons", 300_000), true);
});
