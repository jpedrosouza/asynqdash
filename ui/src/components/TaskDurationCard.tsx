import { useMemo, useState } from "react";
import { Empty, Select, Switch, Table, Tabs, Tooltip, cn } from "@cloudflare/kumo";
import { InfoIcon, TimerIcon } from "@phosphor-icons/react";
import { useTaskMetrics } from "../lib/queries";
import { useNow } from "../lib/hooks";
import { formatMs, formatNumber, formatPercent, ratio } from "../lib/format";
import type { TaskMetricsPoint, TaskMetricsResponse, TaskMetricsStats, ThroughputResolution } from "../lib/types";
import { Card, ErrorState, LoadingState, Stat } from "./common";
import { DurationChart } from "./lazy-charts";
import type { DurationSeries } from "./charts";

const RANGES: { value: string; label: string; resolution: ThroughputResolution; seconds: number }[] = [
  { value: "1h", label: "1 h", resolution: "minute", seconds: 3_600 },
  { value: "6h", label: "6 h", resolution: "minute", seconds: 6 * 3_600 },
  { value: "24h", label: "24 h", resolution: "minute", seconds: 86_400 },
  { value: "7d", label: "7 days", resolution: "hour", seconds: 7 * 86_400 },
  { value: "30d", label: "30 days", resolution: "hour", seconds: 30 * 86_400 },
];

type Metric = "duration" | "wait";

const ALL_TYPES = "__all__";

/** Values of the chosen metric in a set of stats. */
function metricValues(s: TaskMetricsStats, metric: Metric) {
  return metric === "duration"
    ? { avg: s.avg_ms, p50: s.p50_ms, p95: s.p95_ms, p99: s.p99_ms, max: s.max_ms }
    : { avg: s.wait_avg_ms, p50: null, p95: s.wait_p95_ms, p99: null, max: s.wait_max_ms };
}

function series(
  points: TaskMetricsPoint[] | undefined,
  metric: Metric,
  shiftMs: number,
  previous: boolean,
): DurationSeries[] {
  const pts = points ?? [];
  const line = (name: string, colorVar: string, value: (p: TaskMetricsPoint) => number | null): DurationSeries => ({
    name: previous ? `${name} (previous)` : name,
    colorVar,
    dashed: previous,
    data: pts.map((p) => [p.time * 1000 + shiftMs, value(p)]),
  });
  if (metric === "wait") {
    const res = [line("p95", "--color-kumo-warning", (p) => p.wait_p95_ms)];
    if (!previous) res.push(line("Average", "--color-kumo-info", (p) => p.wait_avg_ms));
    return res;
  }
  if (previous) return [line("p95", "--color-kumo-warning", (p) => p.p95_ms)];
  return [
    line("p50", "--color-kumo-info", (p) => p.p50_ms),
    line("p95", "--color-kumo-warning", (p) => p.p95_ms),
    line("p99", "--color-kumo-danger", (p) => p.p99_ms),
  ];
}

/** Change of a value from the previous period, as a colored percentage (a decrease of duration is good). */
function Delta({ current, previous }: { current: number; previous: number | undefined }) {
  if (previous === undefined || previous <= 0 || current <= 0) return null;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return <span className="text-kumo-subtle">no change</span>;
  return (
    <span className={cn(change > 0 ? "text-kumo-danger" : "text-kumo-success")}>
      {change > 0 ? "+" : "−"}
      {formatPercent(Math.abs(change))} vs previous
    </span>
  );
}

/**
 * How long the tasks of a queue take to process and wait in the queue, from the metrics recorded by the asynq
 * servers: percentiles over time, optionally compared with the previous period, and the slowest task types.
 */
