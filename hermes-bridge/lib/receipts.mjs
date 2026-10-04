import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UnsafePathError, ValidationError } from "./errors.mjs";

/**
 * Execution receipts: content-addressed, read-only evidence of what happened.
 *
 * A receipt's identity is the SHA-256 of its bytes (`sha256:<hex>`). Receipts
 * are never rewritten; if the bytes change, it is a different receipt, and
 * anything bound to the old id (an approved binding) stops matching.
 *
 * Integrity is reported separately from the receipt's own claims:
 *   verified      — listed in an adjacent integrity manifest and the hash matches
 *   mismatch      — listed, but the hash differs (treated as untrusted)
 *   not-listed    — a manifest exists but does not cover this file
 *   unverified    — no manifest configured
 */

export const RECEIPT_SCHEMA_V1 = "mc-receipt/v1";
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function receiptIdFor(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

/** Resolve a configured path and require it to sit under an allowlisted root. */
export function resolveEvidencePath(value, roots, { homeDir = os.homedir() } = {}) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new UnsafePathError("Evidence path is invalid");
  }
  const resolved = path.resolve(expandHome(value, homeDir));
  const allowed = roots.map((root) => path.resolve(expandHome(root, homeDir)));
  const inside = allowed.some((root) => {
    const relative = path.relative(root, resolved);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  if (!inside) throw new UnsafePathError("Evidence path is outside the allowlisted roots");
  return resolved;
}

const PASS_WORDS = new Set(["PASS", "PASSED", "SUCCESS", "SUCCEEDED", "COMPLETE", "COMPLETED", "CONFIRMED", "OK"]);
const FAIL_WORDS = new Set(["FAIL", "FAILED", "FAILURE", "ERROR", "ABORTED", "ROLLED_BACK"]);

export function normalizeResult(value) {
  const word = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!word) return "UNKNOWN";
  if (PASS_WORDS.has(word)) return "PASS";
  if (FAIL_WORDS.has(word)) return "FAIL";
  if (word === "PARTIAL") return "PARTIAL";
  if (/^(REVIEW_ONLY|NOT_EXECUTED|PREPARED|SEALED|DRAFT)/.test(word)) return "NOT_EXECUTED";
  return "UNKNOWN";
}

function normalizeVerdict(value) {
  const word = String(value ?? "").trim().toUpperCase();
  if (!word) return null;
  if (PASS_WORDS.has(word)) return "PASS";
  if (FAIL_WORDS.has(word)) return "FAIL";
  if (word.startsWith("CONCERN")) return "CONCERNS";
  return word.slice(0, 40);
}

function isoOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstString(object, keys) {
  for (const key of keys) {
    if (typeof object?.[key] === "string" && object[key].trim()) return object[key];
  }
  return null;
}

function parseJsonStatus(text) {
  const parsed = JSON.parse(text);
  // Some query-result receipts are a single-row array.
  const data = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  const rawResult = firstString(data, ["status", "verdict", "overall_status", "result"]);
  return {
    rawResult,
    result: normalizeResult(rawResult),
    qcVerdict: normalizeVerdict(firstString(data, ["qc_verdict", "qcVerdict"])),
    finishedAt: isoOrNull(
      firstString(data, ["finished_at", "finishedAt", "executedAt", "executed_at", "completedAt", "date", "generatedAt"]),
    ),
    actionRequired: data.action_required === true || data.actionRequired === true,
    identity: null,
  };
}

function parseMcReceipt(text) {
  const data = JSON.parse(text);
  if (data?.schema !== RECEIPT_SCHEMA_V1) throw new ValidationError("Not an mc-receipt/v1 document");
  const identity = {};
  for (const key of ["project_id", "task_id", "run_id"]) {
    if (data[key] !== undefined && data[key] !== null) identity[key] = String(data[key]);
  }
  return {
    rawResult: data.result ?? null,
    result: normalizeResult(data.result),
    qcVerdict: normalizeVerdict(data.qc_verdict),
    finishedAt: isoOrNull(data.finished_at),
    actionRequired: data.action_required === true,
    identity: Object.keys(identity).length ? identity : null,
  };
}

function matchLine(text, pattern) {
  const match = pattern.exec(text);
  return match ? match[1].trim() : null;
}

function parseMarkdownReport(text) {
  const overall = matchLine(text, /^\s*\**OVERALL STATUS:?\**\s*:?\s*\**([A-Z_ -]+?)\**\s*$/im);
  const status = matchLine(text, /^\s*\**Status:?\**\s*:?\s*\**([^*\n]+?)\**\s*(?:—|-|$)/im);
  const date =
    matchLine(text, /^\s*\**(?:Date|Deployed|Executed|Finished):?\**\s*:?\s*(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)/im);
  const action = matchLine(text, /action required:?\**\s*:?\s*\**(YES|NO)\b/i);
  return {
    rawResult: overall ?? status,
    result: normalizeResult(overall ?? status),
    qcVerdict: normalizeVerdict(matchLine(text, /^\s*\**QC VERDICT:?\**\s*:?\s*\**([A-Z_]+)/im)),
    finishedAt: isoOrNull(date),
    actionRequired: String(action ?? "").toUpperCase() === "YES",
    identity: null,
  };
}

