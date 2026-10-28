import assert from "node:assert/strict";
import test from "node:test";

import { decideApprovalAccess, fixturePreviewEnabled } from "../src/lib/approval-access";

const ALLOW = "owner@example.com, reviewer@example.com";

test("unauthenticated viewers are rejected", () => {
  assert.deepEqual(decideApprovalAccess({ email: null, allowlist: ALLOW }), {
    ok: false,
    reason: "unauthenticated",
  });
  assert.deepEqual(decideApprovalAccess({ email: "   ", allowlist: ALLOW }), {
    ok: false,
    reason: "unauthenticated",
  });
  assert.deepEqual(decideApprovalAccess({ email: undefined, allowlist: ALLOW }), {
    ok: false,
    reason: "unauthenticated",
  });
});

test("authenticated emails outside the allowlist are rejected", () => {
  assert.deepEqual(
    decideApprovalAccess({ email: "intruder@example.com", allowlist: ALLOW }),
    { ok: false, reason: "not_allowlisted" },
  );
});

test("allowlisted Google emails are accepted", () => {
  assert.deepEqual(
    decideApprovalAccess({ email: " Reviewer@Example.com ", allowlist: ALLOW }),
    { ok: true, email: "reviewer@example.com" },
  );
});

test("an empty allowlist fails closed", () => {
  assert.deepEqual(decideApprovalAccess({ email: "owner@example.com", allowlist: "" }), {
    ok: false,
    reason: "not_allowlisted",
  });
});

test("the internal API secret is not an approval viewer credential", () => {
  const decision = decideApprovalAccess({
    email: null,
    allowlist: ALLOW,
  });
  assert.equal(decision.ok, false);
  assert.equal("hasInternalSecret" in decision, false);
});

test("fixture preview cannot be enabled in production", () => {
  assert.equal(
    fixturePreviewEnabled({ NODE_ENV: "production", APPROVAL_VIEW_FIXTURES: "1" }),
    false,
  );
  assert.equal(
    fixturePreviewEnabled({ NODE_ENV: "development", APPROVAL_VIEW_FIXTURES: "1" }),
    true,
  );
  assert.equal(
    fixturePreviewEnabled({ NODE_ENV: "test", APPROVAL_VIEW_FIXTURES: "1" }),
    true,
  );
  assert.equal(fixturePreviewEnabled({ NODE_ENV: "development" }), false);
});
