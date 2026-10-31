import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  Badge,
  Breadcrumbs,
  Button,
  DropdownMenu,
  Empty,
  LayerCard,
  Meter,
  Select,
  Table,
  Tabs,
  Tooltip,
  cn,
} from "@cloudflare/kumo";
import {
  ChartBarHorizontalIcon,
  ChartLineIcon,
  DotsThreeVerticalIcon,
  GaugeIcon,
  InfoIcon,
  LightningIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { READ_ONLY } from "../lib/flags";
import {
  useFlushGroup,
  useGroups,
  useProcessedToday,
  useQueue,
  useQueueActions,
  useQueueSettings,
  useQueues,
  useTaskTypes,
  useThroughput,
} from "../lib/queries";
import { useNow } from "../lib/hooks";
import { QueueDetailsDialog, RateLimitDialog } from "../components/QueueDialogs";
import { TaskDurationCard } from "../components/TaskDurationCard";
import { formatDuration, formatRateLimit, formatRelative, parseTime } from "../lib/format";
import type { GroupInfo } from "../lib/types";
import { useSettings, type ThroughputRange } from "../lib/settings";
import { isUtcDays, lastDays, sumByDay, sumQueues } from "../lib/throughput";
import { ThroughputChart } from "../components/lazy-charts";
import { TASK_STATES, TASK_STATE_META, isTaskState } from "../lib/task-states";
import { formatBytes, formatCompact, formatDateTime, formatNumber, formatPercent, ratio } from "../lib/format";
import { paths } from "../lib/paths";
import type { Queue, TaskState } from "../lib/types";
import { Card, ErrorState, LiveNumber, LoadingState, Page, PageHeader, Stat } from "../components/common";
import { QueueStatusBadge, StateDistributionBar } from "../components/badges";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TaskTable } from "../components/tasks/TaskTable";

/** State shown when the URL does not specify one: the first state that has tasks. */
function defaultState(queue: Queue | undefined): TaskState {
  const order: TaskState[] = ["active", "pending", "retry", "scheduled", "archived", "aggregating", "completed"];
  return order.find((s) => queue && queue[s] > 0) ?? "active";
}

function QueueStats({ queue }: { queue: Queue }) {
  const { settings } = useSettings();
  const queues = useMemo(() => [queue], [queue]);
  const today = useProcessedToday(queues);
  const { processed, failed } = today.queues[0];
  // asynq counts "today" in UTC; say so when the selected time zone has another day.
  const utcNote = today.source === "utc" && !isUtcDays(settings.timeZone) ? "UTC day" : undefined;
  const errorRate = ratio(failed, processed);
  const now = useNow(1000);
  const rl = queue.rate_limit;
  const nextAt = parseTime(rl?.next_at);
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", rl ? "lg:grid-cols-7" : "lg:grid-cols-6")}>
      <Stat
        label="Size"
        value={<LiveNumber value={queue.size} format={formatNumber} />}
        hint={`${formatNumber(queue.groups)} groups`}
      />
      <Stat
        label="Latency"
        value={queue.display_latency || "—"}
        hint="Oldest pending task"
        tone={queue.latency_msec > 60_000 ? "warning" : "default"}
      />
      <Stat label="Memory" value={formatBytes(queue.memory_usage_bytes)} hint="Approximate" />
      <Stat label="Processed today" value={<LiveNumber value={processed} format={formatCompact} />} hint={utcNote} />
      <Stat
        label="Failed today"
        value={<LiveNumber value={failed} format={formatCompact} />}
        hint={utcNote}
        tone={failed > 0 ? "danger" : "default"}
      />
      <Stat
        label="Error rate"
        value={formatPercent(errorRate)}
        tone={errorRate > 0.05 ? "danger" : errorRate > 0 ? "warning" : "success"}
      />
      {rl && (
        <Stat
          label="Rate limit"
          value={`${formatNumber(rl.available)} / ${formatNumber(rl.burst)}`}
          tone={rl.available === 0 && queue.pending > 0 ? "warning" : "default"}
          hint={
            rl.available > 0 || !nextAt
              ? formatRateLimit(rl)
              : `Next task ${formatRelative(nextAt, now)} · ${formatRateLimit(rl)}`
          }
        />
      )}
    </div>
  );
}

