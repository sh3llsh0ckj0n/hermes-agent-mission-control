import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  clearHermesUnavailableCooldown,
  fetchHermesJSON,
} from "../src/lib/hermes-client";
import {
  HERMES_UNAVAILABLE_CODE,
  isHermesServiceUnavailableError,
  withHermesServiceUnavailable,
} from "../src/lib/hermes-service";

test("Prisma initialization failures become a retryable Hermes 503", async () => {
  const error = new Prisma.PrismaClientInitializationError(
    "Authentication failed",
    "test",
  );

  assert.equal(isHermesServiceUnavailableError(error), true);

  const response = await withHermesServiceUnavailable(async () => {
    throw error;
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    code: HERMES_UNAVAILABLE_CODE,
    error: "Hermes service is unavailable",
  });
});

test("unexpected Hermes handler errors remain visible", async () => {
  const error = new Error("unexpected defect");

  await assert.rejects(
    withHermesServiceUnavailable(async () => {
      throw error;
    }),
    error,
  );
});

test("Hermes client observes Retry-After and suppresses repeated unavailable polls", async () => {
  clearHermesUnavailableCooldown();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json(
      { code: HERMES_UNAVAILABLE_CODE },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  };

  try {
    assert.deepEqual(await fetchHermesJSON("/api/hermes/health"), {
      status: "unavailable",
    });
    assert.deepEqual(await fetchHermesJSON("/api/hermes/tasks"), {
      status: "unavailable",
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearHermesUnavailableCooldown();
  }
});

test("unexpected HTTP errors are not placed behind the unavailable cooldown", async () => {
  clearHermesUnavailableCooldown();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({}, { status: 500 });
  };

  try {
    const first = await fetchHermesJSON("/api/hermes/health");
    const second = await fetchHermesJSON("/api/hermes/health");

    assert.equal(first.status, "error");
    assert.equal(second.status, "error");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearHermesUnavailableCooldown();
  }
});
