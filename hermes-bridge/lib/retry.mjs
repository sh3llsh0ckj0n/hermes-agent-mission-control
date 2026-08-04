import { BridgeError } from "./errors.mjs";

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BridgeError("shutdown_interruption", "Bridge is shutting down"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new BridgeError("shutdown_interruption", "Bridge is shutting down"));
      },
      { once: true },
    );
  });
}

export async function withBoundedRetry(operation, {
  maxAttempts = 3,
  baseDelayMs = 250,
  shouldRetry = (error) => Boolean(error?.retryable),
  wait = sleep,
  signal,
  onRetry = () => {},
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new BridgeError(
      "validation_failure",
      "Retry attempts must be an integer between 1 and 5",
    );
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error) || signal?.aborted) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry({ attempt, delayMs, error });
      await wait(delayMs, signal);
    }
  }
  throw lastError;
}
