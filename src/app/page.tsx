"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Inbox,
  ListChecks,
  RefreshCw,
  Server,
  Sunrise,
} from "lucide-react";
import {
  EmptyState,
  Eyebrow,
  Panel,
  Pill,
  SectionHeader,
  Skeleton,
} from "@/components/ui/kit";
import {
  briefingFallback,
  collectionFallback,
  deriveHermesStatus,
  findCurrentTask,
  summarizeTasks,
  type BriefingData,
  type HermesHealthData,
  type HermesTaskData,
} from "@/lib/dashboard";

interface AgentRequestData {
  id: string;
  title: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt?: string | null;
}

interface AgentEventData {
  id: string;
  title: string;
  kind: string;
  level: string;
  detail?: string | null;
  createdAt: string;
}

interface CronData {
  id: string;
  name: string;
  status: string;
  schedule: string;
  lastRun: string | null;
  lastResult: string | null;
  nextRun: string | null;
}

interface Resource<T> {
  data: T | null;
  connected: boolean;
  loaded: boolean;
}

interface DashboardResources {
  health: Resource<HermesHealthData>;
  requests: Resource<{ requests: AgentRequestData[]; pending: number }>;
  events: Resource<{ events: AgentEventData[] }>;
  tasks: Resource<{ tasks: HermesTaskData[]; total: number; lastSync: string | null }>;
  crons: Resource<{ jobs: CronData[]; syncedAt: string | null }>;
  briefing: Resource<BriefingData>;
}

interface ActivityRow {
  id: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
}

const EMPTY_RESOURCE = { data: null, connected: false, loaded: false } as const;

function initialResources(): DashboardResources {
  return {
    health: { ...EMPTY_RESOURCE },
    requests: { ...EMPTY_RESOURCE },
    events: { ...EMPTY_RESOURCE },
    tasks: { ...EMPTY_RESOURCE },
    crons: { ...EMPTY_RESOURCE },
    briefing: { ...EMPTY_RESOURCE },
  };
}

async function fetchResource<T>(url: string): Promise<Resource<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { data: null, connected: false, loaded: true };
    return { data: (await response.json()) as T, connected: true, loaded: true };
  } catch {
    return { data: null, connected: false, loaded: true };
  }
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return "No data yet";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "No data yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusTone(status: string): "neutral" | "up" | "down" | "warn" | "accent" {
  const normalized = status.toLowerCase();
  if (normalized.includes("done") || normalized === "up" || normalized.includes("complete")) return "up";
  if (normalized.includes("fail") || normalized === "down" || normalized.includes("reject")) return "down";
  if (normalized.includes("approval") || normalized.includes("block") || normalized === "warn") return "warn";
  if (normalized.includes("run") || normalized.includes("active") || normalized.includes("queue")) return "accent";
  return "neutral";
}

function mostRecent(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value && !Number.isNaN(new Date(value).getTime())))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return valid[0] ?? null;
}

