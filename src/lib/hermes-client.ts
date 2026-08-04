export type HermesFetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" }
  | { status: "error"; error: Error };

const DEFAULT_RETRY_AFTER_MS = 30_000;

let unavailableUntil = 0;
let availabilityProbeInFlight = false;

function retryAfterMilliseconds(response: Response): number {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_RETRY_AFTER_MS;
}

export function clearHermesUnavailableCooldown(): void {
  unavailableUntil = 0;
  availabilityProbeInFlight = false;
}

export async function fetchHermesJSON<T>(
  url: string,
): Promise<HermesFetchResult<T>> {
  const now = Date.now();
  if (now < unavailableUntil || (unavailableUntil > 0 && availabilityProbeInFlight)) {
    return { status: "unavailable" };
  }

  const isRecoveryProbe = unavailableUntil > 0;
  if (isRecoveryProbe) availabilityProbeInFlight = true;

  try {
    const response = await fetch(url, { cache: "no-store" });

    if (response.status === 503) {
      unavailableUntil = Date.now() + retryAfterMilliseconds(response);
      return { status: "unavailable" };
    }

    if (!response.ok) {
      return {
        status: "error",
        error: new Error(`Hermes request failed with HTTP ${response.status}`),
      };
    }

    unavailableUntil = 0;
    return { status: "ok", data: (await response.json()) as T };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error : new Error("Hermes request failed"),
    };
  } finally {
    if (isRecoveryProbe) availabilityProbeInFlight = false;
  }
}
