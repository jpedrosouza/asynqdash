// ECharts is tree-shaken: only the chart types and components used by the app are bundled.
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  BrushComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  AriaComponent,
  AxisPointerComponent,
  BrushComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export { echarts };

/**
 * Resolves a CSS color token (e.g. "--color-kumo-info") to a concrete color for the
 * current theme. Canvas-based charts cannot use CSS variables or light-dark() directly.
 */
export function resolveColor(cssVar: string): string {
  const el = document.createElement("span");
  el.style.color = `var(${cssVar})`;
  el.style.display = "none";
  document.body.appendChild(el);
  const color = getComputedStyle(el).color;
  el.remove();
  return color || "#888";
}
