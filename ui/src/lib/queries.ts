import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { TaskAction } from "./api";
import { useRefetchInterval } from "./settings";
import { ACTION_LABELS } from "./task-states";
import { notifyError, notifySuccess } from "./toast";
import { pluralize } from "./format";
import type { BatchResponse, TaskState } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live data is refreshed by polling; avoid duplicate requests when windows regain focus.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000,
    },
  },
});

export const keys = {
  queues: ["queues"] as const,
  queueStats: ["queue-stats"] as const,
  tasks: (qname: string) => ["tasks", qname] as const,
  taskList: (qname: string, state: TaskState, group: string | undefined, page: number, size: number) =>
    ["tasks", qname, state, group ?? "", page, size] as const,
  task: (qname: string, id: string) => ["task", qname, id] as const,
  groups: (qname: string) => ["groups", qname] as const,
  taskTypes: (qname: string) => ["task-types", qname] as const,
  servers: ["servers"] as const,
  schedulerEntries: ["scheduler-entries"] as const,
  enqueueEvents: (id: string, page: number) => ["enqueue-events", id, page] as const,
  redis: ["redis"] as const,
  metrics: (end: number, duration: number, queues: string[]) => ["metrics", end, duration, queues] as const,
};

/* -------------------------------- Queries ------------------------------- */

export function useQueues() {
  const refetchInterval = useRefetchInterval();
  return useQuery({ queryKey: keys.queues, queryFn: api.listQueues, refetchInterval });
}

export function useQueue(qname: string) {
  const query = useQueues();
  return { ...query, data: query.data?.find((q) => q.queue === qname) };
}

export function useQueueStats() {
  return useQuery({
    queryKey: keys.queueStats,
    queryFn: api.listQueueStats,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useTaskList(qname: string, state: TaskState, page: number, size: number, group?: string) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: keys.taskList(qname, state, group, page, size),
    queryFn: () => api.listTasks(qname, state, { page, size }, group),
    refetchInterval,
    placeholderData: keepPreviousData,
    enabled: state !== "aggregating" || !!group,
  });
}

export function useTask(qname: string, id: string) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: keys.task(qname, id),
    queryFn: () => api.getTask(qname, id),
    refetchInterval,
    retry: (count, err) => !(err instanceof api.ApiError && err.status === 404) && count < 1,
  });
}

export function useGroups(qname: string) {
  const refetchInterval = useRefetchInterval();
  return useQuery({ queryKey: keys.groups(qname), queryFn: () => api.listGroups(qname), refetchInterval });
}

export function useTaskTypes(qname: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.taskTypes(qname),
    queryFn: () => api.listTaskTypes(qname),
    enabled,
    staleTime: 30_000,
  });
}

export function useServers() {
  const refetchInterval = useRefetchInterval();
  return useQuery({ queryKey: keys.servers, queryFn: api.listServers, refetchInterval });
}

export function useSchedulerEntries() {
  const refetchInterval = useRefetchInterval();
  return useQuery({ queryKey: keys.schedulerEntries, queryFn: api.listSchedulerEntries, refetchInterval });
}

export function useEnqueueEvents(entryId: string | null, page: number) {
  return useQuery({
    queryKey: keys.enqueueEvents(entryId ?? "", page),
    queryFn: () => api.listSchedulerEnqueueEvents(entryId!, { page, size: 20 }),
    enabled: !!entryId,
    placeholderData: keepPreviousData,
  });
}

export function useRedisInfo() {
  const refetchInterval = useRefetchInterval();
  return useQuery({ queryKey: keys.redis, queryFn: api.getRedisInfo, refetchInterval });
}

/* ------------------------------- Mutations ------------------------------ */

function useInvalidateQueue() {
  const client = useQueryClient();
  return (qname: string) => {
    client.invalidateQueries({ queryKey: keys.queues });
    client.invalidateQueries({ queryKey: keys.tasks(qname) });
    client.invalidateQueries({ queryKey: ["task", qname] });
    client.invalidateQueries({ queryKey: keys.groups(qname) });
  };
}

