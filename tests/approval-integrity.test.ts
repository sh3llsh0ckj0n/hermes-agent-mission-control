import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APPROVAL_INTEGRITY_FRESH_LABEL,
  APPROVAL_INTEGRITY_FRESH_MS,
  fixtureApprovalDetail,
  fixtureApprovalIndex,
  presentApproval,
  type ApprovalAssessmentInput,
} from "../src/lib/approval-view";

const NOW = Date.parse("2026-10-28T20:00:00.000Z");
const FRESH = new Date(NOW - 5 * 60 * 1000).toISOString();
const STALE = new Date(NOW - APPROVAL_INTEGRITY_FRESH_MS - 1000).toISOString();
const PIN = "ab".repeat(32);

function input(overrides: Partial<ApprovalAssessmentInput> = {}): ApprovalAssessmentInput {
  return {
    id: "fixture-approval",
    projectId: "fixture-catalog",
    projectName: "Fixture Catalog",
    scope: "Fixture scope",
    requestedAction: "Review the fixture package",
    status: "granted",
    packageSha256: PIN,
    packageMatches: true,
    approver: "fixture-reviewer",
    decidedAt: "2026-10-01T00:00:00.000Z",
    executionBoundary: "Fixture boundary only",
    updatedAt: FRESH,
    lastReconciledAt: FRESH,
    ...overrides,
  };
}

test("freshness threshold is explicit and finite", () => {
  assert.equal(APPROVAL_INTEGRITY_FRESH_MS, 30 * 60 * 1000);
  assert.equal(APPROVAL_INTEGRITY_FRESH_LABEL, "30 minutes");
});

test("granted plus a fresh hash match is the only valid package", () => {
  const view = presentApproval(input(), NOW);
  assert.equal(view.badge, "granted");
  assert.equal(view.verification, "fresh-match");
  assert.equal(view.packageValid, true);
  assert.equal(view.pinnedSha256, PIN);
  assert.match(view.verificationLabel, /30 minutes/);
});

test("granted with a stale hash match is not valid", () => {
  const view = presentApproval(input({ lastReconciledAt: STALE, updatedAt: STALE }), NOW);
  assert.equal(view.recordedStatus, "granted");
  assert.equal(view.verification, "stale-match");
  assert.equal(view.packageValid, false);
  assert.notEqual(view.badge, "granted");
  assert.equal(view.badge, "unavailable");
  assert.match(view.notes.join(" "), /stale/i);
});

test("granted with a hash mismatch is invalidated and not valid", () => {
  const view = presentApproval(input({ packageMatches: false }), NOW);
  assert.equal(view.recordedStatus, "granted");
  assert.equal(view.verification, "mismatch");
  assert.equal(view.packageValid, false);
  assert.equal(view.badge, "invalidated");
});

test("rejected stays rejected even when the hash matches and is fresh", () => {
  const view = presentApproval(input({ status: "rejected" }), NOW);
  assert.equal(view.badge, "rejected");
  assert.equal(view.packageValid, false);
});

test("waiting stays waiting and is not valid", () => {
  const view = presentApproval(input({ status: "waiting", packageMatches: true }), NOW);
  assert.equal(view.badge, "waiting");
  assert.equal(view.packageValid, false);
});

test("missing integrity evidence is unavailable even when the mirror says granted", () => {
  const view = presentApproval(
    input({ packageMatches: null, packageSha256: null, lastReconciledAt: null }),
    NOW,
  );
  assert.equal(view.recordedStatus, "granted");
  assert.equal(view.verification, "unavailable");
  assert.equal(view.badge, "unavailable");
  assert.equal(view.packageValid, false);
});

test("a mirror and ledger snapshot disagreement is not treated as granted", () => {
  const view = presentApproval(
    input({
      ledgerSnapshot: { status: "waiting", packageSha256: PIN, packageMatches: true },
    }),
    NOW,
  );
  assert.equal(view.packageValid, false);
  assert.equal(view.badge, "unavailable");
  assert.equal(view.verification, "unavailable");
  assert.match(view.notes.join(" "), /disagree/i);
});

test("approval language that says grant or create is shown", () => {
  const view = presentApproval(
    input({
      scope: "Fixture grant whose hash match is stale",
      requestedAction: "Enroll and create affiliate links",
    }),
    NOW,
  );
  assert.equal(view.scope, "Fixture grant whose hash match is stale");
  assert.equal(view.requestedAction, "Enroll and create affiliate links");
});

test("filesystem paths and executable SQL are not copied into the view", () => {
  const secretPath = "/home/jonny/hermes/artifacts/package/manifest.json";
  const view = presentApproval(
    input({
      packageId: secretPath,
      requestedAction: "SELECT password FROM users",
      executionBoundary: "~/hermes/run.sh",
      receipts: [
        {
          id: `sha256:${"cd".repeat(32)}`,
          label: "Fixture receipt",
          result: "PASS",
          integrity: "verified",
          finishedAt: FRESH,
          qcVerdict: "PASS",
          paths: [secretPath],
        },
      ],
    }),
    NOW,
  );
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes(secretPath), false);
  assert.equal(serialized.includes("SELECT password"), false);
  assert.equal(serialized.includes("~/hermes"), false);
  assert.equal(serialized.includes("paths"), false);
});

test("fixtures are labeled and cover every required integrity case", () => {
  const index = fixtureApprovalIndex();
  assert.equal(index.fixture, true);
  assert.ok(index.banner);
  assert.match(index.banner, /FIXTURE/);
  assert.match(index.banner, /Black Rhino/);
  const badges = new Map(index.packages.map((item) => [item.id, item]));
  assert.equal(badges.get("fixture-granted-fresh")?.packageValid, true);
  assert.equal(badges.get("fixture-granted-stale")?.verification, "stale-match");
  assert.equal(badges.get("fixture-granted-stale")?.packageValid, false);
  assert.equal(badges.get("fixture-granted-mismatch")?.badge, "invalidated");
  assert.equal(badges.get("fixture-rejected")?.badge, "rejected");
  assert.equal(badges.get("fixture-waiting")?.badge, "waiting");
  assert.equal(badges.get("fixture-unavailable")?.badge, "unavailable");
  assert.equal(fixtureApprovalDetail("fixture-granted-fresh")?.fixture, true);
  assert.equal(fixtureApprovalDetail("not-a-fixture"), null);
});

test("approval package UI does not offer approve or reject actions", () => {
  const source = readFileSync(new URL("../src/components/approval-packages.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']PATCH|["']approve["']|["']reject["']/);
  assert.doesNotMatch(source, /<button/i);
  assert.match(source, /APPROVAL_INTEGRITY_FRESH_LABEL|30 minutes/);
});
