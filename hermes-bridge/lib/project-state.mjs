import { CLASSIFICATION, LIFECYCLE } from "./reconcile.mjs";

/**
 * Derive a project's normalized mission state from reconciliation output,
 * receipts, approvals and evidence-backed metrics. Nothing here is hardcoded:
 * every number comes from a configured source and carries its as-of time.
 */

export function readPointer(document, pointer) {
  const [path, modifier] = String(pointer).split("#");
  let value = document;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !(key in value)) return undefined;
    value = value[key];
  }
  if (modifier === "length") return Array.isArray(value) ? value.length : undefined;
  return value;
}

/** Extract configured fields from loaded metric documents. */
export function extractMetrics(sources, documents) {
  const metrics = {};
  const asOf = {};
  for (const source of sources) {
    const document = documents[source.id];
    if (document === undefined) continue;
    const sourceAsOf = source.as_of_field ? readPointer(document, source.as_of_field) ?? null : null;
    for (const [name, pointer] of Object.entries(source.fields ?? {})) {
      const value = readPointer(document, pointer);
      if (value === undefined) continue;
      metrics[name] = value;
      asOf[name] = { source: source.id, asOf: sourceAsOf };
    }
  }
  return { metrics, asOf };
}

function compare(value, comparison, target) {
  if (typeof value !== "number") return null;
  switch (comparison) {
    case ">=":
      return value >= target;
    case ">":
      return value > target;
    case "==":
      return value === target;
    default:
      return null;
  }
}

function approvalStatus(approval) {
  // A changed package invalidates its approval.
  if (approval?.status === "granted" && approval.package_matches === false) return "APPROVAL_INVALIDATED";
  switch (approval?.status) {
    case "granted":
      return "APPROVED";
    case "executed":
      return "COMPLETE";
    case "waiting":
      return LIFECYCLE.WAITING_APPROVAL;
    case "rejected":
      return "REJECTED";
    case "invalidated":
      return "APPROVAL_INVALIDATED";
    case "not_requested":
      return "NOT_STARTED";
    default:
      return "UNRECORDED";
  }
}

function milestoneFor(definition, context) {
  const { reconciliation, receiptsByLabel, approvalsById, metrics, launch } = context;
  const base = { id: definition.id, name: definition.name, type: definition.type };

  switch (definition.type) {
    case "tasks": {
      const tasks = reconciliation.tasks.filter((task) => definition.tasks.includes(task.taskId));
      const count = (predicate) => tasks.filter(predicate).length;
      const open = tasks.filter((task) => task.normalizedStatus !== LIFECYCLE.ARCHIVED);
      const done = count((task) => task.normalizedStatus === LIFECYCLE.DONE);
      const required = count((task) => task.classification === CLASSIFICATION.RECONCILIATION_REQUIRED);
      const waiting = count((task) => task.normalizedStatus === LIFECYCLE.WAITING_APPROVAL);
      const blocked = count((task) => task.normalizedStatus === LIFECYCLE.BLOCKED);
      const missing = definition.tasks.length - tasks.length;
      let status = "IN_PROGRESS";
      if (required) status = "RECONCILIATION_REQUIRED";
      else if (open.length && done === open.length) status = "COMPLETE";
      else if (waiting) status = LIFECYCLE.WAITING_APPROVAL;
      else if (blocked) status = LIFECYCLE.BLOCKED;
      return { ...base, status, done, total: open.length, waiting, blocked, reconciliationRequired: required, missingTasks: missing };
    }
    case "receipt":
    case "receipt-action": {
      const receipt = receiptsByLabel.get(definition.receipt_label);
      if (!receipt) return { ...base, status: "NO_EVIDENCE" };
      const orphan = reconciliation.orphanReceipts.includes(receipt.id);
      if (definition.type === "receipt-action") {
        const open = receipt.actionRequired || (receipt.qcVerdict && receipt.qcVerdict !== "PASS");
        return {
          ...base,
          status: open ? "ACTION_REQUIRED" : "COMPLETE",
          evidenceId: receipt.id,
          note: definition.note ?? null,
        };
      }
      return {
        ...base,
        status: orphan ? "RECONCILIATION_REQUIRED" : receipt.result === "PASS" ? "COMPLETE" : receipt.result,
        evidenceId: receipt.id,
        evidenceResult: receipt.result,
        qcVerdict: receipt.qcVerdict ?? null,
        finishedAt: receipt.finishedAt ?? null,
      };
    }
    case "approval": {
      const approval = approvalsById.get(definition.approval_id);
      return {
        ...base,
        status: approvalStatus(approval),
        approvalId: definition.approval_id,
        packageSha256: approval?.package_sha256 ?? null,
        packageMatches: approval?.package_matches ?? null,
      };
    }
    case "launch":
      return { ...base, status: launch.reached ? "COMPLETE" : "IN_PROGRESS", current: launch.current, target: launch.target };
    case "metric":
      return { ...base, status: metrics[definition.metric] === undefined ? "NO_EVIDENCE" : "MEASURED", value: metrics[definition.metric] ?? null };
    case "indexing": {
      const approval = approvalsById.get(definition.approval_id);
      const enabled = metrics.indexing_launch_enabled === true;
      let status = "BLOCKED";
      const blockers = [];
      if (enabled) status = "COMPLETE";
      else {
        if (!launch.reached) blockers.push(`Launch target not reached (${launch.current ?? "?"} / ${launch.target})`);
        if (approval?.status !== "granted") blockers.push("No launch/indexing approval granted");
        if (!blockers.length) status = "READY";
      }
      return { ...base, status, launchEnabled: enabled, blockers, approvalId: definition.approval_id };
    }
    default:
      return { ...base, status: "UNSUPPORTED" };
  }
}

