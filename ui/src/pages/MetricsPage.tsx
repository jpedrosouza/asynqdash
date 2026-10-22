import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button, ChartPalette, DropdownMenu, Empty, Tabs, TimeseriesChart, Tooltip } from "@cloudflare/kumo";
import type { TimeseriesData } from "@cloudflare/kumo/components/chart";
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, ChartLineIcon, FunnelSimpleIcon } from "@phosphor-icons/react";
import { getMetrics } from "../lib/api";
import { PROMETHEUS_ADDRESS } from "../lib/flags";
import { keys, useQueues } from "../lib/queries";
import { useRefetchInterval, useSettings } from "../lib/settings";
import { echarts } from "../lib/echarts";
import { formatBytes, formatCompact, formatDateTime, formatPercent, formatTimeShort } from "../lib/format";
import type { PrometheusResponse } from "../lib/types";
import { Card, ErrorState, LoadingState, Page, PageHeader } from "../components/common";

const DURATIONS = [
  { value: "3600", label: "1h" },
  { value: "21600", label: "6h" },
  { value: "86400", label: "1d" },
  { value: "691200", label: "8d" },
  { value: "2592000", label: "30d" },
];

interface ChartDef {
  key: keyof import("../lib/types").MetricsResponse;
  title: string;
  description: string;
  format: (v: number) => string;
}

const CHARTS: ChartDef[] = [
  {
    key: "tasks_processed_per_second",
    title: "Tasks processed",
    description: "Tasks processed per second (succeeded and failed).",
    format: (v) => `${formatCompact(Number(v.toFixed(2)))}/s`,
  },
  {
    key: "tasks_failed_per_second",
    title: "Tasks failed",
    description: "Tasks failed per second.",
    format: (v) => `${formatCompact(Number(v.toFixed(2)))}/s`,
  },
  {
    key: "error_rate",
    title: "Error rate",
    description: "Share of processed tasks that failed.",
    format: (v) => formatPercent(v),
  },
  {
    key: "queue_size",
    title: "Queue size",
    description: "Total number of tasks in each queue.",
    format: (v) => formatCompact(v),
  },
  {
    key: "queue_latency_seconds",
    title: "Queue latency",
    description: "Age of the oldest pending task in each queue.",
    format: (v) => `${formatCompact(Number(v.toFixed(1)))}s`,
  },
  {
    key: "queue_memory_usage_approx_bytes",
    title: "Memory usage",
    description: "Approximate memory used by each queue.",
    format: (v) => formatBytes(v),
  },
  {
    key: "pending_tasks_by_queue",
    title: "Pending tasks",
    description: "Pending tasks in each queue.",
    format: (v) => formatCompact(v),
  },
  {
    key: "retry_tasks_by_queue",
    title: "Retry tasks",
    description: "Tasks waiting to be retried in each queue.",
    format: (v) => formatCompact(v),
  },
  {
    key: "archived_tasks_by_queue",
    title: "Archived tasks",
    description: "Archived tasks in each queue.",
    format: (v) => formatCompact(v),
  },
];

function toSeries(resp: PrometheusResponse | undefined, isDarkMode: boolean): TimeseriesData[] {
  const result = resp?.data?.result ?? [];
  return result.map((m, i) => ({
    name: m.metric.queue ?? m.metric.__name__ ?? `series ${i + 1}`,
    color: ChartPalette.categorical(i, isDarkMode),
    data: m.values.map(([t, v]) => [t * 1000, Number(v)] as [number, number]),
  }));
}

