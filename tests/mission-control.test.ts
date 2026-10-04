import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAttention,
  summarizeProject,
  validProjectId,
  type ProjectRow,
} from "../src/lib/mission-control";
import { classifyRouteAccess, decideProxyAccess } from "../src/lib/route-policy";

const NOW = Date.parse("2026-10-03T12:00:00Z");

function row(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "rigspecs",
    name: "RigSpecs",
    boards: ["rigspecs-production-integrity"],
    reconcileMode: "preview",
    lastReconciledAt: new Date(NOW - 60_000),
    state: {
      launch: {
        integrity_locked_current: 3,
        integrity_locked_target: 10,
        batch_status: "WAITING_APPROVAL",
        indexing_status: "BLOCKED",
        pending_approvals: 1,
        critical_blockers: ["Approval B: reconciliation required"],
      },
      milestones: [{ id: "approval-b", name: "Approval B", status: "RECONCILIATION_REQUIRED", evidenceId: "sha256:x" }],
      reconciliation: { counts: { kanban_only: 39 }, required: 10, safeRepairs: 0, orphanReceipts: 10 },
    },
    ...overrides,
  };
}

test("project summary passes through derived state without re-deriving it", () => {
  const summary = summarizeProject(row(), NOW);
  assert.equal(summary.path, "/hermes/projects/rigspecs");
  assert.equal(summary.launch?.integrity_locked_current, 3);
  assert.deepEqual(summary.milestones, [{ id: "approval-b", name: "Approval B", status: "RECONCILIATION_REQUIRED" }]);
  assert.equal(summary.reconciliation.required, 10);
  assert.equal(summary.reconciliationStale, false);
  assert.match(summary.nextAutomaticAction, /no Kanban writes/);
});

test("attention lists blockers, reconciliation, approvals and staleness", () => {
  const items = projectAttention(row(), NOW);
  assert.deepEqual(items.map((item) => item.severity), ["critical", "warning", "warning"]);
  const stale = projectAttention(row({ lastReconciledAt: new Date(NOW - 60 * 60_000) }), NOW);
  assert.ok(stale.some((item) => item.id === "reconciliation-stale"));
  const never = projectAttention(row({ lastReconciledAt: null, state: {} }), NOW);
  assert.deepEqual(never.map((item) => item.id), ["reconciliation-stale"]);
});

test("malformed state degrades to empty summaries", () => {
  const summary = summarizeProject(row({ state: "garbage" }), NOW);
  assert.equal(summary.launch, null);
  assert.deepEqual(summary.milestones, []);
});

test("project ids are validated before any query", () => {
  assert.equal(validProjectId("rigspecs"), true);
  for (const bad of ["", "../x", "RigSpecs", "a b", null]) assert.equal(validProjectId(bad), false);
});

test("Mission Control state APIs require authentication like the Hermes APIs", () => {
  for (const pathname of ["/api/mc/overview", "/api/mc/projects/rigspecs", "/api/mc/reconciliation"]) {
    const route = classifyRouteAccess(pathname, "");
    assert.equal(route.kind, "module-api", pathname);
    const noAuth = { isDevelopment: false, hasInternalSecret: false, isAuthenticated: false };
    assert.equal(decideProxyAccess(route, noAuth), "unauthorized");
    assert.equal(decideProxyAccess(route, { ...noAuth, hasInternalSecret: true }), "allow");
  }
  assert.equal(classifyRouteAccess("/hermes/projects/rigspecs", "").kind, "module-page");
});
