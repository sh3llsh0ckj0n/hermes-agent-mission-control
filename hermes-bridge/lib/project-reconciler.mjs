import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readKanbanBoardSnapshotReadOnly } from "./kanban-reader.mjs";
import { loadProjectConfig } from "./project-config.mjs";
import { computeProjectState } from "./project-state.mjs";
import { reconcileProject } from "./reconcile.mjs";
import { RECEIPT_SCHEMA_V1, loadReceipts, resolveEvidencePath, sha256Hex } from "./receipts.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", "tooling"]);

/** Find worker-written mc-receipt/v1 files under the evidence roots. */
export function discoverReceiptFiles(roots, { fileName, maxDepth = 6, homeDir = os.homedir() }) {
  const found = [];
  const walk = (directory, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === fileName) found.push(full);
    }
  };
  for (const root of roots) {
    walk(path.resolve(root.replace(/^~(?=\/|$)/, homeDir)), 0);
  }
  return found.sort();
}

/** Supporting artifacts a task's own runs/result cite (report only; never used for repair). */
export function taskCitedArtifacts(snapshot) {
  const pathPattern = /(?:~|\/home\/[\w.-]+)\/[\w./-]+\.(?:md|json|csv|sha256)/g;
  const cited = new Map();
  const add = (taskId, value) => {
    if (typeof value !== "string") return;
    if (!cited.has(taskId)) cited.set(taskId, new Set());
    cited.get(taskId).add(value);
  };
  for (const run of snapshot.runs ?? []) {
    let metadata = null;
    try {
      metadata = run.metadata ? JSON.parse(run.metadata) : null;
    } catch {
      metadata = null;
    }
    if (!metadata || run.outcome !== "completed") continue;
    add(run.task_id, metadata.artifact_path);
    for (const artifact of Array.isArray(metadata.artifacts) ? metadata.artifacts : []) add(run.task_id, artifact);
  }
  for (const task of snapshot.tasks) {
    for (const match of String(task.result ?? "").match(pathPattern) ?? []) add(task.id, match);
  }
  return [...cited.entries()]
    .map(([taskId, paths]) => ({ kanbanId: taskId, paths: [...paths].sort() }))
    .sort((a, b) => a.kanbanId.localeCompare(b.kanbanId));
}

function hashFile(file) {
  return sha256Hex(fs.readFileSync(file));
}

/**
 * Attach the current hash of each approval's package. A granted approval whose
 * package bytes changed no longer matches and therefore no longer counts.
 */
export function checkApprovalPackages(approvals, roots, { homeDir = os.homedir(), hash = hashFile } = {}) {
  return approvals.map((approval) => {
    if (!approval.package_path) return approval;
    let current = null;
    try {
      current = hash(resolveEvidencePath(approval.package_path, roots, { homeDir }));
    } catch {
      current = null;
    }
    return {
      ...approval,
      package_current_sha256: current,
      package_matches: Boolean(current) && current === approval.package_sha256,
    };
  });
}

/**
 * Run read-only reconciliation for one project. No database, no Kanban writes.
 */
export function runProjectReconciliation(projectId, {
  env = process.env,
  homeDir = os.homedir(),
  now = () => new Date(),
  configDir,
  readSnapshot = (board) => readKanbanBoardSnapshotReadOnly({ board, env, homeDir }),
} = {}) {
  const config = loadProjectConfig(projectId, configDir ? { configDir } : {});
  const roots = config.evidence_roots;

  const boards = [];
  const boardProblems = [];
  for (const board of config.boards) {
    try {
      boards.push(readSnapshot(board));
    } catch (error) {
      boardProblems.push({ board, code: error?.category ?? "error" });
    }
  }

  const discovered = config.receipt_discovery
    ? discoverReceiptFiles(roots, {
        fileName: config.receipt_discovery.file_name,
        maxDepth: config.receipt_discovery.max_depth,
        homeDir,
      }).map((file) => ({ label: path.relative(homeDir, file), path: file, parser: RECEIPT_SCHEMA_V1 }))
    : [];
  const { receipts, problems: receiptProblems } = loadReceipts({
    projectId,
    sources: [...config.receipt_sources, ...discovered],
    roots,
    homeDir,
  });

  const approvals = checkApprovalPackages(config.approvals, roots, { homeDir });
  const approvalsById = new Map(approvals.map((approval) => [approval.approval_id, approval]));
  const gates = config.gates.map((gate) => {
    const approval = approvalsById.get(gate.approval_id);
    return approval?.package_path
      ? { ...gate, package: { sha256: approval.package_sha256, current_sha256: approval.package_current_sha256 } }
      : gate;
  });

  const reconciledAt = now().toISOString();
  const reconciliation = reconcileProject({
    projectId,
    boards,
    receipts,
    bindings: config.bindings,
    gates,
    approvals,
    reconciledAt,
  });

  const metricsDocuments = {};
  const metricProblems = [];
  for (const source of config.metrics_sources ?? []) {
    try {
      metricsDocuments[source.id] = JSON.parse(
        fs.readFileSync(resolveEvidencePath(source.path, roots, { homeDir }), "utf8"),
      );
    } catch (error) {
      metricProblems.push({ source: source.id, code: error?.code ?? error?.name ?? "error" });
    }
  }

  const state = computeProjectState({
    config: { ...config, approvals },
    reconciliation,
    receipts,
    metricsDocuments,
    generatedAt: reconciledAt,
  });

  return {
    config,
    approvals,
    receipts,
    reconciliation,
    state,
    citedArtifacts: Object.fromEntries(boards.map((snapshot) => [snapshot.board, taskCitedArtifacts(snapshot)])),
    problems: { boards: boardProblems, receipts: receiptProblems, metrics: metricProblems },
  };
}
