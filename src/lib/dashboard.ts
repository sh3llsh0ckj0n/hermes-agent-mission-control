export const DASHBOARD_FALLBACKS = {
  notConnected: "Not connected",
  noData: "No data yet",
  bridgeNotReported: "Bridge has not reported",
} as const;

export interface HermesHealthData {
  online?: boolean | null;
  gateway?: string | null;
  detail?: string | null;
  lastSeen?: string | null;
  currentTask?: string | null;
}

export interface HermesTaskData {
  id: string;
  title: string;
  status: string;
  syncedAt?: string | null;
}

export interface BriefingData {
  generatedAt?: string | null;
  greeting?: string | null;
  summary?: string | null;
  sections?: Array<{ label: string; items: string[] }>;
}

export interface HermesUsagePeriod {
  label: string | null;
  start: string | null;
  end: string | null;
  days: number | null;
}

export interface HermesModelUsage {
  model: string;
  sessions: number | null;
  tokens: number | null;
}

export interface HermesUsageReport {
  period: HermesUsagePeriod;
  totalSessions: number | null;
  totalMessages: number | null;
  userMessages: number | null;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  byModel: HermesModelUsage[];
  syncedAt: string | null;
  raw: string | null;
}

export type HermesStatus = "online" | "offline" | "unknown";

function usageRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function usageString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function usageInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

function usageCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function normalizeHermesUsageReport(value: unknown): HermesUsageReport {
  const report = usageRecord(value);
  const period = usageRecord(report?.period);
  const modelRows = Array.isArray(report?.byModel) ? report.byModel : [];
  const byModel = modelRows.flatMap((entry): HermesModelUsage[] => {
    const row = usageRecord(entry);
    const model = usageString(row?.model);
    return model
      ? [{
          model,
          sessions: usageInteger(row?.sessions),
          tokens: usageInteger(row?.tokens),
        }]
      : [];
  });

  return {
    period: {
      label: usageString(period?.label),
      start: usageString(period?.start),
      end: usageString(period?.end),
      days: usageInteger(period?.days),
    },
    totalSessions: usageInteger(report?.totalSessions),
    totalMessages: usageInteger(report?.totalMessages),
    userMessages: usageInteger(report?.userMessages),
    toolCalls: usageInteger(report?.toolCalls),
    inputTokens: usageInteger(report?.inputTokens),
    outputTokens: usageInteger(report?.outputTokens),
    totalTokens: usageInteger(report?.totalTokens),
    totalCost: usageCost(report?.totalCost),
    byModel,
    syncedAt: usageString(report?.syncedAt),
    raw: usageString(report?.raw) ?? usageString(report?.summary),
  };
}

export function modelTokenPercentage(
  modelTokens: number | null,
  reportedModelTokens: number,
): number | null {
  if (
    modelTokens === null ||
    !Number.isFinite(modelTokens) ||
    modelTokens < 0 ||
    !Number.isFinite(reportedModelTokens) ||
    reportedModelTokens <= 0
  ) {
    return null;
  }
  return (modelTokens / reportedModelTokens) * 100;
}

export function deriveHermesStatus(
  health: HermesHealthData | null,
  connected: boolean,
): { status: HermesStatus; label: string; detail: string } {
  if (!connected) {
    return { status: "unknown", label: "Unknown", detail: DASHBOARD_FALLBACKS.notConnected };
  }
  if (!health?.lastSeen) {
    return { status: "unknown", label: "Unknown", detail: DASHBOARD_FALLBACKS.bridgeNotReported };
  }
  if (health.online === true) {
    return { status: "online", label: "Online", detail: health.gateway ? `Gateway ${health.gateway}` : "Bridge connected" };
  }
  if (health.online === false) {
    return { status: "offline", label: "Offline", detail: health.gateway ? `Gateway ${health.gateway}` : "Bridge reported offline" };
  }
  return { status: "unknown", label: "Unknown", detail: "Bridge status is unavailable" };
}

export function collectionFallback({
  connected,
  hasData,
  bridgeReported = true,
}: {
  connected: boolean;
  hasData: boolean;
  bridgeReported?: boolean;
}): string | null {
  if (!connected) return DASHBOARD_FALLBACKS.notConnected;
  if (!bridgeReported) return DASHBOARD_FALLBACKS.bridgeNotReported;
  if (!hasData) return DASHBOARD_FALLBACKS.noData;
  return null;
}

export function briefingFallback(briefing: BriefingData | null, connected: boolean): string | null {
  if (!connected) return DASHBOARD_FALLBACKS.notConnected;
  const hasContent = Boolean(
    briefing?.generatedAt &&
      (briefing.summary?.trim() || briefing.sections?.some((section) => section.items.length > 0)),
  );
  return hasContent ? null : DASHBOARD_FALLBACKS.noData;
}

function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/[\s_-]+/g, "");
}

export function taskBucket(status: string): "todo" | "active" | "completed" {
  const normalized = normalizeStatus(status);
  if (normalized.includes("done") || normalized.includes("complete")) return "completed";
  if (
    normalized.includes("run") ||
    normalized.includes("active") ||
    normalized.includes("progress") ||
    normalized.includes("doing") ||
    normalized.includes("review") ||
    normalized.includes("blocked")
  ) {
    return "active";
  }
  return "todo";
}

export function summarizeTasks(tasks: HermesTaskData[]): { todo: number; active: number; completed: number } {
  return tasks.reduce(
    (summary, task) => {
      summary[taskBucket(task.status)] += 1;
      return summary;
    },
    { todo: 0, active: 0, completed: 0 },
  );
}

export function taskBoardEmptyMessage({
  connected,
  taskCount,
  lastSync,
}: {
  connected: boolean;
  taskCount: number;
  lastSync: string | null;
}): string | null {
  if (!connected) return DASHBOARD_FALLBACKS.notConnected;
  if (taskCount > 0) return null;
  return lastSync ? "No tasks yet" : DASHBOARD_FALLBACKS.bridgeNotReported;
}

export function findCurrentTask(
  health: HermesHealthData | null,
  tasks: HermesTaskData[],
): string | null {
  if (health?.currentTask?.trim()) return health.currentTask.trim();
  return tasks.find((task) => taskBucket(task.status) === "active")?.title ?? null;
}
