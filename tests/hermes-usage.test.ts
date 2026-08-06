import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  modelTokenPercentage,
  normalizeHermesUsageReport,
} from "../src/lib/dashboard";

const runsSource = readFileSync(
  new URL("../src/components/hermes-runs.tsx", import.meta.url),
  "utf8",
);

test("usage API normalization returns a stable null shape without fabricating zeros", () => {
  assert.deepEqual(normalizeHermesUsageReport(null), {
    period: { label: null, start: null, end: null, days: null },
    totalSessions: null,
    totalMessages: null,
    userMessages: null,
    toolCalls: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    totalCost: null,
    byModel: [],
    syncedAt: null,
    raw: null,
  });
});

test("legacy summary records become diagnostic raw output with null metrics", () => {
  const normalized = normalizeHermesUsageReport({
    summary: "legacy terminal report",
    syncedAt: "2026-08-05T12:34:56.000Z",
  });

  assert.equal(normalized.raw, "legacy terminal report");
  assert.equal(normalized.syncedAt, "2026-08-05T12:34:56.000Z");
  assert.equal(normalized.totalSessions, null);
  assert.equal(normalized.totalTokens, null);
  assert.equal(normalized.totalCost, null);
});

test("usage normalization preserves only explicitly structured partial metrics", () => {
  const normalized = normalizeHermesUsageReport({
    period: { label: "Last 7 days", days: 7 },
    totalSessions: 12,
    totalMessages: "34",
    byModel: [
      { model: "model-a", sessions: 8, tokens: 1_200 },
      { model: "", sessions: 4, tokens: 500 },
    ],
    totalCost: null,
  });

  assert.equal(normalized.period.label, "Last 7 days");
  assert.equal(normalized.period.days, 7);
  assert.equal(normalized.totalSessions, 12);
  assert.equal(normalized.totalMessages, null);
  assert.equal(normalized.totalCost, null);
  assert.deepEqual(normalized.byModel, [
    { model: "model-a", sessions: 8, tokens: 1_200 },
  ]);
});

test("model token percentages fail closed for zero or unavailable totals", () => {
  assert.equal(modelTokenPercentage(500, 1_000), 50);
  assert.equal(modelTokenPercentage(0, 1_000), 0);
  assert.equal(modelTokenPercentage(500, 0), null);
  assert.equal(modelTokenPercentage(null, 1_000), null);
});

test("Runs usage markup keeps raw output out of the primary panel content", () => {
  assert.doesNotMatch(runsSource, /cost\.summary/);
  assert.match(runsSource, /label="Sessions"/);
  assert.match(runsSource, /label="Messages"/);
  assert.match(runsSource, /label="Tool calls"/);
  assert.match(runsSource, /label="Total tokens"/);

  const disclosure = runsSource.match(/<details[\s\S]*?<\/details>/);
  assert.ok(disclosure);
  assert.doesNotMatch(disclosure[0], /<details[^>]*\bopen\b/);
  assert.match(disclosure[0], /Raw Hermes insights/);
  assert.match(disclosure[0], /\{raw\}/);

  const withoutDisclosure = runsSource.replace(disclosure[0], "");
  assert.doesNotMatch(withoutDisclosure, /\{raw\}/);
});
