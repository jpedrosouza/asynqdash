import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Breadcrumbs, Button, DropdownMenu, Empty, LayerCard, Select, Table, Tabs, cn } from "@cloudflare/kumo";
import {
  ChartBarHorizontalIcon,
  DotsThreeVerticalIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { READ_ONLY } from "../lib/flags";
import { useGroups, useQueue, useQueueActions, useTaskTypes } from "../lib/queries";
import { TASK_STATES, TASK_STATE_META, isTaskState } from "../lib/task-states";
import { formatBytes, formatCompact, formatNumber, formatPercent, ratio } from "../lib/format";
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
  const errorRate = ratio(queue.failed, queue.processed);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
      <Stat label="Processed today" value={<LiveNumber value={queue.processed} format={formatCompact} />} />
      <Stat
        label="Failed today"
        value={<LiveNumber value={queue.failed} format={formatCompact} />}
        tone={queue.failed > 0 ? "danger" : "default"}
      />
      <Stat
        label="Error rate"
        value={formatPercent(errorRate)}
        tone={errorRate > 0.05 ? "danger" : errorRate > 0 ? "warning" : "success"}
      />
    </div>
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
  return (
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
          </span>
        }
        description={
          queue.paused ? "This queue is paused: workers do not pick up its tasks until it is resumed." : undefined
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
