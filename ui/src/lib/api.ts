import { ROOT_PATH } from "./flags";
import type {
  AllTasksResponse,
  BatchResponse,
  DailyStat,
  FlowInfo,
  FlowRun,
  KeyRateLimit,
  QueueMetadata,
  TaskMetricsResponse,
  ListGroupsResponse,
  ListTasksResponse,
  MetricsResponse,
  Queue,
  RedisInfoResponse,
  SchedulerEnqueueEvent,
  SchedulerEntry,
  ServerInfo,
  TaskInfo,
  TaskState,
  TaskTypesResponse,
  ThroughputResolution,
  ThroughputResponse,
} from "./types";

const BASE_URL = `${ROOT_PATH}/api`;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Could not reach the asynqdash server. Check your network connection.");
  }
  if (!resp.ok) {
    const text = (await resp.text()).trim();
    throw new ApiError(resp.status, text || `${resp.status} ${resp.statusText}`);
  }
  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const q = encodeURIComponent;

export interface PageOptions {
  page: number; // 1-based
  size: number;
}

function pageQuery(p?: PageOptions): string {
  return p ? `?page=${p.page}&size=${p.size}` : "";
}

/** Order of task lists: newest first ("desc") or oldest first ("asc"). */
export type ListOrder = "desc" | "asc";

/* ------------------------------- Queues -------------------------------- */

export const listQueues = () => request<{ queues: Queue[] }>("GET", "/queues").then((r) => r.queues);

export const listQueueStats = () =>
  request<{ stats: Record<string, DailyStat[]> }>("GET", "/queue_stats").then((r) => r.stats);

export const pauseQueue = (qname: string) => request<void>("POST", `/queues/${q(qname)}:pause`);
export const resumeQueue = (qname: string) => request<void>("POST", `/queues/${q(qname)}:resume`);
export const deleteQueue = (qname: string) => request<void>("DELETE", `/queues/${q(qname)}`);

export const listTaskTypes = (qname: string) => request<TaskTypesResponse>("GET", `/queues/${q(qname)}/task_types`);

export const listGroups = (qname: string) => request<ListGroupsResponse>("GET", `/queues/${q(qname)}/groups`);

/* -------------------------------- Tasks -------------------------------- */

/** Base path of the task collection for the given state (and group, for aggregating tasks). */
function tasksPath(qname: string, state: TaskState, group?: string): string {
  if (state === "aggregating") {
    return `/queues/${q(qname)}/groups/${q(group ?? "")}/aggregating_tasks`;
  }
  return `/queues/${q(qname)}/${state}_tasks`;
}

export const listTasks = (qname: string, state: TaskState, page: PageOptions, order: ListOrder, group?: string) =>
  request<ListTasksResponse>("GET", `${tasksPath(qname, state, group)}${pageQuery(page)}&order=${order}`);

export const getTask = (qname: string, taskId: string) =>
  request<TaskInfo>("GET", `/queues/${q(qname)}/tasks/${q(taskId)}`);

export type TaskAction = "run" | "archive" | "delete" | "cancel";

/** Performs an action on a single task. */
export function taskAction(
  action: TaskAction,
  qname: string,
  state: TaskState,
  taskId: string,
  group?: string,
): Promise<void> {
  const base = tasksPath(qname, state, group);
  switch (action) {
    case "delete":
      return request("DELETE", `${base}/${q(taskId)}`);
    default:
      return request("POST", `${base}/${q(taskId)}:${action}`);
  }
}

/** Performs an action on a set of tasks. */
export function batchTaskAction(
  action: TaskAction,
  qname: string,
  state: TaskState,
  taskIds: string[],
  group?: string,
): Promise<BatchResponse> {
  return request("POST", `${tasksPath(qname, state, group)}:batch_${action}`, { task_ids: taskIds });
}

/** Performs an action on every task in the given state. */
export function allTasksAction(
  action: TaskAction,
  qname: string,
  state: TaskState,
  group?: string,
): Promise<AllTasksResponse | undefined> {
  const base = tasksPath(qname, state, group);
  if (action === "delete") return request("DELETE", `${base}:delete_all`);
  return request("POST", `${base}:${action}_all`);
}

