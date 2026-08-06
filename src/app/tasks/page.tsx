"use client";

import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";

import {
  EmptyState,
  Eyebrow,
  Panel,
  Pill,
  Skeleton,
  rise,
} from "@/components/ui/kit";
import { fetchHermesJSON } from "@/lib/hermes-client";
import { taskBoardEmptyMessage, taskBucket } from "@/lib/dashboard";

interface HermesTask {
  id: string;
  board: string;
  title: string;
  assignee?: string | null;
  status: string;
  priority?: number | null;
  result?: string | null;
  updatedAt: string;
  syncedAt: string;
}

interface HermesTasksResponse {
  tasks: HermesTask[];
  counts: Record<string, number>;
  total: number;
  lastSync: string | null;
}

type LoadState = "loading" | "ready" | "not-connected";
type TaskColumn = "todo" | "active" | "completed";

const COLUMNS: ReadonlyArray<{
  id: TaskColumn;
  label: string;
  tone: "neutral" | "accent" | "up";
}> = [
  { id: "todo", label: "To do", tone: "neutral" },
  { id: "active", label: "Active", tone: "accent" },
  { id: "completed", label: "Completed", tone: "up" },
];

function formatLastSync(value: string | null): string {
  if (!value) return "Not reported";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Not reported";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function resultPreview(value: string | null | undefined): string | null {
  const result = value?.trim();
  if (!result) return null;
  return result.length > 220 ? `${result.slice(0, 217)}…` : result;
}

export default function TasksPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [taskData, setTaskData] = useState<HermesTasksResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      const result = await fetchHermesJSON<HermesTasksResponse>(
        "/api/hermes/tasks",
      );
      if (cancelled) return;

      if (result.status === "ok") {
        setTaskData(result.data);
        setLoadState("ready");
        return;
      }

      setTaskData(null);
      setLoadState("not-connected");
    }

    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState === "loading") return <TaskBoardSkeleton />;

  const tasks = taskData?.tasks ?? [];
  const emptyMessage = taskBoardEmptyMessage({
    connected: loadState === "ready",
    taskCount: tasks.length,
    lastSync: taskData?.lastSync ?? null,
  });

  return (
    <div className="relative z-10 w-full mx-auto pt-4 pb-16">
      <header
        className="hq-rise flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between mb-10"
        style={rise(0)}
      >
        <div>
          <Eyebrow>Hermes task board</Eyebrow>
          <h1 className="mt-2.5 text-[36px] sm:text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            Tasks
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-[var(--text-3)]">
            Read-only work mirrored from the Hermes kanban board.
          </p>
        </div>

        <div className="flex items-center gap-5 sm:text-right">
          <div>
            <p className="num text-[18px] font-semibold text-[var(--text)]">
              {taskData?.total ?? 0}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">
              Total tasks
            </p>
          </div>
          <div className="h-8 w-px bg-[var(--line)]" />
          <div>
            <p className="num text-[12px] font-medium text-[var(--text-2)]">
              {formatLastSync(taskData?.lastSync ?? null)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">
              Last synchronized
            </p>
          </div>
        </div>
      </header>

      {emptyMessage ? (
        <Panel className="hq-rise p-2" style={rise(1)}>
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title={emptyMessage}
            hint={
              emptyMessage === "Not connected"
                ? "The Hermes task API is unavailable. No task data is being inferred."
                : emptyMessage === "Bridge has not reported"
                  ? "The bridge has not completed its first task-board synchronization."
                  : "The bridge synchronized successfully and the Hermes board is empty."
            }
          />
        </Panel>
      ) : (
        <TaskColumns tasks={tasks} />
      )}
    </div>
  );
}

function TaskColumns({ tasks }: { tasks: HermesTask[] }) {
  const grouped = COLUMNS.reduce<Record<TaskColumn, HermesTask[]>>(
    (columns, column) => {
      columns[column.id] = [];
      return columns;
    },
    { todo: [], active: [], completed: [] },
  );

  for (const task of tasks) {
    grouped[taskBucket(task.status)].push(task);
  }

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {COLUMNS.map((column, index) => (
        <section
          key={column.id}
          className="hq-rise panel flex min-h-56 flex-col overflow-hidden"
          style={rise(index + 1)}
        >
          <div className="flex items-center justify-between px-4 py-3.5">
            <Eyebrow>{column.label}</Eyebrow>
            <span className="num text-[11px] text-[var(--text-3)]">
              {grouped[column.id].length}
            </span>
          </div>
          <div className="rule" />
          <div className="flex flex-1 flex-col gap-2.5 p-2.5">
            {grouped[column.id]
              .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
              .map((task) => (
                <TaskCard key={task.id} task={task} tone={column.tone} />
              ))}
            {grouped[column.id].length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-[var(--text-4)]">
                No tasks
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  tone,
}: {
  task: HermesTask;
  tone: "neutral" | "accent" | "up";
}) {
  const result = resultPreview(task.result);

  return (
    <article
      className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-1)] p-3.5"
      style={{
        borderLeft: `2px solid color-mix(in srgb, ${
          tone === "neutral" ? "var(--text-3)" : `var(--${tone})`
        } 55%, transparent)`,
      }}
    >
      <p className="text-[13px] font-medium leading-relaxed text-[var(--text)]">
        {task.title}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{task.status}</Pill>
        {task.assignee && (
          <span className="text-[11px] text-[var(--text-3)]">
            {task.assignee}
          </span>
        )}
        {task.priority != null && (
          <span className="num ml-auto text-[10.5px] text-[var(--text-3)]">
            P{task.priority}
          </span>
        )}
      </div>

      {result && (
        <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11.5px] leading-relaxed text-[var(--text-3)]">
          {result}
        </p>
      )}
    </article>
  );
}

function TaskBoardSkeleton() {
  return (
    <div className="relative z-10 w-full mx-auto pt-4 pb-16">
      <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-10 w-36" />
          <Skeleton className="mt-4 h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-12 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {[0, 1, 2].map((column) => (
          <Panel key={column} className="p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-5" />
            </div>
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-24" />
              <Skeleton className="h-20" />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
