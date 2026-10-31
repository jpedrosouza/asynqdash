import type { ReactNode } from "react";
import { Badge, Banner, Button, InlineCopyText, Link, Meter, Table, cn } from "@cloudflare/kumo";
import { ClockIcon, GitForkIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import type { TaskInfo } from "../../lib/types";
import { READ_ONLY } from "../../lib/flags";
import { TASK_STATE_META, ACTION_LABELS } from "../../lib/task-states";
import {
  formatDateTime,
  formatDuration,
  formatMs,
  formatNumber,
  formatRelativeLong,
  payloadPreview,
  parseTime,
  shortId,
} from "../../lib/format";
import { flowRunPath, paths, taskPath } from "../../lib/paths";
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
  const enqueued = parseTime(task.enqueued_at);
  const started = parseTime(task.start_time);
  const lastStarted = parseTime(task.started_at);
  const failed = parseTime(task.last_failed_at);
  const next = parseTime(task.next_process_at);
  const completed = parseTime(task.completed_at);
  const deadline = parseTime(task.deadline);
  if (enqueued) events.push({ label: "Enqueued", time: enqueued, tone: "neutral" });
  if (started && task.state === "active") {
    events.push({ label: "Started processing", time: started, tone: "info" });
  } else if (lastStarted) {
    events.push({
      label: task.retried > 0 ? "Last attempt started" : "Started processing",
      time: lastStarted,
      tone: "info",
      detail: task.wait_ms !== undefined ? `after waiting ${formatMs(task.wait_ms)} in the queue` : undefined,
    });
  }
  const tookDetail = task.duration_ms !== undefined ? `took ${formatMs(task.duration_ms)}` : undefined;
  if (failed) {
    events.push({ label: "Last failure", time: failed, tone: "danger", detail: completed ? undefined : tookDetail });
  }
  if (completed) events.push({ label: "Completed", time: completed, tone: "success", detail: tookDetail });
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
          {e.detail && <div className="text-xs font-medium text-kumo-default">{e.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Time spent waiting and processing, as a bar: where the time of the task went. */
function TimingBar({ task }: { task: TaskInfo }) {
  if (task.duration_ms === undefined) return null;
  const wait = task.wait_ms ?? 0;
  const total = Math.max(wait + task.duration_ms, 1);
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-kumo-recessed">
        {wait > 0 && <span className="bg-kumo-warning" style={{ width: `${(wait / total) * 100}%` }} />}
        <span className="bg-kumo-info" style={{ width: `${(task.duration_ms / total) * 100}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-kumo-subtle">
        {task.wait_ms !== undefined && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-kumo-warning" />
            Waiting <strong className="text-kumo-default tabular">{formatMs(task.wait_ms)}</strong>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-kumo-info" />
          Processing <strong className="text-kumo-default tabular">{formatMs(task.duration_ms)}</strong>
        </span>
      </div>
    </div>
  );
}

/** Tasks of a batch created by asynq.NewBatchTask. */
function BatchItemsCard({ task }: { task: TaskInfo }) {
  const items = task.batch_items ?? [];
  if (items.length === 0) return null;
  return (
    <Card
      title={`Batch of ${formatNumber(items.length)} tasks`}
      description="The tasks aggregated from the group into this task. Retried items go back to the group, failed items are archived."
      bodyClassName="p-0"
    >
      <div className="max-h-[420px] overflow-auto">
        <Table>
          <Table.Header variant="compact">
            <Table.Row>
              <Table.Head>ID</Table.Head>
              <Table.Head>Type</Table.Head>
              <Table.Head>Retries</Table.Head>
              <Table.Head className="w-full">Payload</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((it, i) => (
              <Table.Row key={it.id || i}>
                <Table.Cell className="font-mono text-xs" title={it.id}>
                  {it.id ? shortId(it.id) : "—"}
                </Table.Cell>
                <Table.Cell className="font-mono text-xs whitespace-nowrap">{it.type}</Table.Cell>
                <Table.Cell className="tabular">
                  {it.retried}/{it.max_retry}
                  {it.error_message && (
                    <span className="block max-w-[200px] truncate text-xs text-kumo-danger" title={it.error_message}>
                      {it.error_message}
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <span className="block max-w-[560px] truncate font-mono text-xs text-kumo-subtle">
                    {payloadPreview(it.payload, 200)}
                  </span>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Card>
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
            {task.duration_ms !== undefined && (
              <KeyValue label={task.state === "completed" ? "Time" : "Last attempt"}>
                <TimingBar task={task} />
              </KeyValue>
            )}
            {task.flow_run_id && (
              <KeyValue label="Flow run">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={flowRunPath(task.flow_run_id)} className="flex items-center gap-1.5">
                    <GitForkIcon />
                    {task.flow ? `${task.flow} run` : "Run"} {shortId(task.flow_run_id)}
                  </Link>
                  {task.parent_id && (
                    <span className="text-xs text-kumo-subtle">
                      enqueued by{" "}
                      <Link href={taskPath(task.queue, task.parent_id)} className="font-mono">
                        {shortId(task.parent_id)}
                      </Link>
                    </span>
                  )}
                </span>
              </KeyValue>
            )}
            {task.rate_limit_key && (
              <KeyValue label="Rate limit">
                <Link href={paths.rateLimits} className="font-mono text-xs">
                  {task.rate_limit_key}
                </Link>
              </KeyValue>
            )}
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
      <BatchItemsCard task={task} />
      {!task.batch_items?.length && (
        <Card title="Payload">
          <JsonView value={task.payload} filename={`${task.type}-${task.id}-payload`} />
        </Card>
      )}
      {task.state === "completed" && (
        <Card title="Result">
          <JsonView value={task.result} filename={`${task.type}-${task.id}-result`} />
        </Card>
      )}
    </div>
  );
}
