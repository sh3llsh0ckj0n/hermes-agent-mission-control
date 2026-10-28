import Link from "next/link";

import { EmptyState, Eyebrow, Panel, Pill, SectionHeader } from "@/components/ui/kit";
import { APPROVAL_INTEGRITY_FRESH_LABEL, type ApprovalBadge, type ApprovalIndexView, type ApprovalPackageView } from "@/lib/approval-view";

function toneFor(badge: ApprovalBadge): "neutral" | "up" | "down" | "warn" {
  if (badge === "granted") return "up";
  if (badge === "rejected" || badge === "invalidated") return "down";
  if (badge === "waiting") return "warn";
  return "neutral";
}

function formatWhen(value: string | null) {
  return value ?? "unavailable";
}

function PackageFacts({ item }: { item: ApprovalPackageView }) {
  return (
    <div className="mt-3 space-y-2 text-[13px] leading-5 text-[var(--text-2)]">
      <p>
        <span className="text-[var(--text-3)]">Recorded status </span>
        <span className="text-[var(--text)]">{item.recordedStatus}</span>
      </p>
      <p>
        <span className="text-[var(--text-3)]">Pinned SHA-256 </span>
        <span className="mt-1 block font-mono text-[12px] break-all text-[var(--text)]">
          {item.pinnedSha256 ?? "unavailable"}
        </span>
      </p>
      <p>{item.verificationLabel}</p>
      <p>
        Package reference {item.packageIdRecorded ? "is on record" : "is not on record"}. The
        filesystem path is not shown.
      </p>
      <p>Package valid: {item.packageValid ? "yes" : "no"}.</p>
    </div>
  );
}

function PackageCard({ item, fixture }: { item: ApprovalPackageView; fixture: boolean }) {
  const href = fixture ? `/hermes/approvals/${item.id}?fixture=1` : `/hermes/approvals/${item.id}`;
  return (
    <Panel href={href} className="block min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={toneFor(item.badge)}>{item.badge}</Pill>
        <Pill tone={item.packageValid ? "up" : "neutral"}>{item.packageValid ? "valid" : "not valid"}</Pill>
      </div>
      <h3 className="mt-3 text-[16px] font-medium leading-snug break-words text-[var(--text)]">{item.scope}</h3>
      <p className="mt-1 text-[12px] text-[var(--text-3)]">
        {item.projectName} · {item.projectId}
      </p>
      <PackageFacts item={item} />
    </Panel>
  );
}

function PackageGroup({
  title,
  items,
  fixture,
  empty,
}: {
  title: string;
  items: ApprovalPackageView[];
  fixture: boolean;
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <Eyebrow>
        {title} ({items.length})
      </Eyebrow>
      {items.length === 0 ? (
        <Panel className="p-4">
          <p className="text-[13px] text-[var(--text-3)]">{empty}</p>
        </Panel>
      ) : (
        items.map((item) => <PackageCard key={item.id} item={item} fixture={fixture} />)
      )}
    </section>
  );
}

export function ApprovalIndexScreen({ model }: { model: ApprovalIndexView }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-5">
      {model.fixture && model.banner ? (
        <p className="rounded-md border border-[var(--warn)] px-3 py-2 text-[13px] leading-5 text-[var(--warn)]" role="status">
          {model.banner}
        </p>
      ) : null}
      <SectionHeader label="Mission Control · Approvals" title="Approval packages" />
      <p className="text-[13px] leading-5 text-[var(--text-2)]">
        RigSpecs project approvals are read from the Mission Control mirror. The JSON ledger stays
        authoritative. This view cannot grant, reject, or edit. A package is valid only when the
        recorded status is granted and the pinned SHA-256 has a hash match newer than{" "}
        {APPROVAL_INTEGRITY_FRESH_LABEL}.
      </p>
      {model.packages.length === 0 ? (
        <Panel className="p-4">
          <EmptyState
            title="No approval packages"
            hint="The mirror has no McApproval rows. That is unavailable evidence, not a grant."
          />
        </Panel>
      ) : (
        <>
          <PackageGroup
            title="Waiting"
            items={model.pending}
            fixture={model.fixture}
            empty="No package is waiting."
          />
          <PackageGroup
            title="History"
            items={model.historical}
            fixture={model.fixture}
            empty="No historical packages are in the mirror."
          />
        </>
      )}
    </div>
  );
}