export function MetricsPage() {
  const [params, setParams] = useSearchParams();
  const { isDarkMode, settings } = useSettings();
  const refetchInterval = useRefetchInterval();
  const { data: queues = [] } = useQueues();

  const duration = Number(params.get("duration") ?? 3600);
  const fixedEnd = params.get("end") ? Number(params.get("end")) : null;
  const selected = params.get("queues")?.split(",").filter(Boolean) ?? [];

  const setParam = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  const metrics = useQuery({
    queryKey: keys.metrics(fixedEnd ?? 0, duration, selected),
    queryFn: () => getMetrics(fixedEnd ?? Math.floor(Date.now() / 1000), duration, selected),
    // Only follow "now" when no fixed end time is set.
    refetchInterval: fixedEnd ? false : refetchInterval,
    placeholderData: keepPreviousData,
    enabled: !!PROMETHEUS_ADDRESS,
  });

  const charts = useMemo(
    () =>
      CHARTS.map((c) => ({
        ...c,
        response: metrics.data?.[c.key],
        series: toSeries(metrics.data?.[c.key], isDarkMode),
      })),
    [metrics.data, isDarkMode],
  );

  const end = fixedEnd ?? Math.floor(Date.now() / 1000);
  const shift = (dir: -1 | 1) => {
    const next = end + dir * duration;
    setParam({ end: next >= Date.now() / 1000 ? null : String(next) });
  };
  const toggleQueue = (q: string) => {
    const base = selected.length === 0 ? [] : selected;
    const next = base.includes(q) ? base.filter((x) => x !== q) : [...base, q];
    setParam({ queues: next.length === 0 || next.length === queues.length ? null : next.join(",") });
  };

  if (!PROMETHEUS_ADDRESS) {
    return (
      <Page>
        <PageHeader title="Metrics" />
        <Empty
          icon={<ChartLineIcon size={32} />}
          title="Prometheus is not configured"
          description="Start asynqmon with --prometheus-addr (or set Options.PrometheusAddress) to see time series metrics."
        />
      </Page>
    );
  }

  const tickFormat = (ms: number) =>
    duration > 86400 * 2
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: settings.timeZone === "utc" ? "UTC" : undefined,
        }).format(ms)
      : formatTimeShort(ms, settings.timeZone);

  return (
    <Page>
      <PageHeader
        title="Metrics"
        description={
          fixedEnd
            ? `Showing ${DURATIONS.find((d) => Number(d.value) === duration)?.label ?? ""} ending ${formatDateTime(new Date(fixedEnd * 1000), settings.timeZone)}`
            : "Live time series from Prometheus."
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={
                  <Button size="sm" icon={FunnelSimpleIcon}>
                    {selected.length === 0 ? "All queues" : `${selected.length} queues`}
                    <CaretDownIcon />
                  </Button>
                }
              />
              <DropdownMenu.Content align="end">
                <DropdownMenu.Group>
                  <DropdownMenu.Label>Queues</DropdownMenu.Label>
                  {queues.map((q) => (
                    <DropdownMenu.CheckboxItem
                      key={q.queue}
                      checked={selected.length === 0 || selected.includes(q.queue)}
                      onCheckedChange={() => toggleQueue(q.queue)}
                    >
                      {q.queue}
                    </DropdownMenu.CheckboxItem>
                  ))}
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu>
            <Tabs
              size="sm"
              tabs={DURATIONS}
              value={String(duration)}
              onValueChange={(v) => setParam({ duration: v })}
            />
            <div className="flex items-center gap-1">
              <Tooltip
                content="Earlier"
                render={
                  <Button
                    size="sm"
                    shape="square"
                    icon={CaretLeftIcon}
                    aria-label="Show earlier period"
                    onClick={() => shift(-1)}
                  />
                }
              />
              <Tooltip
                content="Later"
                render={
                  <Button
                    size="sm"
                    shape="square"
                    icon={CaretRightIcon}
                    aria-label="Show later period"
                    disabled={!fixedEnd}
                    onClick={() => shift(1)}
                  />
                }
              />
              <Button size="sm" variant={fixedEnd ? "secondary" : "primary"} onClick={() => setParam({ end: null })}>
                Now
              </Button>
            </div>
          </>
        }
      />
      {metrics.isLoading ? (
        <LoadingState />
      ) : metrics.error && !metrics.data ? (
        <ErrorState title="Could not load metrics" error={metrics.error} onRetry={() => metrics.refetch()} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {charts.map((c) => (
            <Card key={c.key} title={c.title} description={c.description}>
              {c.response?.status === "error" ? (
                <ErrorState title="Query failed" error={new Error(c.response.error ?? "Unknown Prometheus error")} />
              ) : c.series.length === 0 ? (
                <p className="flex h-[240px] items-center justify-center text-sm text-kumo-subtle">
                  No data for this period.
                </p>
              ) : (
                <TimeseriesChart
                  echarts={echarts}
                  isDarkMode={isDarkMode}
                  data={c.series}
                  height={240}
                  gradient
                  loading={metrics.isPlaceholderData}
                  xAxisTickFormat={tickFormat}
                  yAxisTickFormat={c.format}
                  tooltipValueFormat={c.format}
                  tooltipTimestampFormat={(ms) => formatDateTime(new Date(ms), settings.timeZone)}
                  ariaDescription={c.description}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
