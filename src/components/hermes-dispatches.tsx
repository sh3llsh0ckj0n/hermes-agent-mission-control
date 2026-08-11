"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionHeader, Panel, Pill, EmptyState } from "@/components/ui/kit";
import { Send } from "lucide-react";
import { parseHermesStatusResult } from "@/lib/hermes-status-result";

type Req = {
  id: string;
  origin: string;
  kind: string;
  title: string;
  prompt: string | null;
  sideEffecting: boolean;
  status: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function ago(d: string | null): string {
  if (!d) return "";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TONE: Record<string, "neutral" | "up" | "down" | "warn" | "accent"> = {
  queued: "neutral",
  awaiting_approval: "warn",
  approved: "accent",
  running: "accent",
  done: "up",
  failed: "down",
  rejected: "neutral",
};
const LABEL: Record<string, string> = {
  queued: "Queued",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  running: "Running",
  done: "Done",
  failed: "Failed",
  rejected: "Rejected",
};

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

function DiagnosticField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-3)]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-[12.5px] text-[var(--text-2)]">
        {tone ? <Pill tone={tone}>{value}</Pill> : value}
      </dd>
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function DiagnosticStatusResult({ result }: { result: string }) {
  const status = parseHermesStatusResult(result);
  const gatewayValue = status.gateway.running === true
    ? "Running"
    : status.gateway.running === false
      ? status.gateway.status ?? "Stopped"
      : status.gateway.status ?? "Unknown";
  const gatewayTone: Tone = status.gateway.running === true
    ? "up"
    : status.gateway.running === false
      ? "down"
      : "neutral";
  const jobs = status.jobs.active !== null && status.jobs.total !== null
    ? `${formatCount(status.jobs.active)} active / ${formatCount(status.jobs.total)} total`
    : status.jobs.active !== null
      ? `${formatCount(status.jobs.active)} active`
      : status.jobs.total !== null
        ? `${formatCount(status.jobs.total)} total`
        : "Not reported";
  const sessions = status.sessions.active === null
    ? "Not reported"
    : `${formatCount(status.sessions.active)} active`;

  return (
    <div className="mt-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--text-3)]">Diagnostic</span>
        <Pill tone="neutral">READ ONLY</Pill>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <DiagnosticField label="Gateway" value={gatewayValue} tone={gatewayTone} />
        <DiagnosticField label="Manager" value={status.gateway.manager ?? "Not reported"} />
        <DiagnosticField label="Model" value={status.model ?? "Not reported"} />
        <DiagnosticField label="Provider" value={status.provider ?? "Not reported"} />
        <DiagnosticField label="Backend" value={status.terminal.backend ?? "Not reported"} />
        <DiagnosticField
          label="Sudo"
          value={status.terminal.sudoEnabled === false
            ? "Disabled"
            : status.terminal.sudoEnabled === true
              ? "Enabled"
              : "Unknown"}
          tone="neutral"
        />
        <DiagnosticField label="Jobs" value={jobs} />
        <DiagnosticField label="Sessions" value={sessions} />
        <DiagnosticField label="Last activity" value={status.sessions.lastActivity ?? "Not reported"} />
        <DiagnosticField label="Python" value={status.python ?? "Not reported"} />
      </dl>
      <details className="mt-3 border-t border-[var(--line)] pt-2.5">
        <summary className="cursor-pointer text-[11.5px] text-[var(--text-3)] hover:text-[var(--text-2)]">
          Show raw output
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre rounded-[8px] bg-[var(--surface)] p-3 text-[11px] leading-relaxed text-[var(--text-3)]">{status.raw}</pre>
      </details>
    </div>
  );
}

export function HermesDispatches({ refreshKey }: { refreshKey: number }) {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes/requests?take=15");
      if (r.ok) { const d = await r.json(); setReqs(d.requests ?? []); }
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const initial = setTimeout(load, 0);
    const iv = setInterval(load, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(iv);
    };
  }, [load, refreshKey]);

  return (
    <div>
      <SectionHeader label="Dispatches" title="What you've sent Hermes" />
      {!loaded ? (
        <Panel><div className="sk h-24 m-1 rounded-[10px]" /></Panel>
      ) : reqs.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Send className="w-5 h-5" />}
            title="No dispatches yet"
            hint="Send a task with ⌘K or the bar above — it'll appear here with its live status and result."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-2.5">
          {reqs.map((r) => {
            const tone = TONE[r.status] ?? "neutral";
            const running = r.status === "running";
            return (
              <div key={r.id} className="panel p-4">
                <div className="flex items-center gap-3">
                  {running && (
                    <span className="relative flex w-1.5 h-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }} />
                      <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                    </span>
                  )}
                  <p className="flex-1 min-w-0 text-[14px] text-[var(--text)] truncate">{r.title}</p>
                  <Pill tone={tone}>{LABEL[r.status] ?? r.status}</Pill>
                  <span className="num text-[11px] text-[var(--text-3)] shrink-0 w-16 text-right">{ago(r.createdAt)}</span>
                </div>
                {r.kind === "diagnostic.status" && r.status === "done" && r.result ? (
                  <DiagnosticStatusResult result={r.result} />
                ) : (r.result || r.error) && (
                  <p className={`mt-2.5 text-[12.5px] leading-snug whitespace-pre-wrap line-clamp-4 ${r.error ? "text-[var(--down)]" : "text-[var(--text-2)]"}`}>
                    {r.error || r.result}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
