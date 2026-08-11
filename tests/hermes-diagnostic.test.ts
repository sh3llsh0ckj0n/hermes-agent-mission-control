import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/hermes/page.tsx", import.meta.url),
  "utf8",
);

test("Hermes UI exposes an explicit fixed diagnostic status action", () => {
  const actionSource = pageSource.match(
    /function StatusCheckAction[\s\S]*?\/\/ ── Dispatch bar/,
  );

  assert.ok(actionSource);
  assert.match(actionSource[0], /Run status check/);
  assert.match(actionSource[0], /kind:\s*"diagnostic\.status"/);
  assert.match(actionSource[0], /title:\s*"Hermes status check"/);
  assert.doesNotMatch(actionSource[0], /prompt\s*:/);
});

test("generic free-form dispatch remains an explicit oneshot", () => {
  const dispatchSource = pageSource.match(
    /function DispatchBar[\s\S]*?\/\/ ── Approval inbox card/,
  );

  assert.ok(dispatchSource);
  assert.match(dispatchSource[0], /kind:\s*"oneshot"/);
  assert.doesNotMatch(dispatchSource[0], /diagnostic\.status/);
});
