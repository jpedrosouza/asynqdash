// Types mirroring the JSON responses of the asynqmon API (see conversion_helpers.go).

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
}

export interface GroupInfo {
  group: string;
  size: number;
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
