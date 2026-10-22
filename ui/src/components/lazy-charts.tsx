import { lazy, Suspense, type ComponentProps } from "react";

// Charts pull in ECharts, the largest dependency of the app. Loading them on demand
// lets pages render their stats and tables before the charting library arrives.
const charts = () => import("./charts");

const QueueSizeChartImpl = lazy(() => charts().then((m) => ({ default: m.QueueSizeChart })));
const ProcessedTodayChartImpl = lazy(() => charts().then((m) => ({ default: m.ProcessedTodayChart })));
const DailyStatsChartImpl = lazy(() => charts().then((m) => ({ default: m.DailyStatsChart })));

function ChartFallback({ height = 280 }: { height?: number }) {
  return <div className="skeleton w-full rounded-lg" style={{ height }} aria-hidden="true" />;
}

export function QueueSizeChart(props: ComponentProps<typeof QueueSizeChartImpl>) {
  return (
    <Suspense fallback={<ChartFallback height={props.height} />}>
      <QueueSizeChartImpl {...props} />
    </Suspense>
  );
}

export function ProcessedTodayChart(props: ComponentProps<typeof ProcessedTodayChartImpl>) {
  return (
    <Suspense fallback={<ChartFallback height={props.height} />}>
      <ProcessedTodayChartImpl {...props} />
    </Suspense>
  );
}

export function DailyStatsChart(props: ComponentProps<typeof DailyStatsChartImpl>) {
  return (
    <Suspense fallback={<ChartFallback height={props.height} />}>
      <DailyStatsChartImpl {...props} />
    </Suspense>
  );
}
