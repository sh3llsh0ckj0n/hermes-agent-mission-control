import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { qualifiedTaskId, resolveBoardAllowlist } from "../lib/boards.mjs";
import { readKanbanBoardSnapshotReadOnly } from "../lib/kanban-reader.mjs";
import { loadProjectConfig, resolveProjectAllowlist, validateBindings } from "../lib/project-config.mjs";
import { checkApprovalPackages, discoverReceiptFiles, runProjectReconciliation } from "../lib/project-reconciler.mjs";
import { extractMetrics } from "../lib/project-state.mjs";
import { buildExecutionMetadata, loadReceipts, receiptIdFor, sha256Hex } from "../lib/receipts.mjs";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("board allowlist is config-driven and keeps single-board behaviour by default", () => {
  assert.deepEqual(resolveBoardAllowlist({}), ["default"]);
  assert.deepEqual(resolveBoardAllowlist({ HERMES_BOARD: "default" }), ["default"]);
  assert.deepEqual(
    resolveBoardAllowlist({ HERMES_BOARDS: "default, rigspecs-production-integrity,default" }),
    ["default", "rigspecs-production-integrity"],
  );
  assert.throws(() => resolveBoardAllowlist({ HERMES_BOARDS: "../etc" }), /HERMES_BOARD/);
  assert.throws(
    () => resolveBoardAllowlist({ HERMES_BOARDS: "a,b", HERMES_KANBAN_DB: "/tmp/x.db" }),
    /cannot be combined/,
  );
  assert.equal(qualifiedTaskId("rigspecs-production-integrity", "t_1"), "rigspecs-production-integrity/t_1");
  assert.deepEqual(resolveProjectAllowlist({}), []);
  assert.deepEqual(resolveProjectAllowlist({ MC_PROJECTS: "rigspecs" }), ["rigspecs"]);
});

