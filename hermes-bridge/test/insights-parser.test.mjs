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

const HERMES_020_FIXTURE = `Hermes Insights
Last 7 days

Period: Jul 29, 2026 — Aug 05, 2026

Overview
Sessions:          78            Messages:        8,983
Tool calls:        5,108         User messages:   324
Input tokens:      19,392,487    Output tokens:   1,299,497
Total tokens:      261,750,501

Models Used
Model                          Sessions       Tokens
gpt-5.6-sol                          53  252,635,390
kimi-k2.6                             7    5,269,886
gemini-2.5-flash                     19    3,845,225

Platforms
cli                                  78        8,983

Top Tools
terminal                          5,108       99,999

Activity Patterns
Active days: 7

Notable Sessions
Session 42 — 18,500 messages`;

test("parser extracts the Hermes 0.20 plain-text insights format", () => {
  const parsed = parseHermesInsights(HERMES_020_FIXTURE);

  assert.deepEqual(parsed.period, {
    label: "Jul 29, 2026 — Aug 05, 2026",
    start: "2026-07-29",
    end: "2026-08-05",
    days: 7,
  });
  assert.equal(parsed.totalSessions, 78);
  assert.equal(parsed.totalMessages, 8_983);
  assert.equal(parsed.toolCalls, 5_108);
  assert.equal(parsed.userMessages, 324);
  assert.equal(parsed.inputTokens, 19_392_487);
  assert.equal(parsed.outputTokens, 1_299_497);
  assert.equal(parsed.totalTokens, 261_750_501);
  assert.equal(parsed.totalCost, null);
  assert.deepEqual(parsed.byModel, [
    { model: "gpt-5.6-sol", sessions: 53, tokens: 252_635_390 },
    { model: "kimi-k2.6", sessions: 7, tokens: 5_269_886 },
    { model: "gemini-2.5-flash", sessions: 19, tokens: 3_845_225 },
  ]);
});

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

test("later sections cannot become overview totals or model rows", () => {
  const parsed = parseHermesInsights(`Hermes Insights
Overview
Sessions: invalid
Messages: nope

Models Used
Model                          Sessions       Tokens
gpt-5.6-sol                           2        1,000

Platforms
Messages: 7,777
cli                                  99       99,999

Top Tools
fake-model                           88       88,888

Notable Sessions
Total tokens: 123,456,789
Tool calls: 4,321`);

  assert.equal(parsed.totalSessions, null);
  assert.equal(parsed.totalMessages, null);
  assert.equal(parsed.totalTokens, null);
  assert.equal(parsed.toolCalls, null);
  assert.deepEqual(parsed.byModel, [
    { model: "gpt-5.6-sol", sessions: 2, tokens: 1_000 },
  ]);
});

test("malformed metric values and invalid English dates remain null", () => {
  const parsed = parseHermesInsights(`Last seven days
Period: Feb 30, 2026 — Aug 05, 2026
Overview
Sessions: 78x            Messages: 8.5
Input tokens: 19,39,487  Output tokens: unavailable
Total tokens: unknown`);

  assert.deepEqual(parsed.period, {
    label: "Feb 30, 2026 — Aug 05, 2026",
    start: null,
    end: "2026-08-05",
    days: null,
  });
  assert.equal(parsed.totalSessions, null);
  assert.equal(parsed.totalMessages, null);
  assert.equal(parsed.inputTokens, null);
  assert.equal(parsed.outputTokens, null);
  assert.equal(parsed.totalTokens, null);
  assert.equal(parsed.totalCost, null);
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
