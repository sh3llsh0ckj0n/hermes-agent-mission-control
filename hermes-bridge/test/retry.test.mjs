import assert from "node:assert/strict";
import test from "node:test";

import { BridgeError } from "../lib/errors.mjs";
import { withBoundedRetry } from "../lib/retry.mjs";

test("transient failures retry only to the configured bound", async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    withBoundedRetry(
      async () => {
        attempts += 1;
        throw new BridgeError("timeout", "timed out", { retryable: true });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 10,
        wait: async (delay) => delays.push(delay),
      },
    ),
    /timed out/,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("validation and unsafe-path failures are not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    withBoundedRetry(
      async () => {
        attempts += 1;
        throw new BridgeError("unsafe_path", "rejected", { retryable: false });
      },
      { maxAttempts: 3, wait: async () => {} },
    ),
    /rejected/,
  );
  assert.equal(attempts, 1);
});