/* ------------------------- Servers & schedulers ------------------------ */

export const listServers = () => request<{ servers: ServerInfo[] }>("GET", "/servers").then((r) => r.servers);

export const listSchedulerEntries = () =>
  request<{ entries: SchedulerEntry[] }>("GET", "/scheduler_entries").then((r) => r.entries);

export const listSchedulerEnqueueEvents = (entryId: string, page: PageOptions) =>
  request<{ events: SchedulerEnqueueEvent[] }>(
    "GET",
    `/scheduler_entries/${q(entryId)}/enqueue_events${pageQuery(page)}`,
  ).then((r) => r.events);

export const runSchedulerEntry = (entryId: string) =>
  request<{ task_id: string; queue: string }>("POST", `/scheduler_entries/${q(entryId)}:run`);

/* ------------------------------ Redis/metrics -------------------------- */

export const getRedisInfo = () => request<RedisInfoResponse>("GET", "/redis_info");

/**
 * Tasks enqueued, processed and failed per minute or per hour, as recorded by the throughput
 * collector. Queues default to every queue.
 */
export function getThroughput(
  resolution: ThroughputResolution,
  durationSeconds: number,
  queues: string[] = [],
): Promise<ThroughputResponse> {
  const params = new URLSearchParams({ resolution, duration: String(durationSeconds) });
  for (const name of queues) params.append("queue", name);
  return request("GET", `/throughput?${params.toString()}`);
}

export function getMetrics(endTime: number, duration: number, queues: string[]): Promise<MetricsResponse> {
  const params = new URLSearchParams({ endtime: String(endTime), duration: String(duration) });
  if (queues.length > 0) params.set("queues", queues.join(","));
  return request("GET", `/metrics?${params.toString()}`);
}

/* ---------------------------- Task metrics ----------------------------- */

/** Processing durations and counts recorded by the asynq servers for the tasks of a queue. */
export function getTaskMetrics(
  qname: string,
  resolution: ThroughputResolution,
  start: number,
  end: number,
  type?: string,
): Promise<TaskMetricsResponse> {
  const params = new URLSearchParams({ resolution, start: String(start), end: String(end) });
  if (type) params.set("type", type);
  return request("GET", `/queues/${q(qname)}/task_metrics?${params.toString()}`);
}

/* ------------------------ Queue metadata & limits ---------------------- */

export const setQueueMetadata = (qname: string, md: QueueMetadata) =>
  request<void>("POST", `/queues/${q(qname)}/metadata`, md);

export interface RateLimitInput {
  limit: number;
  period_ms: number;
  burst: number;
}

export const setQueueRateLimit = (qname: string, rl: RateLimitInput) =>
  request<void>("POST", `/queues/${q(qname)}/rate_limit`, rl);
export const removeQueueRateLimit = (qname: string) => request<void>("DELETE", `/queues/${q(qname)}/rate_limit`);

export const listRateLimits = () =>
  request<{ rate_limits: KeyRateLimit[] }>("GET", "/rate_limits").then((r) => r.rate_limits);
export const setRateLimit = (key: string, rl: RateLimitInput) => request<void>("POST", `/rate_limits/${q(key)}`, rl);
export const removeRateLimit = (key: string) => request<void>("DELETE", `/rate_limits/${q(key)}`);

export const flushGroup = (qname: string, group: string) =>
  request<void>("POST", `/queues/${q(qname)}/groups/${q(group)}:flush`);

/* -------------------------------- Flows -------------------------------- */

export const listFlows = () => request<{ flows: FlowInfo[] }>("GET", "/flows").then((r) => r.flows);
export const deleteFlow = (name: string) => request<void>("DELETE", `/flows/${q(name)}`);

export const listFlowRuns = (flow: string, page: PageOptions) =>
  request<{ runs: FlowRun[] }>("GET", `/flow_runs${pageQuery(page)}${flow ? `&flow=${q(flow)}` : ""}`).then(
    (r) => r.runs,
  );

export const getFlowRun = (id: string) => request<FlowRun>("GET", `/flow_runs/${q(id)}`);
