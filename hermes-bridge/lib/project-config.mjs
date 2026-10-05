import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ValidationError } from "./errors.mjs";
import { normalizeBoardSlug } from "./kanban-reader.mjs";
import { parseQualifiedTaskId } from "./boards.mjs";

export const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config");
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BINDING_STATUSES = new Set(["proposed", "approved", "rejected"]);
const APPROVAL_STATUSES = new Set([
  "not_requested",
  "waiting",
  "granted",
  "rejected",
  "invalidated",
  "executed",
  "unrecorded",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireSchema(document, schema, file) {
  if (document?.schema !== schema) {
    throw new ValidationError(`${path.basename(file)} must declare schema ${schema}`);
  }
}

export function validateBindings(document, projectId) {
  requireSchema(document, "mc-receipt-bindings/v1", "bindings");
  if (document.project_id !== projectId) throw new ValidationError("Binding file project mismatch");
  const ids = new Set();
  return document.bindings.map((binding) => {
    if (!binding.id || ids.has(binding.id)) throw new ValidationError("Binding ids must be present and unique");
    ids.add(binding.id);
    if (!/^sha256:[0-9a-f]{64}$/.test(binding.receipt_id ?? "")) {
      throw new ValidationError(`Binding ${binding.id} must name a receipt by sha256 content id`);
    }
    parseQualifiedTaskId(binding.task_id);
    if (!BINDING_STATUSES.has(binding.status)) throw new ValidationError(`Binding ${binding.id} has invalid status`);
    if (binding.status === "approved" && (!binding.approved_by || !binding.approved_at)) {
      throw new ValidationError(`Approved binding ${binding.id} must record approved_by and approved_at`);
    }
    if (!binding.basis || /title/i.test(binding.basis_kind ?? "")) {
      throw new ValidationError(`Binding ${binding.id} needs a non-title basis`);
    }
    return Object.freeze({ ...binding });
  });
}

export function validateApprovals(document, projectId) {
  requireSchema(document, "mc-approvals/v1", "approvals");
  if (document.project_id !== projectId) throw new ValidationError("Approvals file project mismatch");
  const approvals = document.approvals.map((approval) => {
    if (!APPROVAL_STATUSES.has(approval.status)) {
      throw new ValidationError(`Approval ${approval.approval_id} has invalid status`);
    }
    if (approval.status === "granted" && (!approval.approver || !approval.decided_at)) {
      throw new ValidationError(`Granted approval ${approval.approval_id} must record approver and decided_at`);
    }
    return Object.freeze({ ...approval });
  });
  const known = new Set(approvals.map((approval) => approval.approval_id));
  const gates = (document.gates ?? []).map((gate) => {
    parseQualifiedTaskId(gate.task_id);
    if (!known.has(gate.approval_id)) throw new ValidationError(`Gate names unknown approval ${gate.approval_id}`);
    return Object.freeze({ ...gate });
  });
  return { approvals, gates };
}

/** Load one project definition plus its binding file and approval ledger. */
export function loadProjectConfig(projectId, { configDir = CONFIG_DIR } = {}) {
  if (!PROJECT_ID.test(String(projectId))) throw new ValidationError("Invalid project id");
  const file = path.join(configDir, "projects", `${projectId}.json`);
  const project = readJson(file);
  requireSchema(project, "mc-project/v1", file);
  if (project.project_id !== projectId) throw new ValidationError("Project file id mismatch");
  const boards = project.boards.map(normalizeBoardSlug);
  if (!boards.length) throw new ValidationError("A project needs at least one board");

  const projectDir = path.dirname(file);
  const bindings = validateBindings(readJson(path.resolve(projectDir, project.bindings_file)), projectId);
  const { approvals, gates } = validateApprovals(readJson(path.resolve(projectDir, project.approvals_file)), projectId);
  for (const gate of gates) {
    if (!boards.includes(parseQualifiedTaskId(gate.task_id).board)) {
      throw new ValidationError(`Gate task ${gate.task_id} is not on a project board`);
    }
  }

  return Object.freeze({ ...project, boards, bindings, approvals, gates });
}

/** Projects enabled for reconciliation, from `MC_PROJECTS` (comma-separated). Empty = none. */
export function resolveProjectAllowlist(env = process.env) {
  const raw = String(env.MC_PROJECTS ?? "").trim();
  if (!raw) return [];
  const ids = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  for (const id of ids) {
    if (!PROJECT_ID.test(id)) throw new ValidationError(`Invalid project id in MC_PROJECTS: ${id}`);
  }
  return ids;
}
