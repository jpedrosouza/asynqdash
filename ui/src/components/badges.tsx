import { Badge, Tooltip, cn } from "@cloudflare/kumo";
import { TASK_STATE_META, TASK_STATES } from "../lib/task-states";
import type { Queue, TaskState } from "../lib/types";
import { formatNumber, formatPercent, ratio } from "../lib/format";

export function TaskStateBadge({ state }: { state: TaskState }) {
  const meta = TASK_STATE_META[state];
  if (!meta) return <Badge variant="neutral">{state}</Badge>;
  return <Badge variant={meta.badge}>{meta.label}</Badge>;
}

export function QueueStatusBadge({ paused }: { paused: boolean }) {
  return paused ? (
    <Badge variant="warning" appearance="dot">
      Paused
    </Badge>
  ) : (
    <Badge variant="success" appearance="dot">
      Running
    </Badge>
  );
}

/** Horizontal bar showing how the tasks of a queue are distributed across states. */
export function StateDistributionBar({ queue, className }: { queue: Queue; className?: string }) {
  const total = TASK_STATES.reduce((sum, m) => sum + queue[m.state], 0);
  if (total === 0) {
    return <div className={cn("h-1.5 w-full rounded-full bg-kumo-recessed", className)} aria-label="Empty queue" />;
  }
  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1 py-0.5 text-xs">
          {TASK_STATES.filter((m) => queue[m.state] > 0).map((m) => (
            <div key={m.state} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", m.colorClass)} />
                {m.label}
              </span>
              <span className="tabular">
                {formatNumber(queue[m.state])} · {formatPercent(ratio(queue[m.state], total))}
              </span>
            </div>
          ))}
        </div>
      }
    >
      <div
        className={cn("flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-kumo-recessed", className)}
        role="img"
        aria-label="Task state distribution"
      >
        {TASK_STATES.filter((m) => queue[m.state] > 0).map((m) => (
          <span
            key={m.state}
            className={cn("h-full min-w-[3px] transition-[width] duration-500", m.colorClass)}
            style={{ width: `${(queue[m.state] / total) * 100}%` }}
          />
        ))}
      </div>
    </Tooltip>
  );
}
