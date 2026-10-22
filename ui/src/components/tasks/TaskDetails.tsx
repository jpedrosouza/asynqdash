import type { ReactNode } from "react";
import { Badge, Banner, Button, InlineCopyText, Meter, cn } from "@cloudflare/kumo";
import { ClockIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import type { TaskInfo } from "../../lib/types";
import { READ_ONLY } from "../../lib/flags";
import { TASK_STATE_META, ACTION_LABELS } from "../../lib/task-states";
import { formatDateTime, formatDuration, formatRelativeLong, parseTime } from "../../lib/format";
import { useSettings } from "../../lib/settings";
import { useNow } from "../../lib/hooks";
import { TaskStateBadge } from "../badges";
import { Card, KeyValue, RelativeTime } from "../common";
import { JsonView } from "../JsonView";
import { ACTION_ICONS } from "./TaskActionIcons";
import type { ActionRequest } from "./useTaskActionRunner";

/** Header with the task type, state and id. */
export function TaskHeading({ task }: { task: TaskInfo }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="truncate font-mono text-lg font-semibold text-kumo-default md:text-xl">{task.type}</h1>
        <TaskStateBadge state={task.state} />
        {task.is_orphaned && (
          <Badge variant="warning" icon={<WarningIcon />}>
            Orphaned
          </Badge>
        )}
      </div>
      <InlineCopyText value={task.id} labels={{ copyAction: "Copy task ID", copied: "Task ID copied" }}>
        {task.id}
      </InlineCopyText>
    </div>
  );
}

/** Buttons for the actions available in the task's current state. */
export function TaskActionButtons({
  task,
  onAction,
  disabled,
  size = "sm",
}: {
  task: TaskInfo;
  onAction: (req: ActionRequest) => void;
  disabled?: boolean;
  size?: "sm" | "base";
}) {
  if (READ_ONLY) return null;
  const actions = TASK_STATE_META[task.state]?.actions ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action}
          size={size}
          variant={action === "delete" ? "secondary-destructive" : action === "run" ? "primary" : "secondary"}
          icon={ACTION_ICONS[action]}
          disabled={disabled}
          onClick={() => onAction({ action, scope: "single", ids: [task.id], count: 1 })}
        >
          {ACTION_LABELS[action].label}
        </Button>
      ))}
    </div>
  );
}

interface TimelineEvent {
  label: string;
  time: Date;
  tone: "neutral" | "danger" | "success" | "info";
  detail?: ReactNode;
}

function TaskTimeline({ task }: { task: TaskInfo }) {
  const { settings } = useSettings();
  const now = useNow(5000);
  const events: TimelineEvent[] = [];
  const started = parseTime(task.start_time);
  const failed = parseTime(task.last_failed_at);
  const next = parseTime(task.next_process_at);
  const completed = parseTime(task.completed_at);
  const deadline = parseTime(task.deadline);
  if (started && task.state === "active") events.push({ label: "Started processing", time: started, tone: "info" });
  if (failed) events.push({ label: "Last failure", time: failed, tone: "danger" });
  if (completed) events.push({ label: "Completed", time: completed, tone: "success" });
  if (next && task.state !== "completed" && task.state !== "archived") {
    events.push({
      label:
        task.state === "retry" ? "Next retry" : task.state === "scheduled" ? "Scheduled to run" : "Next process time",
      time: next,
      tone: "neutral",
    });
  }
  if (deadline) events.push({ label: "Deadline", time: deadline, tone: "neutral" });
  events.sort((a, b) => a.time.getTime() - b.time.getTime());

  if (events.length === 0) {
    return <p className="text-sm text-kumo-subtle">No timing information for this task yet.</p>;
  }
  return (
    <ol className="relative flex flex-col gap-4 border-l border-kumo-hairline pl-5">
      {events.map((e) => (
        <li key={e.label} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-kumo-base",
              e.tone === "danger" && "bg-kumo-danger",
              e.tone === "success" && "bg-kumo-success",
              e.tone === "info" && "bg-kumo-info",
              e.tone === "neutral" && "bg-kumo-fill",
            )}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-kumo-default">{e.label}</span>
            <span className="text-xs text-kumo-subtle">{formatRelativeLong(e.time, now)}</span>
          </div>
          <div className="text-xs text-kumo-subtle">{formatDateTime(e.time, settings.timeZone)}</div>
        </li>
      ))}
    </ol>
  );
}

/** Full description of a task: errors, overview, timeline, payload and result. */
export function TaskDetailsBody({ task }: { task: TaskInfo }) {
  const retryRatio = task.max_retry > 0 ? task.retried / task.max_retry : 0;
  return (
    <div className="flex flex-col gap-4">
      {task.error_message && (
        <Banner
          variant="error"
          icon={<WarningCircleIcon weight="fill" />}
          title={task.state === "archived" ? "Task failed and exhausted its retries" : "Last attempt failed"}
          description={<span className="font-mono text-xs break-words whitespace-pre-wrap">{task.error_message}</span>}
        />
      )}
      {task.is_orphaned && (
        <Banner
          variant="alert"
          icon={<WarningIcon weight="fill" />}
          title="This task looks orphaned"
          description="It is marked as active but no worker reports it. It will be recovered automatically when its lease expires."
        />
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Overview">
          <dl className="divide-y divide-kumo-hairline">
            <KeyValue label="Queue">{task.queue}</KeyValue>
            <KeyValue label="State">
              <TaskStateBadge state={task.state} />
            </KeyValue>
            {task.group && <KeyValue label="Group">{task.group}</KeyValue>}
            <KeyValue label="Retries">
              <div className="flex max-w-xs flex-col gap-1">
                <Meter
                  label={`${task.retried} of ${task.max_retry} used`}
                  value={task.retried}
                  max={Math.max(task.max_retry, 1)}
                  showValue={false}
                  indicatorClassName={retryRatio >= 1 ? "from-kumo-danger via-kumo-danger to-kumo-danger" : undefined}
                />
              </div>
            </KeyValue>
            <KeyValue label="Timeout">{task.timeout_seconds > 0 ? formatDuration(task.timeout_seconds) : "—"}</KeyValue>
            <KeyValue label="Deadline">
              <RelativeTime value={task.deadline} />
            </KeyValue>
            {task.state === "completed" && (
              <KeyValue label="Retention">
                {task.ttl_seconds > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <ClockIcon className="text-kumo-subtle" />
                    Kept for another {formatDuration(task.ttl_seconds)}
                  </span>
                ) : (
                  "Expired"
                )}
              </KeyValue>
            )}
          </dl>
        </Card>
        <Card title="Timeline">
          <TaskTimeline task={task} />
        </Card>
      </div>
      <Card title="Payload">
        <JsonView value={task.payload} filename={`${task.type}-${task.id}-payload`} />
      </Card>
      {task.state === "completed" && (
        <Card title="Result">
          <JsonView value={task.result} filename={`${task.type}-${task.id}-result`} />
        </Card>
      )}
    </div>
  );
}
