import type { TaskAction } from "./api";
import type { Queue, TaskState } from "./types";

type BadgeVariant =
  | "primary"
  | "secondary"
  | "error"
  | "warning"
  | "success"
  | "info"
  | "neutral"
  | "blue"
  | "purple"
  | "teal"
  | "orange";

export interface TaskStateMeta {
  state: TaskState;
  label: string;
  description: string;
  /** Message shown when there are no tasks in this state. */
  emptyDescription: string;
  badge: BadgeVariant;
  /** Tailwind background class used for meters and legends. */
  colorClass: string;
  /** CSS color token matching colorClass, used by charts. */
  colorVar: string;
  /** Actions available for a single task or a selection of tasks. */
  actions: TaskAction[];
  /** Actions available for every task in the state at once. */
  allActions: TaskAction[];
  /** How tasks of this state are sorted, and the labels of both directions. */
  order: { by: string; desc: string; asc: string };
}

export const TASK_STATES: TaskStateMeta[] = [
  {
    state: "active",
    label: "Active",
    description: "Tasks currently being processed by a worker.",
    emptyDescription: "No worker is processing a task from this queue right now.",
    badge: "blue",
    colorClass: "bg-kumo-info",
    colorVar: "--color-kumo-info",
    actions: ["cancel"],
    allActions: ["cancel"],
    order: { by: "start order", desc: "Newest first", asc: "Oldest first" },
  },
  {
    state: "pending",
    label: "Pending",
    description: "Tasks ready to be processed as soon as a worker is available.",
    emptyDescription: "Every enqueued task has been picked up by a worker.",
    badge: "neutral",
    colorClass: "bg-kumo-badge-neutral",
    colorVar: "--color-kumo-badge-neutral",
    actions: ["archive", "delete"],
    allActions: ["archive", "delete"],
    order: { by: "enqueue order", desc: "Newest first", asc: "Oldest first" },
  },
  {
    state: "aggregating",
    label: "Aggregating",
    description: "Tasks waiting in a group to be aggregated into a single task.",
    emptyDescription: "No task group is waiting to be aggregated.",
    badge: "purple",
    colorClass: "bg-kumo-badge-purple",
    colorVar: "--color-kumo-badge-purple",
    actions: ["run", "archive", "delete"],
    allActions: ["run", "archive", "delete"],
    order: { by: "time added to the group", desc: "Newest first", asc: "Oldest first" },
  },
  {
    state: "scheduled",
    label: "Scheduled",
    description: "Tasks scheduled to be processed in the future.",
    emptyDescription: "No task is scheduled to run later.",
    badge: "teal",
    colorClass: "bg-kumo-badge-teal",
    colorVar: "--color-kumo-badge-teal",
    actions: ["run", "archive", "delete"],
    allActions: ["run", "archive", "delete"],
    order: { by: "scheduled time", desc: "Latest first", asc: "Soonest first" },
  },
  {
    state: "retry",
    label: "Retry",
    description: "Tasks that failed and will be retried automatically.",
    emptyDescription: "No failed task is waiting to be retried.",
    badge: "warning",
    colorClass: "bg-kumo-warning",
    colorVar: "--color-kumo-warning",
    actions: ["run", "archive", "delete"],
    allActions: ["run", "archive", "delete"],
    order: { by: "next retry time", desc: "Latest first", asc: "Soonest first" },
  },
  {
    state: "archived",
    label: "Archived",
    description: "Tasks that exhausted their retries or were archived manually.",
    emptyDescription: "No task has exhausted its retries.",
    badge: "error",
    colorClass: "bg-kumo-danger",
    colorVar: "--color-kumo-danger",
    actions: ["run", "delete"],
    allActions: ["run", "delete"],
    order: { by: "archive time", desc: "Newest first", asc: "Oldest first" },
  },
  {
    state: "completed",
    label: "Completed",
    description: "Tasks processed successfully and kept until their retention expires.",
    emptyDescription: "Completed tasks show up here when they are enqueued with a retention period.",
    badge: "success",
    colorClass: "bg-kumo-success",
    colorVar: "--color-kumo-success",
    actions: ["delete"],
    allActions: ["delete"],
    order: { by: "completion time", desc: "Newest first", asc: "Oldest first" },
  },
];

export const TASK_STATE_META = Object.fromEntries(TASK_STATES.map((m) => [m.state, m])) as Record<
  TaskState,
  TaskStateMeta
>;

export function isTaskState(value: string | null | undefined): value is TaskState {
  return !!value && value in TASK_STATE_META;
}

export function countForState(queue: Queue | undefined, state: TaskState): number {
  return queue ? queue[state] : 0;
}

export const ACTION_LABELS: Record<TaskAction, { label: string; past: string; verb: string }> = {
  run: { label: "Run now", past: "moved to pending", verb: "Run" },
  archive: { label: "Archive", past: "archived", verb: "Archive" },
  delete: { label: "Delete", past: "deleted", verb: "Delete" },
  cancel: { label: "Cancel", past: "sent a cancelation signal", verb: "Cancel" },
};