const PARSERS = Object.freeze({
  "json-status": parseJsonStatus,
  "markdown-report": parseMarkdownReport,
  [RECEIPT_SCHEMA_V1]: parseMcReceipt,
});

export function parseManifest(text) {
  const entries = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) entries.set(match[2].replace(/^\.\//, ""), match[1].toLowerCase());
  }
  return entries;
}

function checkIntegrity(source, filePath, hash, readFile) {
  const method = source.integrity?.method ?? "none";
  if (method === "none") return { integrity: "unverified", method };

  const manifestPath = path.join(path.dirname(filePath), source.integrity.manifest ?? "");
  let manifestText;
  try {
    manifestText = readFile(manifestPath).toString("utf8");
  } catch {
    return { integrity: "unverified", method, note: "manifest missing" };
  }

  if (method === "sha256-file") {
    const expected = manifestText.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (!HEX64.test(expected ?? "")) return { integrity: "unverified", method, note: "manifest unreadable" };
    return { integrity: expected === hash ? "verified" : "mismatch", method };
  }

  if (method === "sha256sums") {
    const expected = parseManifest(manifestText).get(path.basename(filePath));
    if (!expected) return { integrity: "not-listed", method };
    return { integrity: expected === hash ? "verified" : "mismatch", method };
  }

  throw new ValidationError(`Unknown integrity method: ${method}`);
}

/**
 * Load the configured receipt sources. Unreadable or unparseable sources are
 * reported, never silently dropped, so a missing receipt is visible.
 *
 * Duplicate content (the same bytes at two paths) collapses into one receipt
 * with several paths, so processing it twice can never act twice.
 */
export function loadReceipts({
  projectId,
  sources,
  roots,
  homeDir = os.homedir(),
  readFile = (file) => {
    const stat = fs.statSync(file);
    if (stat.size > MAX_RECEIPT_BYTES) throw new ValidationError("Receipt exceeds size limit");
    return fs.readFileSync(file);
  },
}) {
  const receipts = new Map();
  const problems = [];

  for (const source of sources) {
    let filePath;
    try {
      filePath = resolveEvidencePath(source.path, roots, { homeDir });
      const bytes = readFile(filePath);
      const id = receiptIdFor(bytes);
      const parser = PARSERS[source.parser];
      if (!parser) throw new ValidationError(`Unknown receipt parser: ${source.parser}`);
      const parsed = parser(bytes.toString("utf8"));
      // A source may map a project-specific status word explicitly; unmapped
      // words stay UNKNOWN rather than being guessed.
      const mapped = source.result_map?.[String(parsed.rawResult ?? "").trim()];
      if (mapped) parsed.result = normalizeResult(mapped);
      if (source.finished_at && !parsed.finishedAt) parsed.finishedAt = isoOrNull(source.finished_at);
      const integrity = checkIntegrity(source, filePath, id.slice("sha256:".length), readFile);

      const existing = receipts.get(id);
      if (existing) {
        existing.paths = [...new Set([...existing.paths, filePath])].sort();
        continue;
      }
      receipts.set(id, {
        id,
        projectId,
        label: source.label ?? path.basename(filePath),
        kind: source.kind ?? "execution",
        parser: source.parser,
        paths: [filePath],
        ...parsed,
        integrity: integrity.integrity,
        integrityMethod: integrity.method,
        ...(integrity.note ? { integrityNote: integrity.note } : {}),
      });
    } catch (error) {
      problems.push({
        path: filePath ?? String(source.path ?? ""),
        label: source.label ?? null,
        code: error?.code === "ENOENT" ? "missing" : (error?.category ?? error?.name ?? "error"),
      });
    }
  }

  return {
    receipts: [...receipts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    problems: problems.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * The execution metadata a worker should attach when it finishes a Kanban task
 * (`hermes kanban complete --metadata <json>`), so its receipt carries its own
 * identity and never needs a hand-written binding.
 */
export function buildExecutionMetadata({ projectId, taskId, runId = null, receiptBytes = null, receiptPath = null }) {
  if (!projectId || !taskId) throw new ValidationError("projectId and taskId are required");
  return {
    mc_identity: {
      schema: RECEIPT_SCHEMA_V1,
      project_id: String(projectId),
      task_id: String(taskId),
      run_id: runId == null ? null : String(runId),
      receipt_id: receiptBytes ? receiptIdFor(receiptBytes) : null,
      receipt_path: receiptPath,
    },
  };
}
