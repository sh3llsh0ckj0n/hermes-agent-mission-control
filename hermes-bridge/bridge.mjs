#!/usr/bin/env node
/**
 * Hermes mission-control bridge.
 *
 * The bridge mirrors local Hermes state into PostgreSQL and atomically claims
 * approved work from AgentRequest. It does not expose an inbound network port.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { buildHermesCommand, parseRequestPayload } from "./lib/command-builder.mjs";
import { BridgeError, classifyError, sanitizeErrorMessage, ValidationError } from "./lib/errors.mjs";
import { parseHermesInsights } from "./lib/insights-parser.mjs";
import { createLogger } from "./lib/logger.mjs";
import { parseGatewayStatus, persistKanbanMirror } from "./lib/mirror-state.mjs";
import { checkHermesCompatibility, runProcess, validateExecutable } from "./lib/process-runner.mjs";
import { claimRequests } from "./lib/queue.mjs";
import { classifyRequestKind } from "./lib/request-policy.mjs";
import { withBoundedRetry } from "./lib/retry.mjs";
import { parseDatabaseTransport } from "./lib/tls.mjs";
import { createWikiPathGuard } from "./lib/wiki-path.mjs";

const BRIDGE_VERSION = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;
const MAX_RESULT_BYTES = 8_000;
const MAX_EVENT_DETAIL_BYTES = 400;

function integerEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function createInstanceId() {
  const configured = process.env.BRIDGE_INSTANCE_ID?.trim();
  const generated = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const value = configured || generated;
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(value)) {
    throw new ValidationError(
      "BRIDGE_INSTANCE_ID may contain only letters, numbers, dot, underscore, colon, and hyphen",
    );
  }
  return value;
}

const INSTANCE_ID = createInstanceId();
const log = createLogger({ instanceId: INSTANCE_ID });
const HERMES = validateExecutable(process.env.HERMES_BIN || "hermes");
const BOARD = process.env.HERMES_BOARD || "default";
const POLL_MS = integerEnv("BRIDGE_POLL_MS", 5_000, { min: 250, max: 3_600_000 });
const MIRROR_MS = integerEnv("BRIDGE_MIRROR_MS", 30_000, { min: 1_000, max: 3_600_000 });
const RUN_TIMEOUT_MS = integerEnv("BRIDGE_RUN_TIMEOUT_MS", 240_000, {
  min: 1_000,
  max: 3_600_000,
});
const CLAIM_BATCH_SIZE = integerEnv("BRIDGE_CLAIM_BATCH_SIZE", 1, { min: 1, max: 10 });
const MAX_RETRY_ATTEMPTS = integerEnv("BRIDGE_MAX_RETRY_ATTEMPTS", 3, { min: 1, max: 5 });
const HERMES_MIN_VERSION = process.env.HERMES_MIN_VERSION || "0.17.0";
const HERMES_MAX_VERSION_EXCLUSIVE =
  process.env.HERMES_MAX_VERSION_EXCLUSIVE || "0.21.0";
const WIKI_PATHS = createWikiPathGuard(
  process.env.HERMES_WIKI || path.join(os.homedir(), ".hermes", "wiki"),
);
const BRIEF_HOUR = integerEnv("BRIEF_HOUR", 8, { min: 0, max: 23 });
const BRIEF_PROMPT =
  "You are the operator's chief of staff. Produce today's brief. Read the configured memory wiki, " +
  "the kanban board, and recent activity. Output ONLY valid JSON (no prose, no code fences) in exactly " +
  'this shape: {"greeting":"one warm line","summary":"2-3 sentences on where things stand",' +
  '"sections":[{"label":"Needs your decision","items":["..."]},{"label":"Top priorities","items":["..."]},' +
  '{"label":"Recently shipped","items":["..."]},{"label":"Next actions","items":["..."]}]}. ' +
  "Keep every item short, concrete, and specific. Omit a section if it has nothing.";

const databaseUrl = process.env.DATABASE_URL || "";
const transport = parseDatabaseTransport({
  databaseUrl,
  tlsMode: process.env.BRIDGE_DB_TLS_MODE,
  caFile: process.env.BRIDGE_DB_CA_FILE,
  nodeEnv: process.env.NODE_ENV,
});
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 4,
  ssl: transport.ssl,
  application_name: `hermes-bridge:${INSTANCE_ID}`,
});

const shutdownController = new AbortController();
let lastBriefDate = null;
let shuttingDown = false;
let queueTimer = null;
let mirrorTimer = null;
let activeQueue = null;

async function q(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw new BridgeError(
      "database_failure",
      sanitizeErrorMessage(error?.message || "PostgreSQL operation failed"),
      { retryable: true, cause: error },
    );
  }
}

async function hermes(args, { timeoutMs = 30_000 } = {}) {
  const result = await runProcess(HERMES, args, {
    timeoutMs,
    maxOutputBytes: 1024 * 1024,
    signal: shutdownController.signal,
  });
  return result.stdout;
}

async function emit(kind, title, {
  detail = null,
  agent = "hermes",
  level = "info",
  meta = null,
} = {}) {
  await q(
    `INSERT INTO "AgentEvent" (id, kind, title, detail, agent, level, meta, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [
      randomUUID(),
      kind,
      title.slice(0, 200),
      detail,
      agent,
      level,
      meta ? JSON.stringify(meta) : null,
    ],
  );
}

async function setStore(key, data) {
  await q(
    `INSERT INTO "DataStore" (key, data, "updatedAt") VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, "updatedAt" = now()`,
    [key, JSON.stringify(data)],
  );
}

async function mirrorKanban() {
  let tasks = [];
  try {
    // Supported Hermes releases expect --board before the kanban subcommand.
    const out = await hermes(["kanban", "--board", BOARD, "list", "--json"], {
      timeoutMs: 15_000,
    });
    const parsed = JSON.parse(out || "[]");
    tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
  } catch (error) {
    log("warn", "kanban_mirror_failed", {
      category: classifyError(error).category,
      error: sanitizeErrorMessage(error?.message),
    });
    return;
  }

  await persistKanbanMirror({
    tasks,
    board: BOARD,
    query: q,
    setStore,
  });
}

async function mirrorCrons() {
  try {
    const out = await hermes(["cron", "list", "--all"], { timeoutMs: 15_000 });
    const lines = out.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    await setStore("hermes-crons", {
      jobs: lines,
      raw: out.slice(0, 8_000),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    log("warn", "cron_mirror_failed", {
      category: classifyError(error).category,
      error: sanitizeErrorMessage(error?.message),
    });
  }
}

async function mirrorCost() {
  for (const args of [["insights", "--days", "7"], ["insights"]]) {
    try {
      const out = await hermes(args, { timeoutMs: 15_000 });
      await setStore("hermes-cost", {
        ...parseHermesInsights(out),
        syncedAt: new Date().toISOString(),
        raw: out,
      });
      return;
    } catch {
      // Supported Hermes releases have shipped both argument shapes; try the fallback.
    }
  }
  log("warn", "cost_mirror_failed", { category: "hermes_cli_failure" });
}

async function mirrorHealth() {
  let online = false;
  let gateway = "unknown";
  let detail = "";
  try {
    const out = await hermes(["status"], { timeoutMs: 12_000 });
    detail = out.slice(0, 4_000);
    online = /online|running|connected/i.test(out);
    gateway = parseGatewayStatus(out);
  } catch (error) {
    detail = sanitizeErrorMessage(error?.message);
  }
  await setStore("hermes-health", {
    online,
    gateway,
    detail,
    lastSeen: new Date().toISOString(),
  });
}

function parseEntry(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = {};
  let body = markdown;
  if (match) {
    body = match[2];
    for (const line of match[1].split("\n")) {
      const pair = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!pair) continue;
      const value = pair[2].trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        frontmatter[pair[1]] = value
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      } else {
        frontmatter[pair[1]] = value === "null" || value === "" ? null : value;
      }
    }
  }
  return { frontmatter, body: body.trim() };
}

function walkMarkdown(directory, output = []) {
  let items = [];
  try {
    items = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const item of items) {
    if (item.isSymbolicLink() || item.name === ".git") continue;
    const fullPath = path.join(directory, item.name);
    if (item.isDirectory()) {
      walkMarkdown(fullPath, output);
    } else if (item.name.toLowerCase().endsWith(".md") && item.name !== "INDEX.md") {
      output.push(fullPath);
    }
  }
  return output;
}

async function mirrorWiki() {
  if (!fs.existsSync(WIKI_PATHS.root)) return;
  const seen = new Set();
  for (const discoveredPath of walkMarkdown(WIKI_PATHS.root)) {
    const requestedPath = path.relative(WIKI_PATHS.root, discoveredPath).replaceAll("\\", "/");
    let resolved;
    try {
      resolved = WIKI_PATHS.resolveMarkdownPath(requestedPath, { mustExist: true });
    } catch (error) {
      log("warn", "wiki_path_rejected", {
        category: classifyError(error).category,
        path: requestedPath,
      });
      continue;
    }

    const id = resolved.relativePath.replace(/\.md$/i, "");
    seen.add(id);
    let raw;
    try {
      raw = fs.readFileSync(resolved.absolutePath, "utf8");
    } catch {
      continue;
    }
    const { frontmatter, body } = parseEntry(raw);
    await q(
      `INSERT INTO "HermesMemory" (id, path, type, title, status, confidence, provenance, tags, links, body, "validFrom", "validTo", "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
       ON CONFLICT (id) DO UPDATE SET path=EXCLUDED.path, type=EXCLUDED.type, title=EXCLUDED.title,
         status=EXCLUDED.status, confidence=EXCLUDED.confidence, provenance=EXCLUDED.provenance,
         tags=EXCLUDED.tags, links=EXCLUDED.links, body=EXCLUDED.body,
         "validFrom"=EXCLUDED."validFrom", "validTo"=EXCLUDED."validTo", "syncedAt"=now()`,
      [
        id,
        resolved.relativePath,
        frontmatter.type || "fact",
        frontmatter.title || id,
        frontmatter.status || "active",
        frontmatter.confidence || null,
        frontmatter.provenance || null,
        Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        Array.isArray(frontmatter.links) ? frontmatter.links : [],
        body,
        frontmatter.valid_from || null,
        frontmatter.valid_to || null,
      ],
    );
  }

  if (seen.size) {
    await q(`DELETE FROM "HermesMemory" WHERE id <> ALL($1::text[])`, [[...seen]]);
  } else {
    await q(`DELETE FROM "HermesMemory"`);
  }
}

function frontmatterValue(value, label, maxLength = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength || /[\0\r\n]/.test(normalized)) {
    throw new ValidationError(`${label} is invalid`);
  }
  return normalized;
}

function writeWikiEntry(entry) {
  const id = frontmatterValue(entry.id, "Wiki entry ID");
  const type = frontmatterValue(entry.type || "note", "Wiki entry type", 100);
  const title = frontmatterValue(entry.title, "Wiki entry title");
  const requestedPath = entry.path || `${type}s/${id}.md`;
  const resolved = WIKI_PATHS.resolveMarkdownPath(requestedPath);
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
  WIKI_PATHS.resolveMarkdownPath(resolved.relativePath);

  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((tag) => frontmatterValue(tag, "Wiki tag", 100))
    : [];
  const links = Array.isArray(entry.links)
    ? entry.links.map((link) => frontmatterValue(link, "Wiki link", 500))
    : [];
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    `title: ${title}`,
    `status: ${frontmatterValue(entry.status || "active", "Wiki entry status", 100)}`,
    entry.confidence
      ? `confidence: ${frontmatterValue(entry.confidence, "Wiki confidence", 100)}`
      : null,
    `provenance: ${frontmatterValue(entry.provenance || "dashboard", "Wiki provenance", 200)}`,
    `tags: [${tags.join(", ")}]`,
    `links: [${links.join(", ")}]`,
    `updated: ${now}`,
    "---",
    "",
    String(entry.body || ""),
    "",
  ].filter((line) => line !== null);
  fs.writeFileSync(resolved.absolutePath, lines.join("\n"), {
    encoding: "utf8",
    flag: "w",
  });
  return resolved.relativePath;
}

async function gitCommitWiki(relativePath) {
  const resolved = WIKI_PATHS.resolveMarkdownPath(relativePath, { mustExist: true });
  if (!fs.existsSync(path.join(WIKI_PATHS.root, ".git"))) {
    await runProcess("git", ["-C", WIKI_PATHS.root, "init"], {
      timeoutMs: 15_000,
      maxOutputBytes: 256 * 1024,
      signal: shutdownController.signal,
    });
  }
  await runProcess("git", ["-C", WIKI_PATHS.root, "add", "--", resolved.relativePath], {
    timeoutMs: 15_000,
    maxOutputBytes: 256 * 1024,
    signal: shutdownController.signal,
  });
  await runProcess(
    "git",
    ["-C", WIKI_PATHS.root, "commit", "-m", `wiki: update ${resolved.relativePath} (via dashboard)`],
    {
      timeoutMs: 15_000,
      maxOutputBytes: 256 * 1024,
      signal: shutdownController.signal,
    },
  );
}

async function generateBriefing() {
  const raw = (await hermes(["-z", BRIEF_PROMPT], { timeoutMs: RUN_TIMEOUT_MS })).trim();
  let brief;
  try {
    const jsonText = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const match = jsonText.match(/\{[\s\S]*\}/);
    brief = JSON.parse(match ? match[0] : jsonText);
  } catch {
    brief = { summary: raw.slice(0, 1_500), sections: [] };
  }
  brief.generatedAt = new Date().toISOString();
  await setStore("hermes-briefing", brief);
  await emit("status", "Daily brief generated", { level: "up" });
}

async function maybeDailyBrief() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() >= BRIEF_HOUR && lastBriefDate !== today) {
    lastBriefDate = today;
    try {
      await generateBriefing();
    } catch (error) {
      log("warn", "daily_brief_failed", {
        category: classifyError(error).category,
        error: sanitizeErrorMessage(error?.message),
      });
    }
  }
}

async function executeRequest(request) {
  if (request.kind === "memory.write" || request.kind === "wiki.write") {
    const entry = parseRequestPayload(request);
    const relativePath = writeWikiEntry(entry);
    await gitCommitWiki(relativePath);
    await mirrorWiki();
    return `wrote ${relativePath}`;
  }
  if (request.kind === "briefing.generate") {
    await generateBriefing();
    lastBriefDate = new Date().toISOString().slice(0, 10);
    return "brief updated";
  }

  const command = buildHermesCommand(request, {
    board: BOARD,
    runTimeoutMs: RUN_TIMEOUT_MS,
  });
  const result = (await hermes(command.args, { timeoutMs: command.timeoutMs })).trim();
  if (request.kind.startsWith("cron.")) await mirrorCrons();
  return result;
}

async function runRequest(request) {
  let policy;
  try {
    policy = classifyRequestKind(request.kind);
  } catch (error) {
    await failRequest(request, error);
    return;
  }

  await emit("run", `Started: ${request.title}`, {
    level: "info",
    meta: {
      requestId: request.id,
      kind: policy.kind,
      risk: policy.risk,
      bridgeInstanceId: INSTANCE_ID,
    },
  });
  log("info", "request_started", {
    requestId: request.id,
    kind: policy.kind,
    risk: policy.risk,
  });

  try {
    const maxAttempts = policy.risk === "read_only" ? MAX_RETRY_ATTEMPTS : 1;
    const result = await withBoundedRetry(
      () => executeRequest(request),
      {
        maxAttempts,
        signal: shutdownController.signal,
        shouldRetry: (error) =>
          policy.risk === "read_only" &&
          ["hermes_cli_failure", "timeout"].includes(classifyError(error).category),
        onRetry: ({ attempt, delayMs, error }) => {
          log("warn", "request_retry_scheduled", {
            requestId: request.id,
            attempt,
            delayMs,
            category: classifyError(error).category,
          });
        },
      },
    );
    await q(
      `UPDATE "AgentRequest"
       SET status='done', result=$2, error=NULL, "finishedAt"=now(), "updatedAt"=now()
       WHERE id=$1 AND status='running'`,
      [request.id, String(result).slice(0, MAX_RESULT_BYTES)],
    );
    await emit("run", `Done: ${request.title}`, {
      level: "up",
      detail: String(result).slice(0, MAX_EVENT_DETAIL_BYTES),
      meta: { requestId: request.id, bridgeInstanceId: INSTANCE_ID },
    });
    log("info", "request_completed", { requestId: request.id });
  } catch (error) {
    await failRequest(request, error);
  }
}

async function failRequest(request, error) {
  const classified = classifyError(error);
  const message = sanitizeErrorMessage(classified.message);
  try {
    await q(
      `UPDATE "AgentRequest"
       SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now()
       WHERE id=$1 AND status='running'`,
      [request.id, `${classified.category}: ${message}`.slice(0, 600)],
    );
    await emit("run", `Failed: ${request.title}`, {
      level: "down",
      detail: message,
      meta: {
        requestId: request.id,
        category: classified.category,
        bridgeInstanceId: INSTANCE_ID,
      },
    });
  } catch (databaseError) {
    log("error", "request_failure_record_failed", {
      requestId: request.id,
      category: "database_failure",
      error: sanitizeErrorMessage(databaseError?.message),
    });
  }
  log("error", "request_failed", {
    requestId: request.id,
    category: classified.category,
    error: message,
  });
}

async function processQueue() {
  const requests = await claimRequests(pool, { batchSize: CLAIM_BATCH_SIZE });
  for (const request of requests) {
    if (shuttingDown) {
      await failRequest(
        request,
        new BridgeError(
          "shutdown_interruption",
          "Request was claimed while the bridge was shutting down",
        ),
      );
      continue;
    }
    await runRequest(request);
  }
}

async function mirrorTick() {
  const mirrors = [
    ["kanban", mirrorKanban],
    ["crons", mirrorCrons],
    ["health", mirrorHealth],
    ["wiki", mirrorWiki],
    ["cost", mirrorCost],
    ["briefing", maybeDailyBrief],
  ];
  for (const [name, mirror] of mirrors) {
    if (shuttingDown) return;
    try {
      await mirror();
    } catch (error) {
      log("error", "mirror_failed", {
        mirror: name,
        category: "database_failure",
        error: sanitizeErrorMessage(error?.message),
      });
    }
  }
}

function scheduleQueue(delay = POLL_MS) {
  if (shuttingDown) return;
  queueTimer = setTimeout(async () => {
    activeQueue = processQueue();
    try {
      await activeQueue;
    } catch (error) {
      log("error", "queue_poll_failed", {
        category: "database_failure",
        error: sanitizeErrorMessage(error?.message),
      });
    } finally {
      activeQueue = null;
      scheduleQueue();
    }
  }, delay);
}

function scheduleMirror(delay = MIRROR_MS) {
  if (shuttingDown) return;
  mirrorTimer = setTimeout(async () => {
    try {
      await mirrorTick();
    } finally {
      scheduleMirror();
    }
  }, delay);
}

async function shutdown(signalName) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(queueTimer);
  clearTimeout(mirrorTimer);
  shutdownController.abort();
  log("info", "bridge_shutdown_started", { signal: signalName });

  if (activeQueue) {
    await Promise.race([
      activeQueue.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  try {
    await emit("status", "Bridge disconnected", {
      level: "warn",
      meta: { signal: signalName, bridgeInstanceId: INSTANCE_ID },
    });
  } catch (error) {
    log("warn", "shutdown_event_failed", {
      category: "database_failure",
      error: sanitizeErrorMessage(error?.message),
    });
  }
  await pool.end().catch((error) => {
    log("warn", "database_pool_close_failed", {
      category: "database_failure",
      error: sanitizeErrorMessage(error?.message),
    });
  });
  log("info", "bridge_shutdown_complete", { signal: signalName });
}

async function main() {
  const hermesVersion = await checkHermesCompatibility({
    executable: HERMES,
    minimumVersion: HERMES_MIN_VERSION,
    maximumVersionExclusive: HERMES_MAX_VERSION_EXCLUSIVE,
    signal: shutdownController.signal,
  });
  log("info", "bridge_startup", {
    version: BRIDGE_VERSION,
    hermesVersion,
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    board: BOARD,
    pollMs: POLL_MS,
    mirrorMs: MIRROR_MS,
    claimBatchSize: CLAIM_BATCH_SIZE,
    tlsMode: transport.tlsMode,
  });
  await emit("status", "Bridge connected", {
    level: "up",
    meta: {
      version: BRIDGE_VERSION,
      instanceId: INSTANCE_ID,
      hermesVersion,
      platform: process.platform,
      architecture: process.arch,
    },
  });
  await mirrorTick();
  scheduleMirror();
  scheduleQueue(0);
}

for (const signalName of ["SIGINT", "SIGTERM"]) {
  process.once(signalName, () => {
    shutdown(signalName)
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        log("error", "bridge_shutdown_failed", {
          category: classifyError(error).category,
          error: sanitizeErrorMessage(error?.message),
        });
        process.exitCode = 1;
      });
  });
}

main().catch(async (error) => {
  log("error", "bridge_fatal", {
    category: classifyError(error).category,
    error: sanitizeErrorMessage(error?.message),
  });
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
