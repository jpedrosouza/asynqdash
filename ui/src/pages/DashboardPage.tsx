import { Fragment, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  DropdownMenu,
  Empty,
  InputGroup,
  LayerCard,
  Link,
  Select,
  Switch,
  Table,
  Tabs,
  Tooltip,
  cn,
} from "@cloudflare/kumo";
import {
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  FolderSimpleIcon,
  GaugeIcon,
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
import { useProcessedToday, useQueueActions, useQueues, useQueueStats, useThroughput } from "../lib/queries";
import { dailyProcessed, isUtcDays, sumQueues, type QueueToday } from "../lib/throughput";
import { useSettings, type DailyStatsRange } from "../lib/settings";
import {
  formatBytes,
  formatCompact,
  formatMs,
  formatNumber,
  formatPercent,
  formatRateLimit,
  pluralize,
  ratio,
} from "../lib/format";
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

interface Today {
  queues: QueueToday[];
  source: "collector" | "utc";
}

function SummaryStats({ queues, today }: { queues: Queue[]; today: Today }) {
  const { settings } = useSettings();
  const sum = (f: (q: Queue) => number) => queues.reduce((acc, q) => acc + f(q), 0);
  const processed = today.queues.reduce((acc, q) => acc + q.processed, 0);
  const failed = today.queues.reduce((acc, q) => acc + q.failed, 0);
  // asynq counts "today" in UTC; say so when the selected time zone has another day.
  const utcNote = today.source === "utc" && !isUtcDays(settings.timeZone) ? " · UTC day" : "";
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
        hint={`${formatCompact(failed)} failed${utcNote}`}
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

function ProcessedCard({ today }: { today: Today }) {
  const { settings, update } = useSettings();
  const tz = settings.timeZone;
  const range = settings.dailyStatsRange;
  const days = range === "today" ? 0 : RANGE_DAYS[range];
  const stats = useQueueStats();
  // Local days are rebuilt from the hourly throughput recorded by asynqdash.
  const local = !isUtcDays(tz);
  const hourly = useThroughput("hour", days * 86_400, [], local && days > 0);
  const waitingForHourly = local && days > 0 && hourly.isLoading;
  const daily = useMemo(
    () =>
      stats.data && days > 0
        ? dailyProcessed(stats.data, local && hourly.data ? sumQueues(hourly.data) : undefined, days, tz)
        : null,
    [stats.data, hourly.data, local, days, tz],
  );
  const info = local
    ? "Succeeded and failed tasks per day, in your time zone. asynq records days in UTC: days before Asynqdash recorded throughput are shown as UTC days."
    : "Succeeded and failed tasks per day (UTC), as recorded by asynq.";
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          Tasks processed
          <Tooltip content={info}>
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
        <ProcessedTodayChart queues={today.queues} />
      ) : stats.error ? (
        <ErrorState title="Could not load history" error={stats.error} onRetry={() => stats.refetch()} />
      ) : !daily || waitingForHourly ? (
        <LoadingState className="h-[280px]" />
      ) : (
        <DailyStatsChart daily={daily} />
      )}
    </Card>
  );
}

const UNCATEGORIZED = "__none__";
const ALL_CATEGORIES = "__all__";

/** Totals of a set of queues, shown on the row of a category. */
function sumQueueStats(queues: Queue[]) {
  const sum = (f: (q: Queue) => number) => queues.reduce((acc, q) => acc + f(q), 0);
  return {
    size: sum((q) => q.size),
    active: sum((q) => q.active),
    pending: sum((q) => q.pending),
    retry: sum((q) => q.retry),
    archived: sum((q) => q.archived),
    latency: Math.max(0, ...queues.map((q) => q.latency_msec)),
    memory: sum((q) => q.memory_usage_bytes),
    processed: sum((q) => q.processed),
    failed: sum((q) => q.failed),
  };
}

interface CategoryGroup {
  key: string;
  /** Empty for the uncategorized queues. */
  category: string;
  subgroups: { key: string; subcategory: string; queues: Queue[] }[];
  queues: Queue[];
}

