import { useMemo } from "react";
import { Chart, ChartPalette, TimeseriesChart, type KumoChartOption } from "@cloudflare/kumo";
import { echarts, resolveColor } from "../lib/echarts";
import { useSettings } from "../lib/settings";
import { TASK_STATES } from "../lib/task-states";
import { formatCompact, formatNumber, formatTimeShort } from "../lib/format";
import { isUtcDays, type ActivityPoint, type DailyProcessed, type QueueToday } from "../lib/throughput";
import type { Queue } from "../lib/types";

/** Stacked horizontal bars: number of tasks per state, for each queue. */
export function QueueSizeChart({ queues, height = 280 }: { queues: Queue[]; height?: number }) {
  const { isDarkMode } = useSettings();
  const options = useMemo<KumoChartOption>(() => {
    const sorted = [...queues].sort((a, b) => a.size - b.size).slice(-12);
    const textColor = ChartPalette.text("secondary", isDarkMode);
    return {
      grid: { left: 8, right: 16, top: 8, bottom: 32, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatNumber(Number(v)) },
      legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: textColor } },
      xAxis: {
        type: "value",
        axisLabel: { color: textColor, formatter: (v: number) => formatCompact(v) },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      yAxis: {
        type: "category",
        data: sorted.map((q) => q.queue),
        axisLabel: { color: textColor, width: 120, overflow: "truncate" },
        axisTick: { show: false },
      },
      series: TASK_STATES.filter((m) => m.state !== "completed").map((m) => ({
        name: m.label,
        type: "bar",
        stack: "size",
        barMaxWidth: 18,
        itemStyle: { color: resolveColor(m.colorVar) },
        emphasis: { focus: "series" },
        data: sorted.map((q) => q[m.state]),
      })),
    } as KumoChartOption;
  }, [queues, isDarkMode]);

  const rows = Math.min(queues.length, 12);
  return (
    <Chart echarts={echarts} options={options} isDarkMode={isDarkMode} height={Math.max(height, rows * 28 + 60)} />
  );
}

/** Succeeded vs failed tasks processed today, per queue. */
export function ProcessedTodayChart({ queues, height = 280 }: { queues: QueueToday[]; height?: number }) {
  const { isDarkMode } = useSettings();
  const options = useMemo<KumoChartOption>(() => {
    const sorted = [...queues].sort((a, b) => a.processed - b.processed).slice(-12);
    const textColor = ChartPalette.text("secondary", isDarkMode);
    return {
      grid: { left: 8, right: 16, top: 8, bottom: 32, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatNumber(Number(v)) },
      legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: textColor } },
      xAxis: {
        type: "value",
        axisLabel: { color: textColor, formatter: (v: number) => formatCompact(v) },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      yAxis: {
        type: "category",
        data: sorted.map((q) => q.queue),
        axisLabel: { color: textColor, width: 120, overflow: "truncate" },
        axisTick: { show: false },
      },
      series: [
        {
          name: "Succeeded",
          type: "bar",
          stack: "processed",
          barMaxWidth: 18,
          itemStyle: { color: resolveColor("--color-kumo-success") },
          data: sorted.map((q) => q.processed - q.failed),
        },
        {
          name: "Failed",
          type: "bar",
          stack: "processed",
          barMaxWidth: 18,
          itemStyle: { color: resolveColor("--color-kumo-danger") },
          data: sorted.map((q) => q.failed),
        },
      ],
    } as KumoChartOption;
  }, [queues, isDarkMode]);
  const rows = Math.min(queues.length, 12);
  return (
    <Chart echarts={echarts} options={options} isDarkMode={isDarkMode} height={Math.max(height, rows * 28 + 60)} />
  );
}

