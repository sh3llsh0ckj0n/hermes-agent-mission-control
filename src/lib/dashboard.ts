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

export type HermesStatus = "online" | "offline" | "unknown";

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

export function findCurrentTask(
  health: HermesHealthData | null,
  tasks: HermesTaskData[],
): string | null {
  if (health?.currentTask?.trim()) return health.currentTask.trim();
  return tasks.find((task) => taskBucket(task.status) === "active")?.title ?? null;
}
