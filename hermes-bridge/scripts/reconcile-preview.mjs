#!/usr/bin/env node
/**
 * Read-only reconciliation preview.
 *
 *   node scripts/reconcile-preview.mjs --project rigspecs [--out <dir>]
 *
 * Reads Kanban boards (SQLite, read-only), configured receipts and metrics.
 * Writes nothing anywhere except the optional report files in --out.
 * It never touches PostgreSQL and never runs a Hermes command.
 */
import fs from "node:fs";
import path from "node:path";

import { runProjectReconciliation } from "../lib/project-reconciler.mjs";
import { CLASSIFICATION, resolveReconcileMode } from "../lib/reconcile.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const projectId = argument("project");
if (!projectId) {
  console.error("usage: reconcile-preview.mjs --project <id> [--out <dir>]");
  process.exit(2);
}
if (resolveReconcileMode(process.env.RECONCILE_MODE) === "apply") {
  console.error("reconcile-preview never applies repairs; unset RECONCILE_MODE or use preview");
  process.exit(2);
}

const run = runProjectReconciliation(projectId);
const { reconciliation, receipts, state, citedArtifacts, problems, config } = run;
const receiptsById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
const short = (id) => (id ? `${id.slice(0, 19)}…` : "—");
const byClass = (classification) => reconciliation.tasks.filter((task) => task.classification === classification);
// Done cards whose own completed runs/results cite their artifacts: correct, with
// supporting (not authoritative) evidence. Reported apart from bare Kanban-only cards.
const selfCited = new Set(
  Object.entries(citedArtifacts).flatMap(([board, entries]) => entries.map((entry) => `${board}/${entry.kanbanId}`)),
);
const selfCitedDone = byClass(CLASSIFICATION.KANBAN_ONLY).filter(
  (task) => task.kanbanStatus === "done" && selfCited.has(task.taskId),
);
const bareKanbanOnly = byClass(CLASSIFICATION.KANBAN_ONLY).filter((task) => !selfCitedDone.includes(task));
const row = (cells) => `| ${cells.map((cell) => String(cell ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;

const lines = [];
lines.push(`# Reconciliation preview — ${config.name}`, "");
lines.push(`- Mode: **preview** (read-only; no Kanban or database writes)`);
lines.push(`- Reconciled at: ${reconciliation.reconciledAt}`);
lines.push(`- Engine: ${reconciliation.reconciliationVersion}`);
lines.push(`- Boards: ${reconciliation.boards.join(", ")}`);
lines.push(`- Receipts loaded: ${receipts.length}; binding entries: ${config.bindings.length}`);
lines.push("");
lines.push("## Summary", "");
lines.push(row(["Category", "Count"]), row(["---", "---"]));
for (const [label, classification] of [
  ["Already correct (receipt evidence agrees)", CLASSIFICATION.CONSISTENT],
  ["Stale — safe deterministic repair", CLASSIFICATION.STALE_SAFE_REPAIR],
  ["Reconciliation required (task)", CLASSIFICATION.RECONCILIATION_REQUIRED],
  ["Waiting approval", CLASSIFICATION.WAITING_APPROVAL],
  ["Archived", CLASSIFICATION.ARCHIVED],
]) {
  lines.push(row([label, byClass(classification).length]));
}
lines.push(row(["Already correct (done; task-cited artifacts)", selfCitedDone.length]));
lines.push(row(["Kanban-only (no linked evidence)", bareKanbanOnly.length]));
lines.push(row(["Orphan receipts", reconciliation.orphanReceipts.length]));
lines.push(row(["Total RECONCILIATION_REQUIRED items", reconciliation.required.length]));
lines.push("");

lines.push("## Stale cards / safe deterministic repairs", "");
if (!reconciliation.intents.length) lines.push("None. No card has authoritative evidence that contradicts it unambiguously.", "");
else {
  lines.push(row(["Intent", "Task", "Kanban", "→", "Evidence"]), row(["---", "---", "---", "---", "---"]));
  for (const intent of reconciliation.intents) {
    lines.push(row([intent.intentId, intent.taskId, intent.oldStatus, intent.newStatus, short(intent.authoritativeEvidenceId)]));
  }
  lines.push("");
}