export function computeProjectState({ config, reconciliation, receipts, metricsDocuments, generatedAt }) {
  const { metrics, asOf } = extractMetrics(config.metrics_sources ?? [], metricsDocuments);
  const approvalsById = new Map(config.approvals.map((approval) => [approval.approval_id, approval]));
  const receiptsByLabel = new Map(receipts.map((receipt) => [receipt.label, receipt]));

  const current = metrics[config.launch.metric];
  const reachedValue = compare(current, config.launch.comparison, config.launch.target);
  const launch = {
    metric: config.launch.metric,
    current: typeof current === "number" ? current : null,
    target: config.launch.target,
    comparison: config.launch.comparison,
    reached: reachedValue === true,
    asOf: asOf[config.launch.metric]?.asOf ?? null,
  };

  const context = { reconciliation, receiptsByLabel, approvalsById, metrics, launch };
  const milestones = config.milestones.map((definition) => milestoneFor(definition, context));
  const milestone = (id) => milestones.find((entry) => entry.id === id);

  const pendingApprovals = config.approvals.filter((approval) => approval.status === "waiting");
  const reconciliationRequired = reconciliation.required.length;
  const criticalBlockers = [];
  for (const entry of milestones) {
    if (entry.status === "RECONCILIATION_REQUIRED") criticalBlockers.push(`${entry.name}: reconciliation required`);
    if (entry.status === "ACTION_REQUIRED") criticalBlockers.push(`${entry.name}: action required`);
  }

  return {
    projectId: config.project_id,
    name: config.name,
    generatedAt,
    reconciliationVersion: reconciliation.reconciliationVersion,
    lastReconciledAt: reconciliation.reconciledAt,
    launch: {
      integrity_locked_current: launch.current,
      integrity_locked_target: launch.target,
      target_reached: launch.reached,
      contained_products: metrics.contained_products ?? null,
      published_products: metrics.published_products ?? null,
      promoted_catalog_count: metrics.promoted_catalog_count ?? null,
      revenue_ready_count: metrics.revenue_ready_count ?? null,
      revenue_eligible_count: metrics.revenue_eligible_count ?? null,
      batch_status: milestone("batch-6")?.status ?? null,
      indexing_status: milestone("launch-indexing")?.status ?? null,
      pending_approvals: pendingApprovals.length,
      critical_blockers: criticalBlockers,
      metrics_as_of: launch.asOf,
    },
    milestones,
    approvals: config.approvals.map((approval) => ({
      approvalId: approval.approval_id,
      scope: approval.scope,
      status: approval.status,
      packageSha256: approval.package_sha256 ?? null,
      packageMatches: approval.package_matches ?? null,
    })),
    reconciliation: {
      counts: reconciliation.counts,
      required: reconciliationRequired,
      safeRepairs: reconciliation.intents.length,
      orphanReceipts: reconciliation.orphanReceipts.length,
    },
  };
}
