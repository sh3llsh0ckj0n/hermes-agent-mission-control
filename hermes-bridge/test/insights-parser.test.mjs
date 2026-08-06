import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHermesInsights,
  sanitizeInsightsOutput,
} from "../lib/insights-parser.mjs";

const INSIGHTS_FIXTURE = `\u001b[36m╭──────────────────── Hermes Insights ────────────────────╮\u001b[0m
│ 📅 Reporting period: Last 7 days (2026-07-30 to 2026-08-05) │
├──────────────────────────┬───────────────────────────────┤
│ Sessions          1,234  │ Messages              5,678  │
│ User messages     2,345  │ Tool calls            1,111  │
│ Input tokens  1,200,000  │ Output tokens        345,678  │
│ Total tokens  1,545,678  │ Active days                7  │
├──────────────────────────┴───────────────────────────────┤
│ Model usage                                              │
├────────────────────────────────┬──────────┬──────────────┤
│ Model                          │ Sessions │ Tokens       │
├────────────────────────────────┼──────────┼──────────────┤
│ anthropic/claude-sonnet-4      │      900 │    1,200,000 │
│ openai/gpt-5                   │      334 │      345,678 │
├────────────────────────────────┴──────────┴──────────────┤
│ Peak hours: 14                                          │
╰──────────────────────────────────────────────────────────╯`;

test("parser extracts comma-formatted totals and period fields", () => {
  const parsed = parseHermesInsights(INSIGHTS_FIXTURE);

  assert.deepEqual(parsed.period, {
    label: "Last 7 days (2026-07-30 to 2026-08-05)",
    start: "2026-07-30",
    end: "2026-08-05",
    days: 7,
  });
  assert.equal(parsed.totalSessions, 1_234);
  assert.equal(parsed.totalMessages, 5_678);
  assert.equal(parsed.userMessages, 2_345);
  assert.equal(parsed.toolCalls, 1_111);
  assert.equal(parsed.inputTokens, 1_200_000);
  assert.equal(parsed.outputTokens, 345_678);
  assert.equal(parsed.totalTokens, 1_545_678);
  assert.equal(parsed.totalCost, null);
});

test("parser extracts multiple explicitly labeled model rows", () => {
  const parsed = parseHermesInsights(INSIGHTS_FIXTURE);

  assert.deepEqual(parsed.byModel, [
    {
      model: "anthropic/claude-sonnet-4",
      sessions: 900,
      tokens: 1_200_000,
    },
    {
      model: "openai/gpt-5",
      sessions: 334,
      tokens: 345_678,
    },
  ]);
});

test("parser removes terminal controls and tolerates box-formatted output", () => {
  const sanitized = sanitizeInsightsOutput(INSIGHTS_FIXTURE);

  assert.doesNotMatch(sanitized, /\u001b\[/);
  assert.equal(parseHermesInsights(INSIGHTS_FIXTURE).totalTokens, 1_545_678);
});

test("malformed or incomplete output fails closed without plausible values", () => {
  const parsed = parseHermesInsights(`Peak hours: 14
Active days: 7
Model usage
unknown model 42
$99.00`);

  assert.deepEqual(parsed, {
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
  });
});