/** Groups the (sorted) queues by category, then subcategory. Uncategorized queues come last. */
function groupByCategory(rows: Queue[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const q of rows) {
    const category = q.category ?? "";
    const key = category || UNCATEGORIZED;
    let g = groups.get(key);
    if (!g) {
      g = { key, category, subgroups: [], queues: [] };
      groups.set(key, g);
    }
    g.queues.push(q);
    const sub = q.subcategory ?? "";
    let sg = g.subgroups.find((x) => x.subcategory === sub);
    if (!sg) {
      sg = { key: `${key}/${sub}`, subcategory: sub, queues: [] };
      g.subgroups.push(sg);
    }
    sg.queues.push(q);
  }
  for (const g of groups.values()) {
    // Queues without subcategory first, then the subcategories by name.
    g.subgroups.sort((a, b) =>
      a.subcategory === "" ? -1 : b.subcategory === "" ? 1 : a.subcategory.localeCompare(b.subcategory),
    );
  }
  return [...groups.values()].sort((a, b) =>
    a.key === UNCATEGORIZED ? 1 : b.key === UNCATEGORIZED ? -1 : a.category.localeCompare(b.category),
  );
}

function rateLimitShort(q: Queue): string {
  const rl = q.rate_limit!;
  const unit =
    rl.period_ms >= 86_400_000 ? "d" : rl.period_ms >= 3_600_000 ? "h" : rl.period_ms >= 60_000 ? "min" : "s";
  return `${formatCompact(rl.limit)}/${unit}`;
}