lines.push("## RECONCILIATION_REQUIRED", "");
lines.push(row(["Item", "Type", "Subject", "Kanban / MC", "Why", "Recommended resolution"]));
lines.push(row(["---", "---", "---", "---", "---", "---"]));
for (const item of reconciliation.required) {
  const receipt = item.type === "orphan_receipt" ? receiptsById.get(item.subject) : null;
  lines.push(
    row([
      item.id,
      item.type,
      receipt ? `${receipt.label} (${short(receipt.id)})` : (item.taskId ? `${item.taskId} — ${item.title}` : item.subject),
      item.taskId ? `${item.kanbanStatus} / ${item.missionControlStatus}` : "—",
      item.conflicts.join("; "),
      item.recommendedResolution,
    ]),
  );
}
lines.push("");

lines.push("## Receipts", "");
lines.push(row(["Receipt id", "Label", "Result", "QC", "Finished", "Integrity", "Action req.", "Linked"]));
lines.push(row(["---", "---", "---", "---", "---", "---", "---", "---"]));
for (const receipt of receipts) {
  lines.push(
    row([
      `\`${receipt.id}\``,
      receipt.label,
      `${receipt.result}${receipt.rawResult && receipt.rawResult !== receipt.result ? ` (${receipt.rawResult})` : ""}`,
      receipt.qcVerdict,
      receipt.finishedAt,
      `${receipt.integrity} (${receipt.integrityMethod})`,
      receipt.actionRequired ? "YES" : "no",
      reconciliation.orphanReceipts.includes(receipt.id) ? "orphan" : "linked",
    ]),
  );
}
lines.push("");

lines.push("## Waiting approval", "");
for (const task of byClass(CLASSIFICATION.WAITING_APPROVAL)) {
  lines.push(`- ${task.taskId} — ${task.title} (Kanban ${task.kanbanStatus}; approval ${task.approvalGate.approvalId}: ${task.approvalGate.status})`);
}
lines.push("");

lines.push("## Already correct", "");
for (const task of byClass(CLASSIFICATION.CONSISTENT)) {
  lines.push(`- ${task.taskId} — ${task.title} (Kanban ${task.kanbanStatus}; ${task.reasons[0]})`);
}
for (const task of selfCitedDone) {
  const entry = citedArtifacts[task.board].find((candidate) => candidate.kanbanId === task.kanbanId);
  lines.push(`- ${task.taskId} — ${task.title} (Kanban done; its completed run cites ${entry.paths.length} artifact(s))`);
}
lines.push("");

lines.push("## Kanban-only cards (no linked execution evidence)", "");
lines.push(row(["Task", "Idempotency key", "Kanban", "Title"]), row(["---", "---", "---", "---"]));
for (const task of bareKanbanOnly) {
  lines.push(row([task.taskId, task.idempotencyKey, task.kanbanStatus, task.title]));
}
lines.push("");

lines.push("## Tasks without a stable idempotency key", "");
const unkeyed = reconciliation.tasks.filter((task) => !task.idempotencyKey && task.classification !== CLASSIFICATION.ARCHIVED);
lines.push(unkeyed.length ? unkeyed.map((task) => `- ${task.taskId} — ${task.title}`).join("\n") : "None.");
lines.push("", "All tasks still carry the Hermes task id, which is the primary stable identity (`<board>/<id>`).", "");

lines.push("## Project state (derived)", "");
lines.push("```json", JSON.stringify(state.launch, null, 2), "```", "");
lines.push(row(["Milestone", "Status", "Detail"]), row(["---", "---", "---"]));
for (const milestone of state.milestones) {
  const detail = Object.fromEntries(
    Object.entries(milestone).filter(([key]) => !["id", "name", "type", "status"].includes(key)),
  );
  lines.push(row([milestone.name, milestone.status, JSON.stringify(detail)]));
}
lines.push("");

const problemCount = problems.boards.length + problems.receipts.length + problems.metrics.length;
lines.push("## Load problems", "");
lines.push(problemCount ? "```json\n" + JSON.stringify(problems, null, 2) + "\n```" : "None.", "");

const markdown = lines.join("\n");
const out = argument("out");
if (out) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${projectId}-reconciliation-preview.md`), markdown);
  fs.writeFileSync(
    path.join(out, `${projectId}-reconciliation-preview.json`),
    JSON.stringify(
      {
        config: { project_id: config.project_id, name: config.name, boards: config.boards },
        approvals: run.approvals,
        reconciliation,
        receipts,
        state,
        citedArtifacts,
        problems,
      },
      null,
      2,
    ),
  );
}
process.stdout.write(markdown + "\n");
