export const HERMES_TASK_ACTIONS = [
  "complete",
  "block",
  "unblock",
  "promote",
  "archive",
] as const;

export type HermesTaskAction = (typeof HERMES_TASK_ACTIONS)[number];

export const HERMES_BLOCK_KINDS = [
  "capability",
  "dependency",
  "needs_input",
  "transient",
] as const;

export type HermesBlockKind = (typeof HERMES_BLOCK_KINDS)[number];

const ACTIONS_BY_STATUS: Readonly<Record<string, readonly HermesTaskAction[]>> = {
  todo: ["promote", "block", "archive"],
  ready: ["complete", "block", "archive"],
  blocked: ["unblock", "archive"],
  scheduled: ["unblock", "archive"],
};

const ACTION_LABELS: Readonly<Record<HermesTaskAction, string>> = {
  complete: "Complete",
  block: "Block",
  unblock: "Unblock",
  promote: "Promote",
  archive: "Archive",
};

export function isHermesTaskAction(value: unknown): value is HermesTaskAction {
  return typeof value === "string" && HERMES_TASK_ACTIONS.includes(value as HermesTaskAction);
}

export function isHermesBlockKind(value: unknown): value is HermesBlockKind {
  return typeof value === "string" && HERMES_BLOCK_KINDS.includes(value as HermesBlockKind);
}

export function taskActionsForStatus(status: unknown): readonly HermesTaskAction[] {
  if (typeof status !== "string") return [];
  return ACTIONS_BY_STATUS[status.trim().toLowerCase()] ?? [];
}

export function isTaskActionAllowed(status: unknown, action: HermesTaskAction): boolean {
  return taskActionsForStatus(status).includes(action);
}

export function taskActionLabel(action: HermesTaskAction): string {
  return ACTION_LABELS[action];
}

export function taskActionRequestKind(action: HermesTaskAction): `kanban.${HermesTaskAction}` {
  return `kanban.${action}`;
}