/** Processed and failed tasks per day, summed across queues (see dailyProcessed). */
export function DailyStatsChart({ daily, height = 280 }: { daily: DailyProcessed; height?: number }) {
  const { isDarkMode, settings } = useSettings();
  const tz = settings.timeZone;
  const points = daily.points;
  const data = useMemo(
    () => [
      {
        name: "Succeeded",
        color: resolveColor("--color-kumo-success"),
        data: points.map((p) => [p.time, p.processed - p.failed] as [number, number]),
      },
      {
        name: "Failed",
        color: resolveColor("--color-kumo-danger"),
        data: points.map((p) => [p.time, p.failed] as [number, number]),
      },
    ],
    // isDarkMode re-resolves the theme colors.
    [points, isDarkMode], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Days recorded by asynq are UTC days; days rebuilt from the collector are in the selected time zone.
  const utcDays = new Set(points.filter((p) => p.source === "utc").map((p) => p.time));
  const dateFormat = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: daily.timeZone === "utc" ? "UTC" : undefined,
    }).format(ms);
  const tooltipDate = (ms: number) => {
    if (tz === "utc") return `${dateFormat(ms)} (UTC)`;
    // Shown when the selected time zone is not UTC but the day comes from asynq's UTC counters.
    return utcDays.has(ms) && !isUtcDays(tz) ? `${dateFormat(ms)} (UTC day)` : dateFormat(ms);
  };

  return (
    <TimeseriesChart
      echarts={echarts}
      isDarkMode={isDarkMode}
      type="bar"
      data={data}
      height={height}
      yAxisMinInterval={1}
      xAxisTickFormat={dateFormat}
      yAxisTickFormat={(v) => formatCompact(v)}
      tooltipValueFormat={(v) => formatNumber(v)}
      tooltipTimestampFormat={tooltipDate}
      ariaDescription={`Tasks processed per day over the last ${points.length} days`}
    />
  );
}

export type ThroughputBucket = "minute" | "hour" | "day";

const BUCKET_MS: Record<ThroughputBucket, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/**
 * Tasks enqueued, succeeded and failed per bucket. The time axis covers the whole period from
 * `start` to `end` (ms), so that buckets the collector did not observe show as gaps.
 */
export function ThroughputChart({
  points,
  bucket,
  start,
  end,
  height = 240,
}: {
  points: ActivityPoint[];
  bucket: ThroughputBucket;
  start: number;
  end: number;
  height?: number;
}) {
  const { isDarkMode, settings } = useSettings();
  const tz = settings.timeZone;
  const options = useMemo<KumoChartOption>(() => {
    const timeZone = tz === "utc" ? "UTC" : undefined;
    const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
    const tick = (ms: number) => (bucket === "day" ? dayFormat.format(ms) : formatTimeShort(ms, tz));
    const bucketLabel = (ms: number) => {
      if (bucket === "day") return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(ms);
      const to = formatTimeShort(ms + BUCKET_MS[bucket], tz);
      return `${dayFormat.format(ms)}, ${formatTimeShort(ms, tz)}–${to}${tz === "utc" ? " UTC" : ""}`;
    };
    const textColor = ChartPalette.text("secondary", isDarkMode);
    // Lines break where a bucket was not observed (null), instead of joining distant points.
    const byTime = new Map(points.map((p) => [p.time, p]));
    const times: number[] = [];
    if (bucket === "day") {
      times.push(...points.map((p) => p.time));
    } else if (points.length > 0) {
      for (let t = points[0].time; t <= points[points.length - 1].time; t += BUCKET_MS[bucket]) times.push(t);
    }
    const series = (name: string, colorVar: string, value: (p: ActivityPoint) => number) => ({
      name,
      type: bucket === "day" ? "bar" : "line",
      barMaxWidth: 14,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2 },
      itemStyle: { color: resolveColor(colorVar) },
      emphasis: { focus: "series" },
      data: times.map((t) => {
        const p = byTime.get(t);
        return [t, p ? value(p) : null];
      }),
    });
    const pad = bucket === "day" ? BUCKET_MS.day / 2 : 0;
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 32, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const items = params as { marker: string; seriesName: string; value: [number, number | null] }[];
          if (items.length === 0) return "";
          const rows = items
            .map(
              (i) =>
                `<div style="display:flex;justify-content:space-between;gap:16px">` +
                `<span>${i.marker}${i.seriesName}</span>` +
                `<b>${i.value[1] === null ? "—" : formatNumber(i.value[1])}</b></div>`,
            )
            .join("");
          return `<div style="margin-bottom:4px">${bucketLabel(items[0].value[0])}</div>${rows}`;
        },
      },
      legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: textColor } },
      xAxis: {
        type: "time",
        min: start - pad,
        max: end + pad,
        axisLabel: { color: textColor, formatter: (v: number) => tick(v), hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: textColor, formatter: (v: number) => formatCompact(v) },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      series: [
        series("Enqueued", "--color-kumo-info", (p) => p.enqueued),
        series("Succeeded", "--color-kumo-success", (p) => p.processed - p.failed),
        series("Failed", "--color-kumo-danger", (p) => p.failed),
      ],
    } as KumoChartOption;
  }, [points, bucket, start, end, tz, isDarkMode]);

  return (
    <Chart
      echarts={echarts}
      options={options}
      isDarkMode={isDarkMode}
      height={height}
      aria-label={`Tasks enqueued, succeeded and failed per ${bucket}`}
    />
  );
}