test("receipts are content-addressed, integrity-checked and deduplicated", () => {
  const root = tempDir("mc-receipts-");
  const dir = path.join(root, "run");
  fs.mkdirSync(dir);
  const report = "OVERALL STATUS: PASS\nQC VERDICT: CONCERNS\nDate: 2026-09-18\nJonny action required: YES\n";
  fs.writeFileSync(path.join(dir, "REPORT.md"), report);
  fs.writeFileSync(path.join(dir, "COPY.md"), report);
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${sha256Hex(Buffer.from(report))}  REPORT.md\n`);
  fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ status: "PASS", executedAt: "2026-09-15T00:00:00Z" }));
  fs.writeFileSync(path.join(dir, "bad.sha256"), `${"0".repeat(64)}  bad.json\n`);
  fs.writeFileSync(path.join(dir, "rows.json"), JSON.stringify([{ status: "WINDOW_BLOCKED" }]));

  const { receipts, problems } = loadReceipts({
    projectId: "rigspecs",
    roots: [root],
    sources: [
      { label: "report", path: path.join(dir, "REPORT.md"), parser: "markdown-report", integrity: { method: "sha256sums", manifest: "SHA256SUMS.txt" } },
      { label: "copy", path: path.join(dir, "COPY.md"), parser: "markdown-report" },
      { label: "bad", path: path.join(dir, "bad.json"), parser: "json-status", integrity: { method: "sha256-file", manifest: "bad.sha256" } },
      { label: "rows", path: path.join(dir, "rows.json"), parser: "json-status", result_map: { WINDOW_BLOCKED: "FAIL" }, finished_at: "2026-09-16" },
      { label: "missing", path: path.join(dir, "nope.json"), parser: "json-status" },
      { label: "escape", path: "/etc/passwd", parser: "json-status" },
    ],
  });

  const byLabel = Object.fromEntries(receipts.map((receipt) => [receipt.label, receipt]));
  assert.equal(receipts.length, 3, "identical bytes collapse into one receipt");
  assert.equal(byLabel.report.id, receiptIdFor(Buffer.from(report)));
  assert.equal(byLabel.report.paths.length, 2);
  assert.equal(byLabel.report.integrity, "verified");
  assert.equal(byLabel.report.result, "PASS");
  assert.equal(byLabel.report.qcVerdict, "CONCERNS");
  assert.equal(byLabel.report.actionRequired, true);
  assert.equal(byLabel.report.finishedAt, "2026-09-18T00:00:00.000Z");
  assert.equal(byLabel.bad.integrity, "mismatch");
  assert.equal(byLabel.rows.result, "FAIL");
  assert.equal(byLabel.rows.finishedAt, "2026-09-16T00:00:00.000Z");
  assert.deepEqual(problems.map((problem) => problem.code).sort(), ["missing", "unsafe_path"]);
});

test("worker-written mc-receipt/v1 files carry their own identity", () => {
  const root = tempDir("mc-discover-");
  fs.mkdirSync(path.join(root, "a", "node_modules"), { recursive: true });
  const body = JSON.stringify({
    schema: "mc-receipt/v1",
    project_id: "rigspecs",
    task_id: "rigspecs-production-integrity/t_1",
    run_id: "42",
    result: "PASS",
    finished_at: "2026-10-03T00:00:00Z",
  });
  fs.writeFileSync(path.join(root, "a", "mc-receipt.json"), body);
  fs.writeFileSync(path.join(root, "a", "node_modules", "mc-receipt.json"), body);
  const files = discoverReceiptFiles([root], { fileName: "mc-receipt.json", maxDepth: 4 });
  assert.deepEqual(files, [path.join(root, "a", "mc-receipt.json")]);

  const { receipts } = loadReceipts({
    projectId: "rigspecs",
    roots: [root],
    sources: [{ path: files[0], parser: "mc-receipt/v1" }],
  });
  assert.deepEqual(receipts[0].identity, {
    project_id: "rigspecs",
    task_id: "rigspecs-production-integrity/t_1",
    run_id: "42",
  });

  const metadata = buildExecutionMetadata({
    projectId: "rigspecs",
    taskId: "rigspecs-production-integrity/t_1",
    runId: 42,
    receiptBytes: Buffer.from(body),
  });
  assert.equal(metadata.mc_identity.receipt_id, receipts[0].id);
  assert.equal(metadata.mc_identity.run_id, "42");
});

test("binding files require content ids, a non-title basis, and recorded approval", () => {
  const document = (binding) => ({ schema: "mc-receipt-bindings/v1", project_id: "rigspecs", bindings: [binding] });
  const valid = {
    id: "b1",
    receipt_id: `sha256:${"a".repeat(64)}`,
    task_id: "rigspecs-production-integrity/t_1",
    status: "approved",
    basis: "operator confirmed",
    approved_by: "jonathan",
    approved_at: "2026-10-03",
  };
  assert.equal(validateBindings(document(valid), "rigspecs").length, 1);
  assert.throws(() => validateBindings(document({ ...valid, approved_by: null }), "rigspecs"), /approved_by/);
  assert.throws(() => validateBindings(document({ ...valid, receipt_id: "REPORT.md" }), "rigspecs"), /sha256/);
  assert.throws(() => validateBindings(document({ ...valid, basis_kind: "title-match" }), "rigspecs"), /non-title/);
  assert.throws(() => validateBindings(document({ ...valid, task_id: "t_1" }), "rigspecs"), /qualified/);
});

test("the committed RigSpecs project config is valid and preview-safe", () => {
  const config = loadProjectConfig("rigspecs");
  assert.deepEqual(config.boards, ["rigspecs-production-integrity"]);
  assert.equal(config.launch.target, 10);
  // Historical receipts have no approved bindings: nothing can auto-repair yet.
  assert.equal(config.bindings.filter((binding) => binding.status === "approved").length, 0);
  // Approval B is not recorded as granted and is not inferred.
  const approvalB = config.approvals.find((approval) => approval.approval_id === "rigspecs-approval-b");
  assert.notEqual(approvalB.status, "granted");
  assert.equal(config.approvals.find((approval) => approval.approval_id === "rigspecs-batch-6").status, "waiting");
});

test("approval packages are re-hashed so a changed package is visible", () => {
  const root = tempDir("mc-package-");
  fs.writeFileSync(path.join(root, "manifest.json"), "v1");
  const approvals = [
    { approval_id: "a", status: "granted", package_path: path.join(root, "manifest.json"), package_sha256: sha256Hex(Buffer.from("v1")) },
  ];
  assert.equal(checkApprovalPackages(approvals, [path.dirname(root)])[0].package_matches, true);
  fs.writeFileSync(path.join(root, "manifest.json"), "v2");
  assert.equal(checkApprovalPackages(approvals, [path.dirname(root)])[0].package_matches, false);
});

test("metrics come from evidence with their as-of time", () => {
  const { metrics, asOf } = extractMetrics(
    [{ id: "catalog", as_of_field: "generatedAt", fields: { locked: "counts.INTEGRITY_LOCKED", promoted: "promotedProducts#length", none: "x.y" } }],
    { catalog: { generatedAt: "2026-09-15", counts: { INTEGRITY_LOCKED: 3 }, promotedProducts: [{}, {}] } },
  );
  assert.deepEqual(metrics, { locked: 3, promoted: 2 });
  assert.equal(asOf.locked.asOf, "2026-09-15");
});

test("board snapshot reader is read-only, includes runs, and tolerates older schemas", () => {
  const home = tempDir("mc-snapshot-");
  const dbPath = path.join(home, ".hermes", "kanban", "boards", "rigspecs-production-integrity", "kanban.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, created_at INTEGER, idempotency_key TEXT);
    CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, metadata TEXT);
    INSERT INTO tasks VALUES ('t_1','one','blocked',1,'pb-01'), ('t_2','two','archived',2,NULL);
    INSERT INTO task_runs VALUES (1,'t_1','done','completed',1,2,'{"artifact_path":"/x"}');
  `);
  db.close();
  const before = fs.readFileSync(dbPath);

  const snapshot = readKanbanBoardSnapshotReadOnly({ board: "rigspecs-production-integrity", env: {}, homeDir: home });
  assert.equal(snapshot.tasks.length, 2, "archived tasks stay visible for history");
  assert.equal(snapshot.tasks[0].idempotency_key, "pb-01");
  assert.equal(snapshot.tasks[0].block_kind, undefined);
  assert.equal(snapshot.runs.length, 1);
  assert.deepEqual(fs.readFileSync(dbPath), before);

  // End-to-end preview over a temp config: read-only and deterministic.
  const configDir = tempDir("mc-config-");
  fs.mkdirSync(path.join(configDir, "projects"));
  fs.writeFileSync(path.join(configDir, "bindings.json"), JSON.stringify({ schema: "mc-receipt-bindings/v1", project_id: "demo", bindings: [] }));
  fs.writeFileSync(path.join(configDir, "approvals.json"), JSON.stringify({ schema: "mc-approvals/v1", project_id: "demo", approvals: [], gates: [] }));
  fs.writeFileSync(
    path.join(configDir, "projects", "demo.json"),
    JSON.stringify({
      schema: "mc-project/v1",
      project_id: "demo",
      name: "Demo",
      boards: ["rigspecs-production-integrity"],
      evidence_roots: [path.join(home, "evidence")],
      bindings_file: "../bindings.json",
      approvals_file: "../approvals.json",
      receipt_sources: [],
      metrics_sources: [],
      launch: { metric: "locked", target: 10, comparison: ">=" },
      milestones: [],
    }),
  );
  const fixed = () => new Date("2026-10-03T00:00:00Z");
  const options = { configDir, env: {}, homeDir: home, now: fixed };
  const first = runProjectReconciliation("demo", options);
  const second = runProjectReconciliation("demo", options);
  assert.deepEqual(second.reconciliation, first.reconciliation);
  assert.equal(first.reconciliation.counts.kanban_only, 1);
  assert.equal(first.reconciliation.counts.archived, 1);
  assert.deepEqual(fs.readFileSync(dbPath), before);
});

test("only the primary board is mirrored or actionable; other boards are read-only", async () => {
  const { resolveBridgeBoards } = await import("../lib/boards.mjs");
  assert.deepEqual(resolveBridgeBoards({}), { primary: "default", mirror: ["default"], readable: ["default"] });
  const enabled = resolveBridgeBoards({ HERMES_BOARD: "default", HERMES_BOARDS: "default,rigspecs-production-integrity" });
  assert.deepEqual(enabled.mirror, ["default"]);
  assert.deepEqual(enabled.readable, ["default", "rigspecs-production-integrity"]);
  // An allowlist that omits the primary board still never mirrors anything else.
  const omitted = resolveBridgeBoards({ HERMES_BOARD: "default", HERMES_BOARDS: "rigspecs-production-integrity" });
  assert.deepEqual(omitted.mirror, ["default"]);
  assert.deepEqual(omitted.readable, ["default", "rigspecs-production-integrity"]);
});
