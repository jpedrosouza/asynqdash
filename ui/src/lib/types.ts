// Types mirroring the JSON responses of the asynqdash API (see conversion_helpers.go).

export type TaskState = "active" | "pending" | "aggregating" | "scheduled" | "retry" | "archived" | "completed";

export interface Queue {
  queue: string;
  paused: boolean;
  size: number;
  groups: number;
  latency_msec: number;
  display_latency: string;
  memory_usage_bytes: number;
  active: number;
  pending: number;
  aggregating: number;
  scheduled: number;
  retry: number;
  archived: number;
  completed: number;
  processed: number;
  failed: number;
  timestamp: string;
  /** User defined organization of the queue (see the queue details dialog). */
  category?: string;
  subcategory?: string;
  description?: string;
  /** Rate limit of the queue, absent if none. */
  rate_limit?: RateLimitInfo;
}

export interface RateLimitInfo {
  limit: number;
  period_ms: number;
  burst: number;
  /** Number of tasks that may start right now. */
  available: number;
  /** Time the next task may start. */
  next_at: string;
}

export interface KeyRateLimit extends RateLimitInfo {
  key: string;
}

export type ThroughputResolution = "minute" | "hour";

/** [bucket start (unix seconds), enqueued, processed (including failed), failed]. */
export type ThroughputPoint = [number, number, number, number];

export interface ThroughputResponse {
  resolution: ThroughputResolution;
  /** Requested period, in unix seconds. */
  start: number;
  end: number;
  /** Whether this asynqdash instance records throughput. */
  collector_enabled: boolean;
  /** Points of each queue, sorted by time. Buckets the collector did not observe are omitted. */
  queues: Record<string, ThroughputPoint[]>;
}

export interface DailyStat {
  queue: string;
  date: string;
  processed: number;
  failed: number;
}

export interface TaskInfo {
  id: string;
  queue: string;
  type: string;
  payload: string;
  state: TaskState;
  start_time: string;
  max_retry: number;
  retried: number;
  last_failed_at: string;
  error_message: string;
  next_process_at: string;
  timeout_seconds: number;
  deadline: string;
  group: string;
  completed_at: string;
  result: string;
  ttl_seconds: number;
  is_orphaned: boolean;
  /** Time the task was first enqueued (absent for tasks enqueued by older asynq versions). */
  enqueued_at?: string;
  /** Start of the last processing attempt. */
  started_at?: string;
  /** Duration of the last processing attempt, in milliseconds. */
  duration_ms?: number;
  /** Time the task waited in the pending state before its last attempt, in milliseconds. */
  wait_ms?: number;
  flow?: string;
  flow_run_id?: string;
  parent_id?: string;
  rate_limit_key?: string;
  /** Number of tasks in the batch carried by the task (asynq.NewBatchTask). */
  batch_size?: number;
  /** Tasks of the batch (task details only). */
  batch_items?: BatchItem[];
}

export interface BatchItem {
  id: string;
  type: string;
  payload: string;
  retried: number;
  max_retry: number;
  enqueued_at?: string;
  error_message?: string;
}

export interface GroupInfo {
  group: string;
  size: number;
  oldest_task_at?: string;
  newest_task_at?: string;
  /** Aggregation policy last used by a server; disabled criteria are 0. */
  policy?: GroupPolicy;
  flush_requested: boolean;
}

export interface GroupPolicy {
  max_size: number;
  min_size: number;
  grace_period_sec: number;
  max_delay_sec: number;
}

/** Processing metrics of a set of tasks. Durations are in milliseconds. */
export interface TaskMetricsStats {
  processed: number;
  failed: number;
  total_ms: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  wait_avg_ms: number;
  wait_p95_ms: number;
  wait_max_ms: number;
}

export interface TaskMetricsPoint extends TaskMetricsStats {
  /** Bucket start, in unix seconds. */
  time: number;
}

export interface TaskMetricsResponse {
  queue: string;
  resolution: ThroughputResolution;
  start: number;
  end: number;
  types: string[];
  points: TaskMetricsPoint[];
  summary: TaskMetricsStats;
  /** Sorted by total processing time, slowest first. */
  by_type: (TaskMetricsStats & { type: string })[];
}

export interface FlowStep {
  from: string[];
  to: string;
  join: boolean;
}

export interface FlowInfo {
  name: string;
  steps: FlowStep[];
  updated_at: string;
}

export type FlowNodeState = "pending" | "scheduled" | "active" | "retry" | "completed" | "failed";

export interface FlowNode {
  id: string;
  queue: string;
  type: string;
  parents: string[];
  state: FlowNodeState;
  enqueued_at?: string;
  started_at?: string;
  duration_ms: number;
  error?: string;
  result?: string;
}

export interface FlowRun {
  id: string;
  flow: string;
  root_id: string;
  root_queue: string;
  root_type: string;
  state: "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  nodes: FlowNode[];
}

export interface QueueMetadata {
  category: string;
  subcategory: string;
  description: string;
}

export interface ListTasksResponse {
  tasks: TaskInfo[];
  stats: Queue;
}

export interface ListGroupsResponse {
  stats: Queue;
  groups: GroupInfo[];
}

export interface WorkerInfo {
  task_id: string;
  queue: string;
  task_type: string;
  task_payload: string;
  start_time: string;
}

export interface ServerInfo {
  id: string;
  host: string;
  pid: number;
  concurrency: number;
  queue_priorities: Record<string, number>;
  strict_priority_enabled: boolean;
  start_time: string;
  status: string;
  active_workers: WorkerInfo[];
}

export interface SchedulerEntry {
  id: string;
  spec: string;
  task_type: string;
  task_payload: string;
  options: string[];
  next_enqueue_at: string;
  prev_enqueue_at?: string;
}

export interface SchedulerEnqueueEvent {
  task_id: string;
  enqueued_at: string;
}

export interface QueueLocation {
  queue: string;
  keyslot: number;
  nodes: string[];
}

export interface RedisInfoResponse {
  address: string;
  info: Record<string, string>;
  raw_info: string;
  cluster: boolean;
  raw_cluster_nodes: string;
  queue_locations: QueueLocation[] | null;
}

export interface TaskTypeStats {
  type: string;
  total: number;
  states: Partial<Record<TaskState, number>>;
}

export interface TaskTypesResponse {
  queue: string;
  types: TaskTypeStats[];
  scanned: number;
  truncated: boolean;
  max_per_state: number;
}

export interface PrometheusMetrics {
  metric: Record<string, string>;
  values: [number, string][];
}

export interface PrometheusResponse {
  status: "success" | "error";
  data?: { resultType: string; result: PrometheusMetrics[] };
  error?: string;
  errorType?: string;
}

export interface MetricsResponse {
  queue_size: PrometheusResponse;
  queue_latency_seconds: PrometheusResponse;
  queue_memory_usage_approx_bytes: PrometheusResponse;
  tasks_processed_per_second: PrometheusResponse;
  tasks_failed_per_second: PrometheusResponse;
  error_rate: PrometheusResponse;
  pending_tasks_by_queue: PrometheusResponse;
  retry_tasks_by_queue: PrometheusResponse;
  archived_tasks_by_queue: PrometheusResponse;
}

// Responses of bulk task operations. The id field names differ per operation.
export interface BatchResponse {
  deleted_ids?: string[];
  failed_ids?: string[];
  pending_ids?: string[];
  archived_ids?: string[];
  canceled_ids?: string[];
  error_ids?: string[];
}

export interface AllTasksResponse {
  deleted?: number;
  archived?: number;
  scheduled?: number;
}