function QueuesTable({ queues }: { queues: Queue[] }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "queue", desc: false });
  const [toDelete, setToDelete] = useState<Queue | null>(null);
  const { pause, resume, remove } = useQueueActions();

  const categoryFilter = params.get("category") ?? "";
  const categories = useMemo(
    () => [...new Set(queues.map((q) => q.category).filter((c): c is string => !!c))].sort(),
    [queues],
  );
  const hasCategories = categories.length > 0;
  const setCategoryFilter = (c: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (c) next.set("category", c);
        else next.delete("category");
        return next;
      },
      { replace: true },
    );
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== "queue" && key !== "state" },
    );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let filtered = term
      ? queues.filter(
          (q) =>
            q.queue.toLowerCase().includes(term) ||
            (q.category ?? "").toLowerCase().includes(term) ||
            (q.subcategory ?? "").toLowerCase().includes(term),
        )
      : queues;
    if (categoryFilter) {
      filtered = filtered.filter((q) =>
        categoryFilter === UNCATEGORIZED ? !q.category : q.category === categoryFilter,
      );
    }
    const value = SORT_VALUE[sort.key];
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : a.queue.localeCompare(b.queue);
      return sort.desc ? -cmp : cmp;
    });
  }, [queues, search, sort, categoryFilter]);
  const groups = useMemo(() => groupByCategory(rows), [rows]);
  const showGroups = grouped && hasCategories;

  const head = (label: string, key: SortKey, align: "left" | "right" = "right", className?: string) => (
    <SortHead label={label} sortKey={key} sort={sort} onSort={onSort} align={align} className={className} />
  );

  /** Row summing a set of queues: a category, or a subcategory within it. Clicking it folds the queues. */
  const groupRow = (key: string, label: string, items: Queue[], depth: 0 | 1) => {
    const t = sumQueueStats(items);
    const isCollapsed = collapsed.has(key);
    const Caret = isCollapsed ? CaretRightIcon : CaretDownIcon;
    return (
      <Table.Row
        key={`group-${key}`}
        className={cn("cursor-pointer", depth === 0 ? "bg-kumo-recessed" : "bg-kumo-tint")}
        onClick={() => toggleCollapsed(key)}
        aria-expanded={!isCollapsed}
      >
        <Table.Cell colSpan={3}>
          <span className={cn("flex items-center gap-2 font-medium text-kumo-default", depth === 1 && "pl-5")}>
            <Caret size={12} className="text-kumo-subtle" />
            {depth === 0 && <FolderSimpleIcon className="text-kumo-subtle" />}
            {label}
            <span className="text-xs font-normal text-kumo-subtle">{pluralize(items.length, "queue")}</span>
          </span>
        </Table.Cell>
        <Table.Cell className="tabular text-right font-medium">{formatNumber(t.size)}</Table.Cell>
        <Table.Cell className="tabular text-right">{formatNumber(t.active)}</Table.Cell>
        <Table.Cell className="tabular text-right">{formatNumber(t.pending)}</Table.Cell>
        <Table.Cell className={cn("tabular text-right", t.retry > 0 && "text-kumo-warning")}>
          {formatNumber(t.retry)}
        </Table.Cell>
        <Table.Cell className={cn("tabular text-right", t.archived > 0 && "text-kumo-danger")}>
          {formatNumber(t.archived)}
        </Table.Cell>
        <Table.Cell className="tabular text-right text-xs whitespace-nowrap text-kumo-subtle">
          {t.latency > 0 ? `max ${formatMs(t.latency)}` : "—"}
        </Table.Cell>
        <Table.Cell className="tabular text-right whitespace-nowrap">{formatBytes(t.memory)}</Table.Cell>
        <Table.Cell className="tabular text-right">{formatNumber(t.processed)}</Table.Cell>
        <Table.Cell className={cn("tabular text-right", t.failed > 0 && "text-kumo-danger")}>
          {formatNumber(t.failed)}
        </Table.Cell>
        <Table.Cell className="tabular text-right">{formatPercent(ratio(t.failed, t.processed))}</Table.Cell>
        {!READ_ONLY && <Table.Cell sticky="right" />}
      </Table.Row>
    );
  };

  const queueRow = (q: Queue, depth: 0 | 1 | 2) => {
    const errorRate = ratio(q.failed, q.processed);
    return (
      <Table.Row key={q.queue} className="cursor-pointer" onClick={() => navigate(queuePath(q.queue))}>
        <Table.Cell className="font-medium">
          <span className={cn("flex items-center gap-2", depth === 1 && "pl-5", depth === 2 && "pl-10")}>
            <Link
              href={queuePath(q.queue)}
              variant="plain"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              title={q.description}
            >
              {q.queue}
            </Link>
            {q.rate_limit && (
              <Tooltip content={`Rate limit: ${formatRateLimit(q.rate_limit)}`}>
                <Badge variant="secondary" icon={<GaugeIcon />}>
                  {rateLimitShort(q)}
                </Badge>
              </Tooltip>
            )}
          </span>
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
        <Table.Cell className="tabular text-right whitespace-nowrap">{formatBytes(q.memory_usage_bytes)}</Table.Cell>
        <Table.Cell className="tabular text-right">{formatNumber(q.processed)}</Table.Cell>
        <Table.Cell className={cn("tabular text-right", q.failed > 0 && "text-kumo-danger")}>
          {formatNumber(q.failed)}
        </Table.Cell>
        <Table.Cell className="tabular text-right">{formatPercent(errorRate)}</Table.Cell>
        {!READ_ONLY && (
          <Table.Cell sticky="right" className="text-right" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
  };

  return (
    <LayerCard className="min-w-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-hairline px-3 py-2">
        <span className="px-1 font-medium text-kumo-default">All queues</span>
        <div className="flex flex-wrap items-center gap-3">
          {hasCategories && (
            <>
              <Switch size="sm" label="Group by category" checked={grouped} onCheckedChange={setGrouped} />
              <Select
                aria-label="Category"
                size="sm"
                value={categoryFilter || ALL_CATEGORIES}
                onValueChange={(v) => setCategoryFilter(v === ALL_CATEGORIES ? "" : String(v ?? ""))}
                className="min-w-44"
                renderValue={(v: unknown) =>
                  v === ALL_CATEGORIES ? "All categories" : v === UNCATEGORIZED ? "Uncategorized" : String(v)
                }
              >
                <Select.Option value={ALL_CATEGORIES}>All categories</Select.Option>
                {categories.map((c) => (
                  <Select.Option key={c} value={c}>
                    {c}
                  </Select.Option>
                ))}
                <Select.Option value={UNCATEGORIZED}>Uncategorized</Select.Option>
              </Select>
            </>
          )}
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
            {showGroups
              ? groups.map((g) => (
                  <Fragment key={g.key}>
                    {groupRow(g.key, g.category || "Uncategorized", g.queues, 0)}
                    {!collapsed.has(g.key) &&
                      g.subgroups.map((sg) =>
                        sg.subcategory ? (
                          <Fragment key={sg.key}>
                            {groupRow(sg.key, sg.subcategory, sg.queues, 1)}
                            {!collapsed.has(sg.key) && sg.queues.map((q) => queueRow(q, 2))}
                          </Fragment>
                        ) : (
                          <Fragment key={sg.key}>{sg.queues.map((q) => queueRow(q, 1))}</Fragment>
                        ),
                      )}
                  </Fragment>
                ))
              : rows.map((q) => queueRow(q, 0))}
          </Table.Body>
        </Table>
        {rows.length === 0 && (
          <p className="py-10 text-center text-sm text-kumo-subtle">
            {search ? `No queue matches “${search}”.` : "No queue in this category."}
          </p>
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

const NO_QUEUES: Queue[] = [];

export function DashboardPage() {
  const { data: queues, error, isLoading, refetch } = useQueues();
  const today = useProcessedToday(queues ?? NO_QUEUES);

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
          <SummaryStats queues={queues} today={today} />
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
            <ProcessedCard today={today} />
          </div>
          <QueuesTable queues={queues} />
        </>
      )}
    </Page>
  );
}