export function TaskDurationCard({ qname }: { qname: string }) {
  const [rangeValue, setRangeValue] = useState("1h");
  const [metric, setMetric] = useState<Metric>("duration");
  const [type, setType] = useState(ALL_TYPES);
  const [compare, setCompare] = useState(false);
  const range = RANGES.find((r) => r.value === rangeValue) ?? RANGES[0];
  const bucketMs = range.resolution === "minute" ? 60_000 : 3_600_000;

  // The period ends at the current bucket; it moves every 30 seconds to keep the queries cached in between.
  const now = useNow(30_000);
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs - 1000;
  const start = end - range.seconds * 1000 + 1000;
  const typeFilter = type === ALL_TYPES ? undefined : type;
  const current = useTaskMetrics(qname, range.resolution, start / 1000, end / 1000, typeFilter);
  // Hourly metrics are kept for 90 days and per-minute metrics for 48 hours: the previous period may be partial.
  const previous = useTaskMetrics(
    qname,
    range.resolution,
    (start - range.seconds * 1000) / 1000,
    (end - range.seconds * 1000) / 1000,
    typeFilter,
    compare,
  );
  const data: TaskMetricsResponse | undefined = current.data;
  const prevData = compare ? previous.data : undefined;

  const chartSeries = useMemo(
    () => [
      ...series(data?.points, metric, 0, false),
      ...(prevData ? series(prevData.points, metric, range.seconds * 1000, true) : []),
    ],
    [data, prevData, metric, range.seconds],
  );

  const summary = data?.summary;
  const values = summary ? metricValues(summary, metric) : null;
  const prevValues = prevData ? metricValues(prevData.summary, metric) : null;
  const totalMs = data?.by_type.reduce((s, t) => s + t.total_ms, 0) ?? 0;

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          Processing time
          <Tooltip content="Recorded by the asynq servers when a task ends: how long the handler took, and how long the task waited in the pending state before a worker picked it up. Percentiles are estimated from histograms.">
            <InfoIcon className="text-kumo-subtle" />
          </Tooltip>
        </span>
      }
      description={`Per ${range.resolution}${typeFilter ? ` · ${typeFilter}` : " · all task types"}`}
      actions={
        <Tabs
          size="sm"
          value={range.value}
          onValueChange={(v) => setRangeValue(String(v))}
          tabs={RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            size="sm"
            value={metric}
            onValueChange={(v) => setMetric(v as Metric)}
            tabs={[
              { value: "duration", label: "Duration" },
              { value: "wait", label: "Wait time" },
            ]}
          />
          <Select
            aria-label="Task type"
            size="sm"
            value={type}
            onValueChange={(v) => setType(String(v))}
            className="min-w-48"
            renderValue={(v: unknown) => (v === ALL_TYPES ? "All task types" : String(v))}
          >
            <Select.Option value={ALL_TYPES}>All task types</Select.Option>
            {(data?.types ?? []).map((t) => (
              <Select.Option key={t} value={t}>
                <span className="font-mono text-xs">{t}</span>
              </Select.Option>
            ))}
          </Select>
          <Switch size="sm" label="Compare with previous period" checked={compare} onCheckedChange={setCompare} />
        </div>

        {current.error && !data ? (
          <ErrorState title="Could not load the task metrics" error={current.error} onRetry={() => current.refetch()} />
        ) : current.isLoading ? (
          <LoadingState className="h-[260px]" />
        ) : !summary || (summary.processed === 0 && summary.failed === 0) ? (
          <Empty
            size="sm"
            icon={<TimerIcon size={28} />}
            title="No task processed in this period"
            description="The asynq servers record the processing time of each task when it ends (asynq v0.28 or later, unless the server runs with DisableTaskMetrics)."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label="Processed"
                value={formatNumber(summary.processed)}
                hint={summary.failed > 0 ? `${formatNumber(summary.failed)} failed attempts` : "No failure"}
              />
              <Stat
                label="Average"
                value={formatMs(values!.avg)}
                hint={<Delta current={values!.avg} previous={prevValues?.avg} />}
              />
              <Stat
                label="p50"
                value={formatMs(values!.p50)}
                hint={
                  values!.p50 !== null ? <Delta current={values!.p50} previous={prevValues?.p50 ?? undefined} /> : "—"
                }
              />
              <Stat
                label="p95"
                value={formatMs(values!.p95)}
                tone={metric === "wait" && values!.p95 > 60_000 ? "warning" : "default"}
                hint={<Delta current={values!.p95} previous={prevValues?.p95} />}
              />
              <Stat
                label="p99"
                value={formatMs(values!.p99)}
                hint={
                  values!.p99 !== null ? <Delta current={values!.p99} previous={prevValues?.p99 ?? undefined} /> : "—"
                }
              />
              <Stat
                label="Max"
                value={formatMs(values!.max)}
                hint={<Delta current={values!.max} previous={prevValues?.max} />}
              />
            </div>

            <div className={cn("transition-opacity", current.isPlaceholderData && "opacity-60")}>
              <DurationChart series={chartSeries} start={start} end={end} bucketMs={bucketMs} formatValue={formatMs} />
            </div>

            {!typeFilter && data!.by_type.length > 0 && (
              <div className="-mx-4 -mb-4 overflow-x-auto border-t border-kumo-hairline">
                <Table aria-label="Processing time by task type">
                  <Table.Header variant="compact">
                    <Table.Row>
                      <Table.Head>Task type</Table.Head>
                      <Table.Head className="text-right">Processed</Table.Head>
                      <Table.Head className="text-right">Failed</Table.Head>
                      <Table.Head className="text-right">Average</Table.Head>
                      <Table.Head className="text-right">p95</Table.Head>
                      <Table.Head className="text-right">p99</Table.Head>
                      <Table.Head className="text-right">Max</Table.Head>
                      <Table.Head className="text-right">Wait p95</Table.Head>
                      <Table.Head className="w-48">Share of processing time</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data!.by_type.map((t) => {
                      const share = ratio(t.total_ms, totalMs);
                      return (
                        <Table.Row key={t.type} className="cursor-pointer" onClick={() => setType(t.type)}>
                          <Table.Cell className="font-mono text-xs font-medium">{t.type}</Table.Cell>
                          <Table.Cell className="tabular text-right">{formatNumber(t.processed)}</Table.Cell>
                          <Table.Cell
                            className={cn(
                              "tabular text-right",
                              t.failed > 0 ? "text-kumo-danger" : "text-kumo-inactive",
                            )}
                          >
                            {formatNumber(t.failed)}
                          </Table.Cell>
                          <Table.Cell className="tabular text-right">{formatMs(t.avg_ms)}</Table.Cell>
                          <Table.Cell className="tabular text-right">{formatMs(t.p95_ms)}</Table.Cell>
                          <Table.Cell className="tabular text-right">{formatMs(t.p99_ms)}</Table.Cell>
                          <Table.Cell className="tabular text-right">{formatMs(t.max_ms)}</Table.Cell>
                          <Table.Cell className="tabular text-right text-kumo-subtle">
                            {formatMs(t.wait_p95_ms)}
                          </Table.Cell>
                          <Table.Cell>
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-kumo-recessed">
                                <span className="block h-full bg-kumo-info" style={{ width: `${share * 100}%` }} />
                              </span>
                              <span className="w-10 text-right text-xs text-kumo-subtle tabular">
                                {formatPercent(share)}
                              </span>
                            </span>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
