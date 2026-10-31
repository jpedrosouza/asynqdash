import type { GraphEdge, GraphNode, GraphTone } from "../components/FlowGraph";
import type { FlowInfo, FlowNode, FlowNodeState, FlowRun } from "./types";
import { formatMs, shortId } from "./format";
import { taskPath } from "./paths";

export const FLOW_NODE_STATE: Record<
  FlowNodeState,
  { label: string; tone: GraphTone; badge: "neutral" | "info" | "warning" | "success" | "error" }
> = {
  pending: { label: "Pending", tone: "neutral", badge: "neutral" },
  scheduled: { label: "Scheduled", tone: "neutral", badge: "neutral" },
  active: { label: "Active", tone: "info", badge: "info" },
  retry: { label: "Retry", tone: "warning", badge: "warning" },
  completed: { label: "Completed", tone: "success", badge: "success" },
  failed: { label: "Failed", tone: "danger", badge: "error" },
};

export const FLOW_RUN_STATE: Record<FlowRun["state"], { label: string; badge: "info" | "success" | "error" }> = {
  running: { label: "Running", badge: "info" },
  completed: { label: "Completed", badge: "success" },
  failed: { label: "Failed", badge: "error" },
};

function nodeState(n: FlowNode) {
  return FLOW_NODE_STATE[n.state] ?? FLOW_NODE_STATE.pending;
}

/** Graph of the task types of a flow definition: an edge per step, dashed for joins. */
export function flowDefinitionGraph(flow: FlowInfo): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const types: string[] = [];
  const add = (t: string) => {
    if (!types.includes(t)) types.push(t);
  };
  const edges: GraphEdge[] = [];
  for (const st of flow.steps) {
    st.from.forEach(add);
    add(st.to);
    for (const from of st.from) edges.push({ from, to: st.to, dashed: st.join });
  }
  const targets = new Set(flow.steps.map((s) => s.to));
  const nodes: GraphNode[] = types.map((t) => {
    const join = flow.steps.find((s) => s.to === t && s.join);
    return {
      id: t,
      label: t,
      sublabel: !targets.has(t) ? "starts the flow" : join ? `waits for ${join.from.join(" + ")}` : undefined,
      tone: !targets.has(t) ? "info" : "neutral",
    };
  });
  return { nodes, edges };
}

/** Graph of the tasks of a flow run, linked to the task pages. */
export function flowRunGraph(run: FlowRun, currentTaskId?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const ids = new Set(run.nodes.map((n) => n.id));
  const nodes: GraphNode[] = run.nodes.map((n) => {
    const st = nodeState(n);
    return {
      id: n.id,
      label: n.type,
      sublabel: `${n.queue} · ${shortId(n.id)}`,
      aside: n.state === "completed" || n.state === "failed" || n.duration_ms > 0 ? formatMs(n.duration_ms) : st.label,
      tone: st.tone,
      href: taskPath(n.queue, n.id),
      title: n.error ? `${st.label}: ${n.error}` : st.label,
      current: n.id === currentTaskId,
    };
  });
  const edges: GraphEdge[] = [];
  for (const n of run.nodes) {
    for (const p of n.parents) {
      if (ids.has(p)) edges.push({ from: p, to: n.id, dashed: n.parents.length > 1 });
    }
  }
  return { nodes, edges };
}

/** Counts of the tasks of a run by state. */
export function runProgress(run: FlowRun) {
  const done = run.nodes.filter((n) => n.state === "completed").length;
  const failed = run.nodes.filter((n) => n.state === "failed").length;
  return { total: run.nodes.length, done, failed, open: run.nodes.length - done - failed };
}

/** Time from the start of the run to the end of its last task, if the run is over. */
export function runDurationMs(run: FlowRun): number | null {
  if (run.state === "running") return null;
  const start = Date.parse(run.created_at);
  let end = 0;
  for (const n of run.nodes) {
    if (n.started_at) end = Math.max(end, Date.parse(n.started_at) + n.duration_ms);
  }
  return Number.isFinite(start) && end > start ? end - start : null;
}
