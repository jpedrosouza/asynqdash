import { useMemo } from "react";
import { Chart, ChartPalette, TimeseriesChart, type KumoChartOption } from "@cloudflare/kumo";
import { echarts, resolveColor } from "../lib/echarts";
import { useSettings } from "../lib/settings";
import { TASK_STATES } from "../lib/task-states";
import { formatCompact, formatNumber } from "../lib/format";
import type { DailyStat, Queue } from "../lib/types";

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
export function ProcessedTodayChart({ queues, height = 280 }: { queues: Queue[]; height?: number }) {
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

/** Daily processed and failed tasks over the last N days, summed across queues. */
export function DailyStatsChart({
  stats,
  days,
  height = 280,
}: {
  stats: Record<string, DailyStat[]>;
  days: number;
  height?: number;
}) {
  const { isDarkMode } = useSettings();
  const data = useMemo(() => {
    const byDay = new Map<number, { processed: number; failed: number }>();
    for (const list of Object.values(stats)) {
      for (const s of list) {
        const t = Date.parse(`${s.date}T00:00:00Z`);
        const entry = byDay.get(t) ?? { processed: 0, failed: 0 };
        entry.processed += s.processed;
        entry.failed += s.failed;
        byDay.set(t, entry);
      }
    }
    const points = [...byDay.entries()].sort((a, b) => a[0] - b[0]).slice(-days);
    return [
      {
        name: "Succeeded",
        color: resolveColor("--color-kumo-success"),
        data: points.map(([t, v]) => [t, v.processed - v.failed] as [number, number]),
      },
      {
        name: "Failed",
        color: resolveColor("--color-kumo-danger"),
        data: points.map(([t, v]) => [t, v.failed] as [number, number]),
      },
    ];
    // isDarkMode re-resolves the theme colors.
  }, [stats, days, isDarkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const dateFormat = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(ms);

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
      tooltipTimestampFormat={(ms) => `${dateFormat(ms)} (UTC)`}
      ariaDescription={`Tasks processed per day over the last ${days} days`}
    />
  );
}
