import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseHermesStatusResult } from "../src/lib/hermes-status-result";

const normalStatus = `
Hermes Agent Status

◆ Environment
│ Project:      /srv/hermes
│ Python:       3.12.8
│ .env file:    ✓ loaded
│ Model:        gpt-5.6-sol
│ Provider:     OpenAI Codex

◆ Terminal Backend
│ Backend:      local
│ Sudo:         ✗ disabled

◆ Gateway Service
│ Status:       ✓ running
│ Manager:      docker (foreground)
│ PID(s):       391

◆ Scheduled Jobs
│ Jobs:         14 active, 15 total

◆ Sessions
│ Active:       1 session(s)
│ Last activity: 4h ago

◆ API Keys
│ Anthropic:    ✗ not configured
│ OpenAI:       ✗ not configured
`;

test("parses a representative Hermes 0.20 status result", () => {
  const parsed = parseHermesStatusResult(normalStatus);

  assert.equal(parsed.model, "gpt-5.6-sol");
  assert.equal(parsed.provider, "OpenAI Codex");
  assert.deepEqual(parsed.gateway, {
    status: "running",
    running: true,
    manager: "docker (foreground)",
  });
  assert.deepEqual(parsed.terminal, { backend: "local", sudoEnabled: false });
  assert.deepEqual(parsed.jobs, { active: 14, total: 15 });
  assert.deepEqual(parsed.sessions, { active: 1, lastActivity: "4h ago" });
  assert.equal(parsed.python, "3.12.8");
  assert.equal(parsed.raw, normalStatus);
});

test("missing sections return stable null fields without throwing", () => {
  assert.doesNotThrow(() => parseHermesStatusResult("Hermes Agent Status\n"));
  assert.deepEqual(parseHermesStatusResult("Hermes Agent Status\n"), {
    model: null,
    provider: null,
    gateway: { status: null, running: null, manager: null },
    terminal: { backend: null, sudoEnabled: null },
    jobs: { active: null, total: null },
    sessions: { active: null, lastActivity: null },
    python: null,
    raw: "Hermes Agent Status\n",
  });
});

test("gateway state distinguishes stopped and unknown values", () => {
  const stopped = parseHermesStatusResult(`◆ Gateway Service\n  Status: stopped`);
  const unknown = parseHermesStatusResult(`◆ Gateway Service\n  Status: checking`);

  assert.equal(stopped.gateway.running, false);
  assert.equal(unknown.gateway.running, null);
});

test("gateway parsing is scoped to the Gateway Service section", () => {
  const parsed = parseHermesStatusResult(`
◆ Gateway Service
  Manager: systemd

◆ Auth Providers
  OAuth status: running

◆ Messaging Platforms
  Gateway: running
`);

  assert.equal(parsed.gateway.status, null);
  assert.equal(parsed.gateway.running, null);
  assert.equal(parsed.gateway.manager, "systemd");
});

test("unused providers do not alter an explicit healthy gateway state", () => {
  const parsed = parseHermesStatusResult(normalStatus);

  assert.equal(parsed.gateway.running, true);
  assert.equal("healthy" in parsed, false);
});

const dispatchSource = readFileSync(
  new URL("../src/components/hermes-dispatches.tsx", import.meta.url),
  "utf8",
);

test("only completed diagnostic.status results use the diagnostic renderer", () => {
  assert.match(
    dispatchSource,
    /r\.kind === "diagnostic\.status" && r\.status === "done" && r\.result/,
  );
  assert.match(dispatchSource, /<DiagnosticStatusResult result=\{r\.result\} \/>/);
});

test("generic dispatch results retain the existing text renderer", () => {
  assert.match(dispatchSource, /\(r\.result \|\| r\.error\) &&/);
  assert.match(dispatchSource, /\{r\.error \|\| r\.result\}/);
});

test("raw diagnostic output uses a collapsed, escaped disclosure", () => {
  assert.match(dispatchSource, /<details className=/);
  assert.doesNotMatch(dispatchSource, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.match(dispatchSource, /Show raw output/);
  assert.match(dispatchSource, /<pre className=/);
  assert.match(dispatchSource, /\{status\.raw\}/);
  assert.doesNotMatch(dispatchSource, /dangerouslySetInnerHTML/);
});
