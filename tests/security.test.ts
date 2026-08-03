import assert from "node:assert/strict";
import test from "node:test";
import {
  hasValidBearerSecret,
  hasValidInternalSecret,
  isEmailAllowed,
  parseAllowedEmails,
} from "../src/lib/security";

test("email allowlist parsing normalizes case, whitespace, and empty entries", () => {
  assert.deepEqual(
    parseAllowedEmails(" Owner@Example.com, teammate@example.com ,,"),
    ["owner@example.com", "teammate@example.com"],
  );
});

test("email allowlist locks down empty configuration and matches normalized emails", () => {
  assert.equal(isEmailAllowed("OWNER@example.com", "owner@example.com"), true);
  assert.equal(isEmailAllowed("other@example.com", "owner@example.com"), false);
  assert.equal(isEmailAllowed("owner@example.com", ""), false);
  assert.equal(isEmailAllowed(null, "owner@example.com"), false);
});

test("internal-secret authorization fails closed and accepts only an exact match", () => {
  assert.equal(hasValidInternalSecret(new Headers(), undefined), false);
  assert.equal(
    hasValidInternalSecret(new Headers({ "x-internal-secret": "expected" }), "expected"),
    true,
  );
  assert.equal(
    hasValidInternalSecret(new Headers({ "x-internal-secret": "wrong" }), "expected"),
    false,
  );
});

test("bearer-secret authorization fails closed when configuration is absent", () => {
  assert.equal(hasValidBearerSecret(new Headers({ authorization: "Bearer undefined" }), undefined), false);
  assert.equal(hasValidBearerSecret(new Headers({ authorization: "Bearer expected" }), "expected"), true);
});