export function ApprovalDetailScreen({ item }: { item: ApprovalPackageView }) {
  const back = item.fixture ? "/hermes/approvals?fixture=1" : "/hermes/approvals";
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4">
      {item.fixture ? (
        <p className="rounded-md border border-[var(--warn)] px-3 py-2 text-[13px] leading-5 text-[var(--warn)]" role="status">
          FIXTURE DATA — not a live approval, not a grant, and not the 31-row Black Rhino pilot.
        </p>
      ) : null}
      <Link href={back} className="inline-flex min-h-11 items-center text-[13px] text-[var(--text-2)]">
        All approval packages
      </Link>
      <SectionHeader label="Mission Control · Approval" title={item.scope} />
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={toneFor(item.badge)}>{item.badge}</Pill>
        <Pill tone={item.packageValid ? "up" : "neutral"}>{item.packageValid ? "valid" : "not valid"}</Pill>
      </div>
      <Panel className="min-w-0 p-4">
        <Eyebrow>Decision</Eyebrow>
        <PackageFacts item={item} />
        <dl className="mt-3 space-y-2 text-[13px] leading-5">
          <div>
            <dt className="text-[var(--text-3)]">Project</dt>
            <dd className="break-words text-[var(--text)]">
              <Link href={`/hermes/projects/${item.projectId}`} className="underline-offset-2 hover:underline">
                {item.projectName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-3)]">Requested action</dt>
            <dd className="break-words text-[var(--text)]">{item.requestedAction ?? "withheld or unavailable"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-3)]">Execution boundary</dt>
            <dd className="break-words text-[var(--text)]">{item.executionBoundary ?? "unavailable"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-3)]">Approver on record</dt>
            <dd className="break-words text-[var(--text)]">{item.approver ?? "unavailable"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-3)]">Decided</dt>
            <dd className="break-all text-[var(--text)]">{formatWhen(item.decidedAt)}</dd>
          </div>
        </dl>
      </Panel>
      <Panel className="min-w-0 p-4">
        <Eyebrow>Mirror sync</Eyebrow>
        <p className="mt-2 text-[13px] leading-5 text-[var(--text-2)]">
          Integrity is fresh for {item.freshnessThreshold} after the last successful reconciliation.
          A mirrored grant outside that window is not valid.
        </p>
        <dl className="mt-3 space-y-2 text-[13px] leading-5">
          <div>
            <dt className="text-[var(--text-3)]">Last successful mirror sync</dt>
            <dd className="break-all text-[var(--text)]">{formatWhen(item.lastSuccessfulSyncAt)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-3)]">Approval row written</dt>
            <dd className="break-all text-[var(--text)]">{formatWhen(item.mirrorWrittenAt)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-3)]">Sync clock</dt>
            <dd className="text-[var(--text)]">{item.syncFresh ? "within 30 minutes" : "stale or unavailable"}</dd>
          </div>
        </dl>
        <ul className="mt-3 space-y-1 text-[12.5px] leading-5 text-[var(--text-3)]">
          {item.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Panel>
      <Panel className="min-w-0 p-4">
        <Eyebrow>Related Kanban</Eyebrow>
        {item.tasks.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-2)]">
            No related Kanban task is recorded on this approval in the mirror.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {item.tasks.map((task) => (
              <li key={task.id} className="min-w-0 text-[13px] leading-5">
                <p className="break-words font-medium text-[var(--text)]">{task.title}</p>
                <p className="break-all text-[var(--text-3)]">
                  {task.id} · board {task.board} · Kanban {task.kanbanStatus} · {task.normalizedStatus}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="min-w-0 p-4">
        <Eyebrow>Execution receipts</Eyebrow>
        {item.receipts.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-2)]">No execution receipt is linked in the mirror.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {item.receipts.map((receipt) => (
              <li key={receipt.id} className="min-w-0 text-[13px] leading-5">
                <p className="break-words text-[var(--text)]">{receipt.label}</p>
                <p className="break-all font-mono text-[12px] text-[var(--text-2)]">{receipt.id}</p>
                <p className="text-[var(--text-3)]">
                  Result {receipt.result} · integrity {receipt.integrity} · QC {receipt.qcVerdict ?? "unavailable"} ·{" "}
                  {formatWhen(receipt.finishedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function ApprovalDenied() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Panel className="p-4">
        <Eyebrow>Mission Control · Approvals</Eyebrow>
        <p className="mt-2 text-[14px] leading-5 text-[var(--text)]">
          This Google account is not on the Mission Control allowlist. Approval packages are unavailable.
        </p>
      </Panel>
    </div>
  );
}

export function ApprovalSchemaPending() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Panel className="p-4">
        <Eyebrow>Mission Control · Approvals</Eyebrow>
        <p className="mt-2 text-[14px] leading-5 text-[var(--text)]">
          Project state tables are not migrated yet. Approval packages are unavailable.
        </p>
      </Panel>
    </div>
  );
}

export function ApprovalReadFailed({ category }: { category: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Panel className="p-4">
        <Eyebrow>Mission Control · Approvals</Eyebrow>
        <p className="mt-2 text-[14px] leading-5 text-[var(--text)]">
          The approval mirror could not be read. Nothing on this page is a valid package. Diagnostic
          category: {category}.
        </p>
      </Panel>
    </div>
  );
}

export function ApprovalMissing() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Link href="/hermes/approvals" className="inline-flex min-h-11 items-center text-[13px] text-[var(--text-2)]">
        All approval packages
      </Link>
      <Panel className="p-4">
        <Eyebrow>Unavailable</Eyebrow>
        <p className="mt-2 text-[14px] leading-5 text-[var(--text)]">
          This approval is not in the mirror. Missing evidence is not a grant.
        </p>
      </Panel>
    </div>
  );
}
