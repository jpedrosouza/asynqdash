import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, DropdownMenu, Empty, InputGroup, LayerCard, Link, Table, Tabs, Tooltip, cn } from "@cloudflare/kumo";
import {
  CaretDownIcon,
  CaretUpIcon,
  DotsThreeIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  StackIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { READ_ONLY } from "../lib/flags";
import { useQueueActions, useQueues, useQueueStats } from "../lib/queries";
import { useSettings, type DailyStatsRange } from "../lib/settings";
import { formatBytes, formatCompact, formatNumber, formatPercent, ratio } from "../lib/format";
import { queuePath } from "../lib/paths";
import type { Queue } from "../lib/types";
import { Card, ErrorState, LiveNumber, LoadingState, Page, PageHeader, Stat } from "../components/common";
import { QueueStatusBadge, StateDistributionBar } from "../components/badges";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DailyStatsChart, ProcessedTodayChart, QueueSizeChart } from "../components/lazy-charts";

type SortKey =
  | "queue"
  | "state"
  | "size"
  | "active"
  | "pending"
  | "retry"
  | "archived"
  | "latency"
  | "memory"
  | "processed"
  | "failed"
  | "error";

const SORT_VALUE: Record<SortKey, (q: Queue) => number | string> = {
  queue: (q) => q.queue.toLowerCase(),
  state: (q) => (q.paused ? 1 : 0),
  size: (q) => q.size,
  active: (q) => q.active,
  pending: (q) => q.pending,
  retry: (q) => q.retry,
  archived: (q) => q.archived,
  latency: (q) => q.latency_msec,
  memory: (q) => q.memory_usage_bytes,
  processed: (q) => q.processed,
  failed: (q) => q.failed,
  error: (q) => ratio(q.failed, q.processed),
};

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = active && !sort.desc ? CaretUpIcon : CaretDownIcon;
  return (
    <Table.Head
      className={cn("whitespace-nowrap", align === "right" && "text-right", className)}
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-kumo-default",
          align === "right" && "flex-row-reverse",
          active ? "text-kumo-default" : "",
        )}
      >
        {label}
        <Icon size={12} className={cn(!active && "opacity-0")} />
      </button>
    </Table.Head>
  );
}

function SummaryStats({ queues }: { queues: Queue[] }) {
  const sum = (f: (q: Queue) => number) => queues.reduce((acc, q) => acc + f(q), 0);
  const processed = sum((q) => q.processed);
  const failed = sum((q) => q.failed);
  const errorRate = ratio(failed, processed);
  const paused = queues.filter((q) => q.paused).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
      <Stat
        label="Queues"
        value={formatNumber(queues.length)}
        hint={paused > 0 ? `${paused} paused` : "All running"}
        tone={paused > 0 ? "warning" : "default"}
      />
      <Stat
        label="Tasks"
        value={<LiveNumber value={sum((q) => q.size)} format={formatCompact} />}
        hint="In all queues"
      />
      <Stat label="Active" value={<LiveNumber value={sum((q) => q.active)} format={formatCompact} />} />
      <Stat label="Pending" value={<LiveNumber value={sum((q) => q.pending)} format={formatCompact} />} />
      <Stat
        label="Retry"
        value={<LiveNumber value={sum((q) => q.retry)} format={formatCompact} />}
        tone={sum((q) => q.retry) > 0 ? "warning" : "default"}
      />
      <Stat
        label="Archived"
        value={<LiveNumber value={sum((q) => q.archived)} format={formatCompact} />}
        tone={sum((q) => q.archived) > 0 ? "danger" : "default"}
      />
      <Stat
        label="Processed today"
        value={<LiveNumber value={processed} format={formatCompact} />}
        hint={`${formatCompact(failed)} failed`}
      />
      <Stat
        label="Error rate today"
        value={formatPercent(errorRate)}
        tone={errorRate > 0.05 ? "danger" : errorRate > 0 ? "warning" : "success"}
      />
    </div>
  );
}

const RANGE_DAYS: Record<Exclude<DailyStatsRange, "today">, number> = { "7d": 7, "30d": 30, "90d": 90 };

