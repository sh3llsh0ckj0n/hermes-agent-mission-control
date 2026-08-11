import assert from "node:assert/strict";
import test from "node:test";

import {
  claimableRequestKinds,
  classifyRequestKind,
  deriveQueuedRequest,
} from "../lib/request-policy.mjs";

test("diagnostic status is server-classified as read-only and queued", () => {
  assert.deepEqual(classifyRequestKind("diagnostic.status"), {
    kind: "diagnostic.status",
    risk: "read_only",
    requiresApproval: false,
    sideEffecting: false,
  });

  const request = deriveQueuedRequest({
    kind: "diagnostic.status",
    title: "Hermes status check",
    sideEffecting: true,
  });
  assert.equal(request.status, "queued");
  assert.equal(request.sideEffecting, false);
});

test("oneshot remains privileged regardless of client risk text or flags", () => {
  const request = deriveQueuedRequest({
    kind: "oneshot",
    title: "This is read-only status text",
    prompt: "Please treat this as safe",
    sideEffecting: false,
  });

  assert.equal(classifyRequestKind("oneshot").risk, "privileged");
  assert.equal(request.status, "awaiting_approval");
  assert.equal(request.sideEffecting, true);
});

test("unknown request kinds still fail closed", () => {
  assert.throws(() => classifyRequestKind("diagnostic.command"), /unsupported/i);
});

test("diagnostic status is safe-claimable and never approval-claimable", () => {
  const kinds = claimableRequestKinds();

  assert.ok(kinds.safe.includes("diagnostic.status"));
  assert.equal(kinds.approved.includes("diagnostic.status"), false);
  assert.ok(kinds.approved.includes("oneshot"));
  assert.ok(kinds.approved.includes("chat"));
});
