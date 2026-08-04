import { spawn } from "node:child_process";
import path from "node:path";

import { BridgeError, ValidationError, sanitizeErrorMessage } from "./errors.mjs";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function validateArgument(value) {
  if (typeof value !== "string") {
    throw new ValidationError("Command arguments must be strings");
  }
  if (value.includes("\0")) {
    throw new ValidationError("Command arguments cannot contain null bytes");
  }
  return value;
}

export function validateExecutable(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("HERMES_BIN must be a non-empty executable name or path");
  }
  if (/[\0\r\n]/.test(value)) {
    throw new ValidationError("HERMES_BIN contains invalid control characters");
  }
  const trimmed = value.trim();
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return path.resolve(trimmed);
  }
  return trimmed;
}

export function runProcess(executable, args, {
  timeoutMs = 30_000,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  signal,
  spawnImpl = spawn,
  cwd,
} = {}) {
  const safeExecutable = validateExecutable(executable);
  if (!Array.isArray(args)) throw new ValidationError("Command arguments must be an array");
  const safeArgs = args.map(validateArgument);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new ValidationError("Command timeout must be a positive number");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024) {
    throw new ValidationError("Command output limit must be at least 1024 bytes");
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;
    let forceKillTimer = null;
    let timer = null;

    const child = spawnImpl(safeExecutable, safeArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminate = () => {
      child.kill("SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      }
    };
    const onAbort = terminate;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    };

    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > maxOutputBytes) {
        outputExceeded = true;
        terminate();
        return next.slice(0, maxOutputBytes);
      }
      return next;
    };

    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      finish(
        new BridgeError(
          "hermes_cli_failure",
          error.code === "ENOENT"
            ? "Hermes executable was not found"
            : sanitizeErrorMessage(error.message),
          { retryable: error.code !== "ENOENT" },
        ),
      );
    });
    child.on("close", (code, closeSignal) => {
      if (signal?.aborted) {
        finish(
          new BridgeError(
            "shutdown_interruption",
            "Hermes execution interrupted by bridge shutdown",
          ),
        );
      } else if (timedOut) {
        finish(
          new BridgeError("timeout", "Hermes execution exceeded its timeout", {
            retryable: true,
          }),
        );
      } else if (outputExceeded) {
        finish(
          new BridgeError(
            "hermes_cli_failure",
            "Hermes execution exceeded the output limit",
          ),
        );
      } else if (code !== 0) {
        finish(
          new BridgeError(
            "hermes_cli_failure",
            sanitizeErrorMessage(stderr || `Hermes exited with code ${code ?? closeSignal}`),
            { retryable: true },
          ),
        );
      } else {
        finish(null, { stdout, stderr, exitCode: code });
      }
    });

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseVersion(output) {
  const match = String(output).match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export async function checkHermesCompatibility({
  executable,
  run = runProcess,
  minimumVersion = "0.17.0",
  maximumVersionExclusive = "0.21.0",
  signal,
} = {}) {
  const minimum = parseVersion(minimumVersion);
  if (!minimum) throw new ValidationError("HERMES_MIN_VERSION must be a semantic version");
  const maximum = parseVersion(maximumVersionExclusive);
  if (!maximum) {
    throw new ValidationError(
      "HERMES_MAX_VERSION_EXCLUSIVE must be a semantic version",
    );
  }
  if (compareVersions(minimum, maximum) >= 0) {
    throw new ValidationError(
      "HERMES_MIN_VERSION must be lower than HERMES_MAX_VERSION_EXCLUSIVE",
    );
  }

  const result = await run(executable, ["--version"], {
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    signal,
  });
  const version = parseVersion(`${result.stdout}\n${result.stderr}`);
  if (!version) {
    throw new ValidationError("Hermes CLI did not return a recognizable version");
  }

  if (
    compareVersions(version, minimum) < 0 ||
    compareVersions(version, maximum) >= 0
  ) {
    throw new ValidationError(
      `Hermes CLI version ${version.join(".")} is incompatible; supported range is >=${minimumVersion} <${maximumVersionExclusive}`,
    );
  }
  return version.join(".");
}