function ProcessedCard({ queues }: { queues: Queue[] }) {
  const { settings, update } = useSettings();
  const range = settings.dailyStatsRange;
  const stats = useQueueStats();
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          Tasks processed
          <Tooltip content="Succeeded and failed tasks per day. Days are in UTC, as recorded by asynq.">
            <InfoIcon className="text-kumo-subtle" />
          </Tooltip>
        </span>
      }
      actions={
        <Tabs
          size="sm"
          value={range}
          onValueChange={(v) => update({ dailyStatsRange: v as DailyStatsRange })}
          tabs={[
            { value: "today", label: "Today" },
            { value: "7d", label: "7d" },
            { value: "30d", label: "30d" },
            { value: "90d", label: "90d" },
          ]}
        />
      }
    >
      {range === "today" ? (
        <ProcessedTodayChart queues={queues} />
      ) : stats.error ? (
        <ErrorState title="Could not load history" error={stats.error} onRetry={() => stats.refetch()} />
      ) : !stats.data ? (
        <LoadingState className="h-[280px]" />
      ) : (
        <DailyStatsChart stats={stats.data} days={RANGE_DAYS[range]} />
      )}
    </Card>
  );
}

function QueuesTable({ queues }: { queues: Queue[] }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "queue", desc: false });
  const [toDelete, setToDelete] = useState<Queue | null>(null);
  const { pause, resume, remove } = useQueueActions();

  const onSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== "queue" && key !== "state" },
    );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? queues.filter((q) => q.queue.toLowerCase().includes(term)) : queues;
    const value = SORT_VALUE[sort.key];
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : a.queue.localeCompare(b.queue);
      return sort.desc ? -cmp : cmp;
    });
  }, [queues, search, sort]);

  const head = (label: string, key: SortKey, align: "left" | "right" = "right", className?: string) => (
    <SortHead label={label} sortKey={key} sort={sort} onSort={onSort} align={align} className={className} />
  );

  return (
    <LayerCard className="min-w-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-hairline px-3 py-2">
        <span className="px-1 font-medium text-kumo-default">All queues</span>
        <InputGroup size="sm" className="w-full max-w-xs">
          <InputGroup.Addon>
            <MagnifyingGlassIcon />
          </InputGroup.Addon>
          <InputGroup.Input
            placeholder="Filter queues"
            aria-label="Filter queues"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
          {search && (
            <InputGroup.Addon align="end">
              <InputGroup.Button
                shape="square"
                size="xs"
                icon={XIcon}
                aria-label="Clear filter"
                onClick={() => setSearch("")}
              />
            </InputGroup.Addon>
          )}
        </InputGroup>
      </div>
      <div className="overflow-x-auto">
        <Table aria-label="Queues">
          <Table.Header variant="compact">
            <Table.Row>
              {head("Queue", "queue", "left")}
              {head("Status", "state", "left")}
              <Table.Head className="min-w-32">Distribution</Table.Head>
              {head("Size", "size")}
              {head("Active", "active")}
              {head("Pending", "pending")}
              {head("Retry", "retry")}
              {head("Archived", "archived")}
              {head("Latency", "latency")}
              {head("Memory", "memory")}
              {head("Processed", "processed")}
              {head("Failed", "failed")}
              {head("Error rate", "error")}
              {!READ_ONLY && (
                <Table.Head sticky="right">
                  <span className="sr-only">Actions</span>
                </Table.Head>
              )}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((q) => {
              const errorRate = ratio(q.failed, q.processed);
              return (
                <Table.Row key={q.queue} className="cursor-pointer" onClick={() => navigate(queuePath(q.queue))}>
                  <Table.Cell className="font-medium">
                    <Link
                      href={queuePath(q.queue)}
                      variant="plain"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      {q.queue}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    <QueueStatusBadge paused={q.paused} />
                  </Table.Cell>
                  <Table.Cell>
                    <StateDistributionBar queue={q} className="w-32" />
                  </Table.Cell>
                  <Table.Cell className="tabular text-right font-medium">{formatNumber(q.size)}</Table.Cell>
                  <Table.Cell className="tabular text-right">{formatNumber(q.active)}</Table.Cell>
                  <Table.Cell className="tabular text-right">{formatNumber(q.pending)}</Table.Cell>
                  <Table.Cell className={cn("tabular text-right", q.retry > 0 && "text-kumo-warning")}>
                    {formatNumber(q.retry)}
                  </Table.Cell>
                  <Table.Cell className={cn("tabular text-right", q.archived > 0 && "text-kumo-danger")}>
                    {formatNumber(q.archived)}
                  </Table.Cell>
                  <Table.Cell className="tabular text-right whitespace-nowrap">{q.display_latency}</Table.Cell>
                  <Table.Cell className="tabular text-right whitespace-nowrap">
                    {formatBytes(q.memory_usage_bytes)}
                  </Table.Cell>
                  <Table.Cell className="tabular text-right">{formatNumber(q.processed)}</Table.Cell>
                  <Table.Cell className={cn("tabular text-right", q.failed > 0 && "text-kumo-danger")}>
                    {formatNumber(q.failed)}
                  </Table.Cell>
                  <Table.Cell className="tabular text-right">{formatPercent(errorRate)}</Table.Cell>
                  {!READ_ONLY && (
                    <Table.Cell
                      sticky="right"
                      className="text-right"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              shape="square"
                              icon={DotsThreeIcon}
                              aria-label={`Actions for ${q.queue}`}
                            />
                          }
                        />
                        <DropdownMenu.Content align="end">
                          {q.paused ? (
                            <DropdownMenu.Item icon={PlayIcon} onClick={() => resume.mutate(q.queue)}>
                              Resume
                            </DropdownMenu.Item>
                          ) : (
                            <DropdownMenu.Item icon={PauseIcon} onClick={() => pause.mutate(q.queue)}>
                              Pause
                            </DropdownMenu.Item>
                          )}
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item icon={TrashIcon} variant="danger" onClick={() => setToDelete(q)}>
                            Delete
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu>
                    </Table.Cell>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
        {rows.length === 0 && (
          <p className="py-10 text-center text-sm text-kumo-subtle">No queue matches “{search}”.</p>
        )}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={
          toDelete && toDelete.size > 0 ? `"${toDelete.queue}" is not empty` : `Delete queue "${toDelete?.queue}"?`
        }
        description={
          toDelete && toDelete.size > 0
            ? `The queue still has ${formatNumber(toDelete.size)} tasks. Delete or archive them first, then delete the queue.`
            : "The queue and its statistics will be removed. This cannot be undone."
        }
        confirmLabel="Delete queue"
        destructive
        confirmText={toDelete && toDelete.size === 0 ? toDelete.queue : undefined}
        loading={remove.isPending}
        onConfirm={async () => {
          if (!toDelete || toDelete.size > 0) return;
          await remove.mutateAsync(toDelete.queue);
        }}
      />
    </LayerCard>
  );
}

export function DashboardPage() {
  const { data: queues, error, isLoading, refetch } = useQueues();

  return (
    <Page>
      <PageHeader title="Queues" description="Live overview of every queue in this Redis instance." />
      {isLoading ? (
        <LoadingState />
      ) : error && !queues ? (
        <ErrorState title="Could not load queues" error={error} onRetry={() => refetch()} />
      ) : !queues || queues.length === 0 ? (
        <Empty
          icon={<StackIcon size={32} />}
          title="No queues yet"
          description="Queues appear here as soon as a task is enqueued with asynq."
          commandLine={'client.Enqueue(asynq.NewTask("email:welcome", payload))'}
        />
      ) : (
        <>
          <SummaryStats queues={queues} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Card
              title={
                <span className="flex items-center gap-1.5">
                  Queue size
                  <Tooltip content="Tasks currently stored in each queue, by state. The 12 largest queues are shown.">
                    <InfoIcon className="text-kumo-subtle" />
                  </Tooltip>
                </span>
              }
            >
              <QueueSizeChart queues={queues} />
            </Card>
            <ProcessedCard queues={queues} />
          </div>
          <QueuesTable queues={queues} />
        </>
      )}
    </Page>
  );
}