export default function Dashboard() {
  const [resources, setResources] = useState<DashboardResources>(initialResources);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [health, requests, events, tasks, crons, briefing] = await Promise.all([
      fetchResource<HermesHealthData>("/api/hermes/health"),
      fetchResource<{ requests: AgentRequestData[]; pending: number }>("/api/hermes/requests?take=8"),
      fetchResource<{ events: AgentEventData[] }>("/api/hermes/activity?take=8"),
      fetchResource<{ tasks: HermesTaskData[]; total: number; lastSync: string | null }>("/api/hermes/tasks"),
      fetchResource<{ jobs: CronData[]; syncedAt: string | null }>("/api/hermes/crons"),
      fetchResource<BriefingData>("/api/hermes/briefing"),
    ]);
    setResources({ health, requests, events, tasks, crons, briefing });
    setRefreshedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const healthView = deriveHermesStatus(resources.health.data, resources.health.connected);
  const tasks = resources.tasks.data?.tasks ?? [];
  const taskSummary = summarizeTasks(tasks);
  const currentTask = findCurrentTask(resources.health.data, tasks);
  const requests = useMemo(
    () => resources.requests.data?.requests ?? [],
    [resources.requests.data?.requests],
  );
  const events = useMemo(
    () => resources.events.data?.events ?? [],
    [resources.events.data?.events],
  );
  const pendingApprovals = resources.requests.data?.pending ?? null;
  const cronJobs = resources.crons.data?.jobs ?? [];
  const activeCrons = cronJobs.filter((job) => job.status.toLowerCase() === "active").length;

  const recentActivity = useMemo<ActivityRow[]>(() => {
    const requestRows = requests.map((request) => ({
      id: `request-${request.id}`,
      title: request.title,
      detail: request.kind,
      status: request.status,
      createdAt: request.updatedAt ?? request.createdAt,
    }));
    const eventRows = events.map((event) => ({
      id: `event-${event.id}`,
      title: event.title,
      detail: event.detail ?? event.kind,
      status: event.level,
      createdAt: event.createdAt,
    }));
    return [...requestRows, ...eventRows]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);
  }, [events, requests]);

  const lastActivity = mostRecent([
    resources.health.data?.lastSeen,
    ...requests.map((request) => request.updatedAt ?? request.createdAt),
    ...events.map((event) => event.createdAt),
  ]);
  const recentFallback = collectionFallback({
    connected: resources.requests.connected || resources.events.connected,
    hasData: recentActivity.length > 0,
  });
  const taskFallback = collectionFallback({
    connected: resources.tasks.connected,
    hasData: tasks.length > 0,
    bridgeReported: Boolean(resources.tasks.data?.lastSync),
  });
  const cronFallback = collectionFallback({
    connected: resources.crons.connected,
    hasData: cronJobs.length > 0,
    bridgeReported: Boolean(resources.crons.data?.syncedAt),
  });
  const briefingMessage = briefingFallback(resources.briefing.data, resources.briefing.connected);
  const healthLoaded = resources.health.loaded;
  const allLoaded = Object.values(resources).every((resource) => resource.loaded);
  const operatorName = process.env.NEXT_PUBLIC_OWNER_NAME?.trim() || "Operator";

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      <header className="hq-rise pt-4 pb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>Operational overview</Eyebrow>
          <h1 className="mt-2.5 text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            Mission Control
          </h1>
          <p className="mt-3 text-[13px] text-[var(--text-3)]">
            Operator: <span className="text-[var(--text-2)]">{operatorName}</span>
            {refreshedAt && <span className="num"> · refreshed {formatRelative(refreshedAt)}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh operational data"
          className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-[12px] disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <section aria-labelledby="status-heading">
        <SectionHeader label="Now" title={<span id="status-heading">Hermes status</span>} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {!healthLoaded ? (
            <Skeleton className="h-44" />
          ) : (
            <Panel className="p-6 min-h-44">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>Runtime</Eyebrow>
                <Pill tone={healthView.status === "online" ? "up" : healthView.status === "offline" ? "down" : "neutral"}>
                  <CircleDot className="w-3 h-3" />
                  {healthView.label}
                </Pill>
              </div>
              <p className="mt-5 text-[14px] text-[var(--text-2)]">{healthView.detail}</p>
              <p className="mt-2 num text-[11px] text-[var(--text-3)]">
                Last activity: {lastActivity ? formatRelative(lastActivity) : "No data yet"}
              </p>
              <div className="mt-5 pt-4 border-t border-[var(--line)]">
                <p className="eyebrow !text-[9.5px]">Current task</p>
                <p className="mt-1.5 text-[13px] text-[var(--text-2)] line-clamp-2">
                  {currentTask ?? (resources.tasks.connected ? "No data yet" : "Not connected")}
                </p>
              </div>
            </Panel>
          )}

          {!resources.requests.loaded ? (
            <Skeleton className="h-44" />
          ) : (
            <Panel className="p-6 min-h-44">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>Approval queue</Eyebrow>
                <Inbox className="w-4 h-4 text-[var(--warn)]" />
              </div>
              {resources.requests.connected ? (
                <>
                  <p className="num mt-5 text-[46px] leading-none font-semibold text-[var(--text)]">
                    {pendingApprovals ?? 0}
                  </p>
                  <p className="mt-2 text-[13px] text-[var(--text-3)]">awaiting approval</p>
                </>
              ) : (
                <p className="mt-7 text-[14px] text-[var(--text-2)]">Not connected</p>
              )}
              <Link href="/hermes" className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)]">
                Open approval inbox <ArrowRight className="w-3 h-3" />
              </Link>
            </Panel>
          )}

          {!resources.tasks.loaded ? (
            <Skeleton className="h-44" />
          ) : (
            <Panel className="p-6 min-h-44">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>Task overview</Eyebrow>
                <ListChecks className="w-4 h-4 text-[var(--accent)]" />
              </div>
              {taskFallback ? (
                <p className="mt-7 text-[14px] text-[var(--text-2)]">{taskFallback}</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 mt-6">
                  {[
                    ["To do", taskSummary.todo],
                    ["Active", taskSummary.active],
                    ["Done", taskSummary.completed],
                  ].map(([label, count]) => (
                    <div key={label} className="min-w-0">
                      <p className="num text-[25px] font-semibold text-[var(--text)]">{count}</p>
                      <p className="mt-1 text-[10.5px] text-[var(--text-3)]">{label}</p>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/tasks" className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)]">
                Open task board <ArrowRight className="w-3 h-3" />
              </Link>
            </Panel>
          )}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="runs-heading">
        <SectionHeader label="Activity" title={<span id="runs-heading">Recent runs</span>} />
        {!resources.requests.loaded || !resources.events.loaded ? (
          <Skeleton className="h-64" />
        ) : recentFallback ? (
          <Panel className="p-2">
            <EmptyState icon={<Activity className="w-6 h-6" />} title={recentFallback} />
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="divide-y divide-[var(--line)]">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-4 px-5 py-4">
                  <Clock3 className="w-4 h-4 text-[var(--text-3)] mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium text-[var(--text)] truncate">{item.title}</p>
                    <p className="mt-1 text-[12px] text-[var(--text-3)] line-clamp-1">{item.detail}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Pill tone={statusTone(item.status)}>{item.status}</Pill>
                    <span className="num text-[10px] text-[var(--text-3)]">{formatRelative(item.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </section>

      <section className="mt-12" aria-labelledby="health-heading">
        <SectionHeader label="Operations" title={<span id="health-heading">Health and cron summary</span>} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {!resources.health.loaded ? (
            <Skeleton className="h-52" />
          ) : (
            <Panel className="p-6 min-h-52">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-[var(--accent)]" />
                <Eyebrow>Bridge health</Eyebrow>
              </div>
              <p className="mt-6 text-[19px] font-semibold text-[var(--text)]">{healthView.label}</p>
              <p className="mt-2 text-[13px] text-[var(--text-2)]">{healthView.detail}</p>
              <p className="mt-5 num text-[11px] text-[var(--text-3)]">
                Last report: {resources.health.data?.lastSeen ? formatRelative(resources.health.data.lastSeen) : healthView.detail}
              </p>
            </Panel>
          )}

          {!resources.crons.loaded ? (
            <Skeleton className="h-52" />
          ) : (
            <Panel className="p-6 min-h-52">
              <div className="flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-[var(--accent)]" />
                <Eyebrow>Schedules</Eyebrow>
              </div>
              {cronFallback ? (
                <p className="mt-8 text-[14px] text-[var(--text-2)]">{cronFallback}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div>
                      <p className="num text-[30px] font-semibold text-[var(--text)]">{activeCrons}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-3)]">active</p>
                    </div>
                    <div>
                      <p className="num text-[30px] font-semibold text-[var(--text)]">{cronJobs.length}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-3)]">total</p>
                    </div>
                  </div>
                  <p className="mt-5 num text-[11px] text-[var(--text-3)]">
                    Synced {formatRelative(resources.crons.data?.syncedAt)}
                  </p>
                </>
              )}
            </Panel>
          )}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="briefing-heading">
        <SectionHeader label="Briefing" title={<span id="briefing-heading">Daily briefing</span>} />
        {!resources.briefing.loaded ? (
          <Skeleton className="h-56" />
        ) : briefingMessage ? (
          <Panel className="p-2">
            <EmptyState icon={<Sunrise className="w-6 h-6" />} title={briefingMessage} />
          </Panel>
        ) : (
          <Panel className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sunrise className="w-4 h-4 text-[var(--accent)]" />
                <Eyebrow>Hermes briefing</Eyebrow>
              </div>
              <span className="num text-[11px] text-[var(--text-3)]">
                {formatRelative(resources.briefing.data?.generatedAt)}
              </span>
            </div>
            {resources.briefing.data?.greeting && (
              <p className="mt-5 text-[15px] font-medium text-[var(--text)]">{resources.briefing.data.greeting}</p>
            )}
            {resources.briefing.data?.summary && (
              <p className="mt-2 max-w-[80ch] text-[14px] leading-relaxed text-[var(--text-2)]">
                {resources.briefing.data.summary}
              </p>
            )}
            {(resources.briefing.data?.sections ?? []).length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-7">
                {resources.briefing.data?.sections?.map((section) => (
                  <div key={section.label}>
                    <Eyebrow className="!text-[9.5px]">{section.label}</Eyebrow>
                    <div className="mt-2 divide-y divide-[var(--line)]">
                      {section.items.map((item) => (
                        <p key={item} className="py-2 text-[13px] leading-snug text-[var(--text-2)]">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </section>

      {allLoaded && !resources.health.connected && !resources.requests.connected && !resources.tasks.connected && (
        <div className="mt-8 flex items-center gap-2 text-[12px] text-[var(--text-3)]">
          <CheckCircle2 className="w-3.5 h-3.5" />
          The shell is available, but operational data is not connected.
        </div>
      )}
    </div>
  );
}