/** How far a group is from being aggregated, according to the policy last used by a server. */
function GroupProgress({ qname, group }: { qname: string; group: GroupInfo }) {
  const now = useNow(5000);
  const flush = useFlushGroup(qname);
  const p = group.policy;
  const oldest = parseTime(group.oldest_task_at);
  const newest = parseTime(group.newest_task_at);
  const items: React.ReactNode[] = [];
  if (p?.max_size) {
    items.push(
      <div key="size" className="flex min-w-48 flex-col gap-1">
        <Meter
          label={`${formatNumber(group.size)} of ${formatNumber(p.max_size)} tasks`}
          value={Math.min(group.size, p.max_size)}
          max={p.max_size}
          showValue={false}
        />
        <span className="text-xs text-kumo-subtle">
          Aggregated when it reaches {formatNumber(p.max_size)} tasks
          {p.min_size > 1 && ` (needs ${formatNumber(p.min_size)} before the grace period applies)`}
        </span>
      </div>,
    );
  }
  if (p?.max_delay_sec && oldest) {
    const due = oldest.getTime() + p.max_delay_sec * 1000;
    items.push(
      <div key="delay" className="flex flex-col text-sm">
        <span className="text-xs text-kumo-subtle">Max delay ({formatDuration(p.max_delay_sec)})</span>
        <span className="tabular">{due <= now ? "due now" : `aggregated ${formatRelative(new Date(due), now)}`}</span>
      </div>,
    );
  }
  if (p?.grace_period_sec && newest) {
    const due = newest.getTime() + p.grace_period_sec * 1000;
    const enough = group.size >= Math.max(p.min_size, 1);
    items.push(
      <div key="grace" className="flex flex-col text-sm">
        <span className="text-xs text-kumo-subtle">Grace period ({formatDuration(p.grace_period_sec)})</span>
        <span className="tabular">
          {!enough
            ? `waits for ${formatNumber(p.min_size - group.size)} more tasks`
            : due <= now
              ? "due now"
              : `aggregated ${formatRelative(new Date(due), now)} if no task is added`}
        </span>
      </div>,
    );
  }
  if (oldest) {
    items.push(
      <div key="age" className="flex flex-col text-sm">
        <span className="text-xs text-kumo-subtle">Oldest task</span>
        <span className="tabular">waiting for {formatDuration((now - oldest.getTime()) / 1000)}</span>
      </div>,
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-kumo-hairline px-3 py-3">
      {items}
      {!p && (
        <span className="text-xs text-kumo-subtle">
          No aggregation policy published yet (servers with asynq v0.28 or later publish it at their next check).
        </span>
      )}
      {!READ_ONLY && (
        <div className="ml-auto flex items-center gap-2">
          {group.flush_requested && <Badge variant="secondary">Flush requested</Badge>}
          <Tooltip content="Aggregate the group at the next check of a server, whatever its policy.">
            <Button
              size="sm"
              variant="secondary"
              icon={LightningIcon}
              loading={flush.isPending}
              disabled={group.flush_requested}
              onClick={() => flush.mutate(group.group)}
            >
              Flush now
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

const THROUGHPUT_RANGES: {
  value: ThroughputRange;
  label: string;
  resolution: "minute" | "hour";
  bucket: "minute" | "hour" | "day";
  /** Number of days for day buckets. */
  days?: number;
  seconds: number;
}[] = [
  { value: "1h", label: "60 min", resolution: "minute", bucket: "minute", seconds: 3_600 },
  { value: "1d", label: "24 h", resolution: "hour", bucket: "hour", seconds: 86_400 },
  // One more day than shown, so that the first day is complete in any time zone.
  { value: "7d", label: "7 days", resolution: "hour", bucket: "day", days: 7, seconds: 8 * 86_400 },
  { value: "30d", label: "30 days", resolution: "hour", bucket: "day", days: 30, seconds: 31 * 86_400 },
];

function ThroughputCard({ qname }: { qname: string }) {
  const { settings, update } = useSettings();
  const range = THROUGHPUT_RANGES.find((r) => r.value === settings.throughputRange) ?? THROUGHPUT_RANGES[0];
  const queues = useMemo(() => [qname], [qname]);
  const { data, error, isLoading, isPlaceholderData, refetch } = useThroughput(range.resolution, range.seconds, queues);

  // Period shown on the time axis, in ms: the requested period, or whole days for day buckets.
  const { points, start, end } = useMemo(() => {
    const raw = sumQueues(data, queues);
    const now = data ? data.end * 1000 : Date.now();
    if (range.bucket !== "day") {
      return { points: raw, start: now - range.seconds * 1000, end: now };
    }
    const days = lastDays(range.days ?? 1, settings.timeZone, now);
    return {
      points: sumByDay(raw, settings.timeZone).filter((p) => p.time >= days[0]),
      start: days[0],
      end: days[days.length - 1],
    };
  }, [data, queues, range, settings.timeZone]);

  const totals = points.reduce(
    (acc, p) => ({
      enqueued: acc.enqueued + p.enqueued,
      processed: acc.processed + p.processed,
      failed: acc.failed + p.failed,
    }),
    { enqueued: 0, processed: 0, failed: 0 },
  );
  // The collector may have started recording after the beginning of the period.
  const firstRecorded = points.length > 0 && data ? points[0].time : null;
  const partial = firstRecorded !== null && firstRecorded > start + (range.bucket === "minute" ? 120_000 : 7_200_000);

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          Throughput
          <Tooltip content="Tasks that entered this queue and tasks processed, recorded by Asynqdash every 10 seconds. Enqueued tasks are estimated from the changes in the queue: tasks deleted by hand are not counted.">
            <InfoIcon className="text-kumo-subtle" />
          </Tooltip>
        </span>
      }
      description={
        points.length > 0
          ? `${formatNumber(totals.enqueued)} enqueued · ${formatNumber(totals.processed - totals.failed)} succeeded · ${formatNumber(totals.failed)} failed${partial ? ` · since ${formatDateTime(new Date(firstRecorded), settings.timeZone)}` : ""}`
          : `Per ${range.bucket}`
      }
      actions={
        <Tabs
          size="sm"
          value={range.value}
          onValueChange={(v) => update({ throughputRange: v as ThroughputRange })}
          tabs={THROUGHPUT_RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
      }
    >
      {error && !data ? (
        <ErrorState title="Could not load the throughput" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState className="h-[240px]" />
      ) : points.length === 0 ? (
        <Empty
          size="sm"
          icon={<ChartLineIcon size={28} />}
          title="No throughput recorded yet"
          description={
            data?.collector_enabled === false
              ? "This Asynqdash instance does not record throughput (it runs with --disable-throughput-collector)."
              : "Asynqdash records how many tasks are enqueued and processed every 10 seconds while it runs. Data appears within a minute."
          }
        />
      ) : (
        <div className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
          <ThroughputChart points={points} bucket={range.bucket} start={start} end={end} />
        </div>
      )}
    </Card>
  );
}

function GroupPicker({
  qname,
  value,
  onChange,
}: {
  qname: string;
  value: string | undefined;
  onChange: (g: string) => void;
}) {
  const { data, error, isLoading, refetch } = useGroups(qname);
  const groups = useMemo(() => [...(data?.groups ?? [])].sort((a, b) => b.size - a.size), [data]);

  // Select the largest group by default, and recover when the selected group disappears.
  useEffect(() => {
    if (groups.length > 0 && (!value || !groups.some((g) => g.group === value))) onChange(groups[0].group);
  }, [groups, value, onChange]);

  if (error) return <ErrorState title="Could not load groups" error={error} onRetry={() => refetch()} />;
  if (isLoading) return <LoadingState label="Loading groups…" />;
  if (groups.length === 0) {
    return <Empty size="sm" title="No aggregating tasks" description={TASK_STATE_META.aggregating.emptyDescription} />;
  }
  const selected = groups.find((g) => g.group === value);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-kumo-hairline px-3 py-2">
        <Select
          aria-label="Task group"
          value={value ?? ""}
          onValueChange={(v) => onChange(String(v))}
          size="sm"
          className="min-w-56"
          renderValue={(v: unknown) => {
            const g = groups.find((x) => x.group === v);
            return g ? `${g.group} (${formatNumber(g.size)})` : "Select a group";
          }}
        >
          {groups.map((g) => (
            <Select.Option key={g.group} value={g.group}>
              <span className="flex w-full justify-between gap-6">
                <span className="font-mono text-xs">{g.group}</span>
                <span className="tabular text-kumo-subtle">{formatNumber(g.size)}</span>
              </span>
            </Select.Option>
          ))}
        </Select>
        <span className="text-sm text-kumo-subtle">{formatNumber(groups.length)} groups waiting to be aggregated</span>
      </div>
      {selected && <GroupProgress qname={qname} group={selected} />}
    </>
  );
}

function TaskTypesCard({ qname }: { qname: string }) {
  const [enabled, setEnabled] = useState(false);
  const { data, error, isFetching, refetch } = useTaskTypes(qname, enabled);
  const states = TASK_STATES.filter((m) => data?.types.some((t) => (t.states[m.state] ?? 0) > 0));

  return (
    <Card
      title="Task types"
      description="How many tasks of each type are in this queue, by state."
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={ChartBarHorizontalIcon}
          loading={isFetching}
          onClick={() => (enabled ? refetch() : setEnabled(true))}
        >
          {data ? "Refresh" : "Analyze"}
        </Button>
      }
      bodyClassName="p-0"
    >
      {error ? (
        <ErrorState title="Could not analyze task types" error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <p className="px-4 py-6 text-sm text-kumo-subtle">
          Scans the tasks stored in Redis to break them down by type. Large queues are sampled (up to{" "}
          {formatNumber(10000)} tasks per state).
        </p>
      ) : data.types.length === 0 ? (
        <p className="px-4 py-6 text-sm text-kumo-subtle">This queue has no tasks.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>Type</Table.Head>
                <Table.Head className="text-right">Total</Table.Head>
                {states.map((m) => (
                  <Table.Head key={m.state} className="text-right whitespace-nowrap">
                    {m.label}
                  </Table.Head>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.types.map((t) => (
                <Table.Row key={t.type}>
                  <Table.Cell className="font-mono text-xs font-medium">{t.type}</Table.Cell>
                  <Table.Cell className="tabular text-right font-medium">{formatNumber(t.total)}</Table.Cell>
                  {states.map((m) => (
                    <Table.Cell
                      key={m.state}
                      className={cn("tabular text-right", !t.states[m.state] && "text-kumo-inactive")}
                    >
                      {formatNumber(t.states[m.state] ?? 0)}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {data.truncated && (
            <p className="border-t border-kumo-hairline px-4 py-2 text-xs text-kumo-subtle">
              Some states have more than {formatNumber(data.max_per_state)} tasks; counts are a lower bound.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function QueuePage() {
  const { qname = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: queue, error, isLoading, refetch } = useQueue(qname);
  const { pause, resume, remove } = useQueueActions();
  const settingsActions = useQueueSettings(qname);
  const { data: allQueues } = useQueues();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editDetails, setEditDetails] = useState(false);
  const [editRateLimit, setEditRateLimit] = useState(false);

  const statusParam = params.get("status");
  const state: TaskState = isTaskState(statusParam) ? statusParam : defaultState(queue);
  const group = params.get("group") ?? undefined;

  // Pin the default state in the URL once the queue is loaded so it doesn't jump while polling.
  useEffect(() => {
    if (queue && !isTaskState(statusParam)) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("status", defaultState(queue));
          return next;
        },
        { replace: true },
      );
    }
  }, [queue, statusParam, setParams]);

  const setState = (s: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("status", s);
      next.delete("page");
      if (s !== "aggregating") next.delete("group");
      return next;
    });

  const setGroup = useMemo(
    () => (g: string) =>
      setParams(
        (prev) => {
          if (prev.get("group") === g) return prev;
          const next = new URLSearchParams(prev);
          next.set("group", g);
          next.delete("page");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const breadcrumbs = (
    <Breadcrumbs size="sm">
      <Breadcrumbs.Link href={paths.home}>Queues</Breadcrumbs.Link>
      <Breadcrumbs.Separator />
      {queue?.category && (
        <>
          <Breadcrumbs.Link href={`${paths.home}?category=${encodeURIComponent(queue.category)}`}>
            {queue.subcategory ? `${queue.category} / ${queue.subcategory}` : queue.category}
          </Breadcrumbs.Link>
          <Breadcrumbs.Separator />
        </>
      )}
      <Breadcrumbs.Current>{qname}</Breadcrumbs.Current>
    </Breadcrumbs>
  );

  if (isLoading) {
    return (
      <Page>
        <PageHeader eyebrow={breadcrumbs} title={qname} />
        <LoadingState />
      </Page>
    );
  }
  if (error && !queue) {
    return (
      <Page>
        <PageHeader eyebrow={breadcrumbs} title={qname} />
        <ErrorState title="Could not load the queue" error={error} onRetry={() => refetch()} />
      </Page>
    );
  }
  if (!queue) {
    return (
      <Page>
        <PageHeader eyebrow={breadcrumbs} title={qname} />
        <Empty
          icon={<TrayIcon size={32} />}
          title="Queue not found"
          description={`There is no queue named "${qname}". It may have been deleted, or no task was ever enqueued to it.`}
          contents={<Button onClick={() => navigate(paths.home)}>Back to queues</Button>}
        />
      </Page>
    );
  }

  const tabs = TASK_STATES.map((m) => ({
    value: m.state,
    label: (
      <span className="flex items-center gap-1.5">
        {m.label}
        <span
          className={cn(
            "tabular rounded-full px-1.5 text-xs",
            queue[m.state] > 0 ? "bg-kumo-recessed text-kumo-default" : "text-kumo-inactive",
            m.state === "archived" && queue.archived > 0 && "bg-kumo-danger-tint text-kumo-danger",
            m.state === "retry" && queue.retry > 0 && "bg-kumo-warning-tint text-kumo-warning",
          )}
        >
          {formatCompact(queue[m.state])}
        </span>
      </span>
    ),
  }));

  return (
    <Page>
      <PageHeader
        eyebrow={breadcrumbs}
        title={
          <span className="flex items-center gap-3">
            <span className="truncate">{qname}</span>
            <QueueStatusBadge paused={queue.paused} />
            {queue.rate_limit && (
              <Tooltip content="Servers start at most this many tasks of the queue">
                <Badge variant="secondary" icon={<GaugeIcon />}>
                  {formatRateLimit(queue.rate_limit)}
                </Badge>
              </Tooltip>
            )}
          </span>
        }
        description={
          queue.paused
            ? "This queue is paused: workers do not pick up its tasks until it is resumed."
            : queue.description
              ? queue.description
              : undefined
        }
        actions={
          !READ_ONLY && (
            <>
              {queue.paused ? (
                <Button
                  variant="primary"
                  icon={PlayIcon}
                  loading={resume.isPending}
                  onClick={() => resume.mutate(qname)}
                >
                  Resume
                </Button>
              ) : (
                <Button icon={PauseIcon} loading={pause.isPending} onClick={() => pause.mutate(qname)}>
                  Pause
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenu.Trigger
                  render={<Button shape="square" icon={DotsThreeVerticalIcon} aria-label="More queue actions" />}
                />
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item icon={PencilSimpleIcon} onClick={() => setEditDetails(true)}>
                    Edit details and category
                  </DropdownMenu.Item>
                  <DropdownMenu.Item icon={GaugeIcon} onClick={() => setEditRateLimit(true)}>
                    {queue.rate_limit ? "Edit rate limit" : "Set rate limit"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item icon={TrashIcon} variant="danger" onClick={() => setConfirmDelete(true)}>
                    Delete queue
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu>
            </>
          )
        }
      />

      <QueueStats queue={queue} />
      <StateDistributionBar queue={queue} className="h-2" />

      <ThroughputCard qname={qname} />

      <TaskDurationCard qname={qname} />

      <LayerCard className="min-w-0 overflow-hidden p-0">
        <div className="overflow-x-auto border-b border-kumo-hairline px-2 pt-1">
          <Tabs variant="underline" tabs={tabs} value={state} onValueChange={setState} />
        </div>
        <p className="px-4 pt-3 text-xs text-kumo-subtle">{TASK_STATE_META[state].description}</p>
        {state === "aggregating" ? (
          <>
            <GroupPicker qname={qname} value={group} onChange={setGroup} />
            {group && <TaskTable key={`${state}-${group}`} qname={qname} state={state} group={group} totalCount={0} />}
          </>
        ) : (
          <TaskTable key={state} qname={qname} state={state} totalCount={queue[state]} />
        )}
      </LayerCard>

      <TaskTypesCard qname={qname} />

      <QueueDetailsDialog
        open={editDetails}
        onOpenChange={setEditDetails}
        queue={queue}
        queues={allQueues ?? []}
        saving={settingsActions.metadata.isPending}
        onSave={(md) => settingsActions.metadata.mutateAsync(md)}
      />
      <RateLimitDialog
        open={editRateLimit}
        onOpenChange={setEditRateLimit}
        title={`Rate limit of "${qname}"`}
        description="All the servers together start at most this many tasks of the queue. It applies right away to servers running asynq v0.28 or later."
        current={queue.rate_limit}
        saving={settingsActions.setRateLimit.isPending || settingsActions.removeRateLimit.isPending}
        onSave={(rl) => settingsActions.setRateLimit.mutateAsync(rl)}
        onRemove={() => settingsActions.removeRateLimit.mutateAsync()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={queue.size > 0 ? `"${qname}" is not empty` : `Delete queue "${qname}"?`}
        description={
          queue.size > 0
            ? `The queue still has ${formatNumber(queue.size)} tasks. Delete or archive them first, then delete the queue.`
            : "The queue and its statistics will be removed. This cannot be undone."
        }
        confirmLabel="Delete queue"
        destructive
        confirmText={queue.size > 0 ? undefined : qname}
        loading={remove.isPending}
        onConfirm={async () => {
          if (queue.size > 0) return;
          await remove.mutateAsync(qname);
          navigate(paths.home);
        }}
      />
    </Page>
  );
}