export function useQueueActions() {
  const invalidate = useInvalidateQueue();
  const pause = useMutation({
    mutationFn: api.pauseQueue,
    onSuccess: (_, qname) => notifySuccess(`Queue "${qname}" paused`, "Workers will stop picking up its tasks."),
    onError: (err, qname) => notifyError(`Could not pause "${qname}"`, err),
    onSettled: (_d, _e, qname) => invalidate(qname),
  });
  const resume = useMutation({
    mutationFn: api.resumeQueue,
    onSuccess: (_, qname) => notifySuccess(`Queue "${qname}" resumed`),
    onError: (err, qname) => notifyError(`Could not resume "${qname}"`, err),
    onSettled: (_d, _e, qname) => invalidate(qname),
  });
  const remove = useMutation({
    mutationFn: api.deleteQueue,
    onSuccess: (_, qname) => notifySuccess(`Queue "${qname}" deleted`),
    onError: (err, qname) => notifyError(`Could not delete "${qname}"`, err),
    onSettled: (_d, _e, qname) => invalidate(qname),
  });
  return { pause, resume, remove };
}

function batchSucceeded(action: TaskAction, resp: BatchResponse): string[] {
  switch (action) {
    case "delete":
      return resp.deleted_ids ?? [];
    case "run":
      return resp.pending_ids ?? [];
    case "archive":
      return resp.archived_ids ?? [];
    case "cancel":
      return resp.canceled_ids ?? [];
  }
}

function batchFailed(resp: BatchResponse): string[] {
  return resp.failed_ids ?? resp.error_ids ?? [];
}

function actionSentence(action: TaskAction, n: number): string {
  if (action === "cancel") return `Cancelation signal sent to ${pluralize(n, "task")}`;
  return `${pluralize(n, "task")} ${ACTION_LABELS[action].past}`;
}

/** Mutations for tasks of a given queue and state. Every mutation shows a toast with its outcome. */
export function useTaskActions(qname: string, state: TaskState, group?: string) {
  const invalidate = useInvalidateQueue();

  const single = useMutation({
    mutationFn: ({ action, id }: { action: TaskAction; id: string }) => api.taskAction(action, qname, state, id, group),
    onSuccess: (_, { action }) => notifySuccess(actionSentence(action, 1)),
    onError: (err, { action }) => notifyError(`Could not ${ACTION_LABELS[action].verb.toLowerCase()} the task`, err),
    onSettled: () => invalidate(qname),
  });

  const batch = useMutation({
    mutationFn: ({ action, ids }: { action: TaskAction; ids: string[] }) =>
      api.batchTaskAction(action, qname, state, ids, group),
    onSuccess: (resp, { action }) => {
      const ok = batchSucceeded(action, resp);
      const failed = batchFailed(resp);
      if (ok.length > 0) notifySuccess(actionSentence(action, ok.length));
      if (failed.length > 0) {
        notifyError(
          `${pluralize(failed.length, "task")} could not be updated`,
          new Error("They may have changed state since the page was loaded."),
        );
      }
    },
    onError: (err, { action }) =>
      notifyError(`Could not ${ACTION_LABELS[action].verb.toLowerCase()} the selected tasks`, err),
    onSettled: () => invalidate(qname),
  });

  const all = useMutation({
    mutationFn: ({ action }: { action: TaskAction }) => api.allTasksAction(action, qname, state, group),
    onSuccess: (resp, { action }) => {
      const n = resp?.deleted ?? resp?.archived ?? resp?.scheduled;
      if (action === "cancel") notifySuccess(`Cancelation signal sent to all active tasks in "${qname}"`);
      else notifySuccess(n !== undefined ? actionSentence(action, n) : `All tasks ${ACTION_LABELS[action].past}`);
    },
    onError: (err, { action }) => notifyError(`Could not ${ACTION_LABELS[action].verb.toLowerCase()} all tasks`, err),
    onSettled: () => invalidate(qname),
  });

  return { single, batch, all };
}

export function useRunSchedulerEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.runSchedulerEntry(entryId),
    onSuccess: (resp) => notifySuccess("Task enqueued", `Task ${resp.task_id} was added to the "${resp.queue}" queue.`),
    onError: (err) => notifyError("Could not run the scheduler entry", err),
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.queues });
      client.invalidateQueries({ queryKey: keys.schedulerEntries });
    },
  });
}
