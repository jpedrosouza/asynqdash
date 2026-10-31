import type { TaskState } from "./types";

// Paths are relative to the router basename (ROOT_PATH).
export const paths = {
  home: "/",
  servers: "/servers",
  schedulers: "/schedulers",
  redis: "/redis",
  metrics: "/metrics",
  settings: "/settings",
  flows: "/flows",
  rateLimits: "/rate-limits",
};

export function flowRunPath(runId: string): string {
  return `/flows/runs/${encodeURIComponent(runId)}`;
}

export function flowPath(name: string): string {
  return `/flows?flow=${encodeURIComponent(name)}`;
}

export function queuePath(qname: string, state?: TaskState, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (state) params.set("status", state);
  const search = params.toString();
  return `/queues/${encodeURIComponent(qname)}${search ? `?${search}` : ""}`;
}

export function taskPath(qname: string, taskId: string): string {
  return `/queues/${encodeURIComponent(qname)}/tasks/${encodeURIComponent(taskId)}`;
}
