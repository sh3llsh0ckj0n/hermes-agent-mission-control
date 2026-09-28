/**
 * Local calendar date (YYYY-MM-DD) in the host's time zone. The daily brief
 * compares this with the local hour, so both must use the same clock.
 */
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Tracks when each named job last ran so slow-changing mirrors can run less
 * often than the mirror tick. A job that has never run is always due.
 */
export function createIntervalGate({ now = () => Date.now() } = {}) {
  const lastRun = new Map();
  return {
    isDue(name, intervalMs) {
      const previous = lastRun.get(name);
      return previous === undefined || now() - previous >= intervalMs;
    },
    markRun(name) {
      lastRun.set(name, now());
    },
  };
}
