import { notFound } from "next/navigation";

import { Eyebrow, Panel, Pill, SectionHeader } from "@/components/ui/kit";
import {
  isMissionControlSchemaPending,
  summarizeProject,
  validProjectId,
} from "@/lib/mission-control";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

function toneFor(status: string): Tone {
  if (status === "COMPLETE" || status === "consistent") return "up";
  if (/RECONCILIATION_REQUIRED|ACTION_REQUIRED|reconciliation_required|FAILED|INVALIDATED/i.test(status)) return "down";
  if (/WAITING_APPROVAL|BLOCKED|waiting_approval|stale/i.test(status)) return "warn";
  return "neutral";
}

function value(input: unknown) {
  return input === null || input === undefined ? "—" : String(input);
}

async function load(id: string) {
  try {
    const project = await prisma.mcProject.findUnique({ where: { id } });
    if (!project) return { kind: "missing" as const };
    const [tasks, approvals, ledger] = await Promise.all([
      prisma.mcTaskState.findMany({ where: { projectId: id }, orderBy: { id: "asc" } }),
      prisma.mcApproval.findMany({ where: { projectId: id }, orderBy: { id: "asc" } }),
      prisma.mcReconciliation.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 25 }),
    ]);
    return { kind: "ok" as const, project, tasks, approvals, ledger };
  } catch (error) {
    if (isMissionControlSchemaPending(error)) return { kind: "pending" as const };
    throw error;
  }
}

export default async function MissionProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validProjectId(id)) notFound();
  const data = await load(id);
  if (data.kind === "missing") notFound();
  if (data.kind === "pending") {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Panel className="p-6">
          <Eyebrow>Mission Control</Eyebrow>
          <p className="mt-2 text-[var(--text-2)]">Project state tables are not migrated yet.</p>
        </Panel>
      </div>
    );
  }

  const summary = summarizeProject(data.project);
  const launch = summary.launch;
  const required = data.tasks.filter((task) => task.classification === "reconciliation_required");
  const stale = data.tasks.filter((task) => task.kanbanStale);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <SectionHeader
        label="Mission Control · Project"
        title={summary.name}
        action={
          <Pill tone={summary.reconciliationStale ? "warn" : "neutral"}>
            {summary.reconcileMode} · last reconciled {summary.lastReconciledAt ?? "never"}
          </Pill>
        }
      />

      {summary.attention.length > 0 && (
        <Panel className="p-5">
          <Eyebrow>Needs attention</Eyebrow>
          <ul className="mt-3 space-y-2">
            {summary.attention.map((item) => (
              <li key={item.id} className="flex items-center gap-3 text-[14px] text-[var(--text)]">
                <Pill tone={item.severity === "critical" ? "down" : "warn"}>{item.severity}</Pill>
                {item.title}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {launch && (
        <Panel className="p-5">
          <Eyebrow>Launch readiness</Eyebrow>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Integrity locked", `${value(launch.integrity_locked_current)} / ${value(launch.integrity_locked_target)}`],
              ["Published", value(launch.published_products)],
              ["Contained", value(launch.contained_products)],
              ["Promoted catalog", value(launch.promoted_catalog_count)],
              ["Revenue ready", value(launch.revenue_ready_count)],
              ["Batch", value(launch.batch_status)],
              ["Indexing", value(launch.indexing_status)],
              ["Pending approvals", value(launch.pending_approvals)],
            ].map(([label, text]) => (
              <div key={label}>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">{label}</div>
                <div className="mt-1 text-[15px] font-medium text-[var(--text)]">{text}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-[var(--text-3)]">Metrics as of {value(launch.metrics_as_of)}</p>
        </Panel>
      )}

      <Panel className="p-5">
        <Eyebrow>Milestones</Eyebrow>
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {summary.milestones.map((milestone) => (
            <li key={milestone.id} className="flex items-center justify-between py-2 text-[14px]">
              <span className="text-[var(--text)]">{milestone.name}</span>
              <Pill tone={toneFor(milestone.status)}>{milestone.status}</Pill>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="p-5">
        <Eyebrow>Reconciliation required ({required.length})</Eyebrow>
        {required.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-3)]">No task-level conflicts. Orphan receipts are listed in the ledger below.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-[13px]">
            {required.map((task) => (
              <li key={task.id}>
                <span className="font-medium text-[var(--text)]">{task.title}</span>{" "}
                <span className="text-[var(--text-3)]">({task.id} · Kanban {task.kanbanStatus} · MC {task.normalizedStatus})</span>
                <div className="text-[var(--text-2)]">{task.recommendedResolution}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-[var(--text-3)]">Stale Kanban cards: {stale.length}</p>
      </Panel>

      <Panel className="p-5">
        <Eyebrow>Approvals</Eyebrow>
        <ul className="mt-3 divide-y divide-[var(--border)] text-[13px]">
          {data.approvals.map((approval) => (
            <li key={approval.id} className="flex items-center justify-between gap-4 py-2">
              <span className="text-[var(--text)]">{approval.scope}</span>
              <Pill tone={toneFor(approval.status === "waiting" ? "WAITING_APPROVAL" : approval.status)}>{approval.status}</Pill>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="p-5">
        <Eyebrow>Reconciliation ledger (latest)</Eyebrow>
        <ul className="mt-3 space-y-1 font-mono text-[12px] text-[var(--text-2)]">
          {data.ledger.map((entry) => (
            <li key={entry.id}>
              {entry.createdAt.toISOString()} · {entry.mode} · {entry.outcome} · {entry.taskId ?? entry.intentId}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