export interface DurationSeries {
  name: string;
  colorVar: string;
  /** Previous period, drawn dashed. */
  dashed?: boolean;
  /** [bucket start (ms), value (ms), or null for a bucket without tasks]. */
  data: [number, number | null][];
}

/**
 * Processing durations (or wait times) over time, in milliseconds. Buckets without tasks show as gaps.
 * Series of a previous period are shifted onto the current period and drawn dashed.
 */
export function DurationChart({
  series,
  start,
  end,
  bucketMs,
  height = 260,
  formatValue,
}: {
  series: DurationSeries[];
  start: number;
  end: number;
  bucketMs: number;
  height?: number;
  formatValue: (ms: number) => string;
}) {
  const { isDarkMode, settings } = useSettings();
  const tz = settings.timeZone;
  const options = useMemo<KumoChartOption>(() => {
    const timeZone = tz === "utc" ? "UTC" : undefined;
    const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
    const multiDay = end - start > 2 * 86_400_000;
    const tick = (ms: number) => (multiDay ? dayFormat.format(ms) : formatTimeShort(ms, tz));
    const bucketLabel = (ms: number) =>
      `${dayFormat.format(ms)}, ${formatTimeShort(ms, tz)}–${formatTimeShort(ms + bucketMs, tz)}${tz === "utc" ? " UTC" : ""}`;
    const textColor = ChartPalette.text("secondary", isDarkMode);
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 32, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const items = params as { marker: string; seriesName: string; value: [number, number | null] }[];
          if (items.length === 0) return "";
          const rows = items
            .map(
              (i) =>
                `<div style="display:flex;justify-content:space-between;gap:16px">` +
                `<span>${i.marker}${i.seriesName}</span>` +
                `<b>${i.value[1] === null || i.value[1] === undefined ? "—" : formatValue(i.value[1])}</b></div>`,
            )
            .join("");
          return `<div style="margin-bottom:4px">${bucketLabel(items[0].value[0])}</div>${rows}`;
        },
      },
      legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: textColor } },
      xAxis: {
        type: "time",
        min: start,
        max: end,
        axisLabel: { color: textColor, formatter: (v: number) => tick(v), hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, formatter: (v: number) => formatValue(v) },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        showSymbol: s.data.filter((d) => d[1] !== null).length < 3,
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { width: s.dashed ? 1.5 : 2, type: s.dashed ? "dashed" : "solid", opacity: s.dashed ? 0.7 : 1 },
        itemStyle: { color: resolveColor(s.colorVar) },
        emphasis: { focus: "series" },
        data: s.data,
      })),
    } as KumoChartOption;
  }, [series, start, end, bucketMs, tz, isDarkMode, formatValue]);

  return (
    <Chart
      echarts={echarts}
      options={options}
      isDarkMode={isDarkMode}
      height={height}
      aria-label="Task processing durations over time"
    />
  );
}
