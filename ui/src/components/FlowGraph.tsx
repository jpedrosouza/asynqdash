import { useMemo, type ReactNode } from "react";
import { cn } from "@cloudflare/kumo";
import { AppLink } from "./AppLink";

export type GraphTone = "neutral" | "info" | "success" | "danger" | "warning" | "muted";

export interface GraphNode {
  id: string;
  label: ReactNode;
  sublabel?: ReactNode;
  /** Small text on the right of the label, e.g. a duration. */
  aside?: ReactNode;
  tone?: GraphTone;
  href?: string;
  title?: string;
  /** Highlighted node (e.g. the node of the current task). */
  current?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Joins are drawn with a dashed line. */
  dashed?: boolean;
}

const NODE_W = 216;
const NODE_H = 58;
const GAP_X = 64;
const GAP_Y = 16;
const PAD = 8;

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
}

/**
 * Lays the graph out in columns: each node goes one column right of its furthest parent, so that the edges go left
 * to right in the order the tasks run. Nodes of a column are ordered by the position of their parents to limit
 * crossings.
 */
function layout(nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    parents.set(n.id, []);
    children.set(n.id, []);
  }
  for (const e of valid) {
    parents.get(e.to)!.push(e.from);
    children.get(e.from)!.push(e.to);
  }

  // Longest path layering (Kahn); nodes left in a cycle go after their placed parents.
  const layer = new Map<string, number>();
  const indegree = new Map(nodes.map((n) => [n.id, parents.get(n.id)!.length]));
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const l = Math.max(0, ...parents.get(id)!.map((p) => (layer.get(p) ?? -1) + 1));
    layer.set(id, l);
    for (const c of children.get(id)!) {
      indegree.set(c, indegree.get(c)! - 1);
      if (indegree.get(c) === 0) queue.push(c);
    }
  }
  for (const n of nodes) {
    if (!layer.has(n.id)) {
      layer.set(n.id, Math.max(0, ...parents.get(n.id)!.map((p) => (layer.get(p) ?? -1) + 1)));
    }
  }

  const columns: string[][] = [];
  for (const n of nodes) {
    const l = layer.get(n.id)!;
    (columns[l] ??= []).push(n.id);
  }
  // Order each column by the average row of the parents (barycenter), keeping the input order on ties.
  const row = new Map<string, number>();
  columns.forEach((col, ci) => {
    if (ci > 0) {
      const order = new Map(col.map((id, i) => [id, i]));
      col.sort((a, b) => {
        const avg = (id: string) => {
          const ps = parents.get(id)!.filter((p) => row.has(p));
          return ps.length ? ps.reduce((s, p) => s + row.get(p)!, 0) / ps.length : order.get(id)!;
        };
        return avg(a) - avg(b) || order.get(a)! - order.get(b)!;
      });
    }
    col.forEach((id, i) => row.set(id, i));
  });

  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0));
  const height = tallest * NODE_H + (tallest - 1) * GAP_Y + 2 * PAD;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = new Map<string, Placed>();
  columns.forEach((col, ci) => {
    const colHeight = col.length * NODE_H + (col.length - 1) * GAP_Y;
    const top = PAD + (height - 2 * PAD - colHeight) / 2;
    col.forEach((id, i) => {
      placed.set(id, { node: byId.get(id)!, x: PAD + ci * (NODE_W + GAP_X), y: top + i * (NODE_H + GAP_Y) });
    });
  });
  const width = columns.length * NODE_W + (columns.length - 1) * GAP_X + 2 * PAD;

  // Edges between adjacent columns are a single curve. An edge that skips columns goes below the nodes of the
  // columns it crosses, so that it does not seem to end at one of them.
  const colOf = (id: string) => layer.get(id)!;
  let bottom = height;
  const paths = valid.map((e) => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x - 2;
    const y2 = b.y + NODE_H / 2;
    if (colOf(e.to) - colOf(e.from) <= 1) {
      const dx = Math.max(24, (x2 - x1) / 2);
      return { edge: e, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` };
    }
    let lowest = Math.max(y1, y2);
    for (let c = colOf(e.from) + 1; c < colOf(e.to); c++) {
      for (const id of columns[c] ?? []) lowest = Math.max(lowest, placed.get(id)!.y + NODE_H);
    }
    const yd = lowest + GAP_Y / 2 + 4;
    bottom = Math.max(bottom, yd + PAD);
    const r = GAP_X / 2;
    return {
      edge: e,
      d:
        `M${x1},${y1} C${x1 + r},${y1} ${x1 + r},${yd} ${x1 + GAP_X},${yd} ` +
        `L${x2 - GAP_X},${yd} C${x2 - r},${yd} ${x2 - r},${y2} ${x2},${y2}`,
    };
  });
  return { placed, paths, width, height: bottom };
}

const TONE_CLASSES: Record<GraphTone, { dot: string; ring: string }> = {
  neutral: { dot: "bg-kumo-fill", ring: "ring-kumo-hairline" },
  muted: { dot: "bg-kumo-fill", ring: "ring-kumo-hairline" },
  info: { dot: "bg-kumo-info", ring: "ring-kumo-info/50" },
  success: { dot: "bg-kumo-success", ring: "ring-kumo-hairline" },
  danger: { dot: "bg-kumo-danger", ring: "ring-kumo-danger/60" },
  warning: { dot: "bg-kumo-warning", ring: "ring-kumo-warning/60" },
};

/** Directed acyclic graph of tasks, drawn left to right. */
export function FlowGraph({
  nodes,
  edges,
  className,
  ariaLabel,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  className?: string;
  ariaLabel: string;
}) {
  const { placed, paths, width, height } = useMemo(() => layout(nodes, edges), [nodes, edges]);

  return (
    <div className={cn("max-h-[640px] overflow-auto", className)} role="figure" aria-label={ariaLabel}>
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0 text-kumo-subtle" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {paths.map(({ edge, d }) => (
            <path
              key={`${edge.from}->${edge.to}`}
              d={d}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray={edge.dashed ? "5 4" : undefined}
              markerEnd="url(#flow-arrow)"
              stroke="currentColor"
              opacity={0.7}
            />
          ))}
        </svg>
        {[...placed.values()].map(({ node, x, y }) => {
          const tone = TONE_CLASSES[node.tone ?? "neutral"];
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn("size-2 shrink-0 rounded-full", tone.dot, node.tone === "info" && "animate-pulse")}
                />
                <span className="truncate font-mono text-xs font-medium text-kumo-default">{node.label}</span>
                {node.aside && <span className="ml-auto shrink-0 text-xs text-kumo-subtle tabular">{node.aside}</span>}
              </span>
              {node.sublabel && <span className="truncate pl-4 text-xs text-kumo-subtle">{node.sublabel}</span>}
            </>
          );
          const cls = cn(
            "absolute flex flex-col justify-center gap-0.5 rounded-lg bg-kumo-base px-3 ring shadow-xs",
            tone.ring,
            node.tone === "muted" && "opacity-60",
            node.current && "ring-2 ring-kumo-brand",
            node.href && "transition-colors hover:bg-kumo-tint",
          );
          const style = { left: x, top: y, width: NODE_W, height: NODE_H };
          return node.href ? (
            <AppLink key={node.id} href={node.href} className={cls} style={style} title={node.title}>
              {body}
            </AppLink>
          ) : (
            <div key={node.id} className={cls} style={style} title={node.title}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
