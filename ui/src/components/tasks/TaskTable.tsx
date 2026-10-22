import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Badge, Button, DropdownMenu, Empty, InputGroup, Link, Pagination, Table, Tooltip, cn } from "@cloudflare/kumo";
import {
  CaretDownIcon,
  DotsThreeIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { TaskInfo, TaskState } from "../../lib/types";
import { READ_ONLY } from "../../lib/flags";
import { useTaskList } from "../../lib/queries";
import { PAGE_SIZE_OPTIONS, useSettings } from "../../lib/settings";
import { ACTION_LABELS, TASK_STATE_META } from "../../lib/task-states";
import { formatDuration, formatNumber, payloadPreview, pluralize, shortId } from "../../lib/format";
import { taskPath } from "../../lib/paths";
import { ErrorState, RelativeTime, SkeletonRows } from "../common";
import { ACTION_ICONS } from "./TaskActionIcons";
import { useTaskActionRunner } from "./useTaskActionRunner";
import { TaskPreviewDialog } from "./TaskPreviewDialog";

interface Column {
  key: string;
  label: string;
  className?: string;
  render: (task: TaskInfo) => ReactNode;
}

function ErrorCell({ message }: { message: string }) {
  if (!message) return <span className="text-kumo-subtle">—</span>;
  return (
    <Tooltip
      content={<span className="block max-w-sm font-mono text-xs break-words whitespace-pre-wrap">{message}</span>}
    >
      <span className="block max-w-[280px] truncate font-mono text-xs text-kumo-danger">{message}</span>
    </Tooltip>
  );
}

function RetriesCell({ task }: { task: TaskInfo }) {
  return (
    <span className={cn("tabular", task.retried >= task.max_retry && task.max_retry > 0 && "text-kumo-danger")}>
      {task.retried}/{task.max_retry}
    </span>
  );
}

/** Columns that only make sense for some task states. */
function stateColumns(state: TaskState): Column[] {
  switch (state) {
    case "active":
      return [
        {
          key: "started",
          label: "Started",
          render: (t) => (
            <span className="flex items-center gap-2">
              <RelativeTime value={t.start_time} />
              {t.is_orphaned && (
                <Tooltip content="Marked as active, but no worker reports processing it.">
                  <Badge variant="warning" icon={<WarningIcon />}>
                    Orphaned
                  </Badge>
                </Tooltip>
              )}
            </span>
          ),
        },
        { key: "deadline", label: "Deadline", render: (t) => <RelativeTime value={t.deadline} /> },
      ];
    case "pending":
      return [{ key: "retried", label: "Retries", render: (t) => <RetriesCell task={t} /> }];
    case "aggregating":
      return [{ key: "group", label: "Group", render: (t) => <span className="font-mono text-xs">{t.group}</span> }];
    case "scheduled":
      return [{ key: "next", label: "Runs", render: (t) => <RelativeTime value={t.next_process_at} /> }];
    case "retry":
      return [
        { key: "next", label: "Next retry", render: (t) => <RelativeTime value={t.next_process_at} /> },
        { key: "error", label: "Last error", render: (t) => <ErrorCell message={t.error_message} /> },
        { key: "retried", label: "Retries", render: (t) => <RetriesCell task={t} /> },
      ];
    case "archived":
      return [
        { key: "failed", label: "Last failed", render: (t) => <RelativeTime value={t.last_failed_at} /> },
        { key: "error", label: "Last error", render: (t) => <ErrorCell message={t.error_message} /> },
      ];
    case "completed":
      return [
        { key: "completed", label: "Completed", render: (t) => <RelativeTime value={t.completed_at} /> },
        {
          key: "ttl",
          label: "Expires",
          render: (t) =>
            t.ttl_seconds > 0 ? (
              <span className="whitespace-nowrap">in {formatDuration(t.ttl_seconds)}</span>
            ) : (
              "Expired"
            ),
        },
        {
          key: "result",
          label: "Result",
          render: (t) => (
            <span className="block max-w-[240px] truncate font-mono text-xs text-kumo-subtle">
              {t.result ? payloadPreview(t.result, 80) : "—"}
            </span>
          ),
        },
      ];
  }
}

function usePageParam(): [number, (page: number) => void] {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const setPage = (p: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (p <= 1) next.delete("page");
        else next.set("page", String(p));
        return next;
      },
      { replace: true },
    );
  return [page, setPage];
}

interface TaskTableProps {
  qname: string;
  state: TaskState;
  /** Number of tasks in this state, from the queue stats. */
  totalCount: number;
  group?: string;
}

export function TaskTable({ qname, state, totalCount, group }: TaskTableProps) {
  const { settings, update } = useSettings();
  const pageSize = settings.pageSize;
  const [page, setPage] = usePageParam();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { data, error, isLoading, isPlaceholderData, refetch } = useTaskList(qname, state, page, pageSize, group);
  const meta = TASK_STATE_META[state];
  const runner = useTaskActionRunner(qname, state, group, () => setSelected(new Set()));

  // The list response carries fresh stats; prefer them over the (possibly older) queue stats.
  const total = data && !isPlaceholderData ? (state === "aggregating" ? totalCount : data.stats[state]) : totalCount;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const tasks = data?.tasks ?? [];

  // Reset selection and filter when the list context changes.
  useEffect(() => {
    setSelected(new Set());
  }, [qname, state, group, page, pageSize]);
  useEffect(() => {
    setFilter("");
  }, [qname, state, group]);

  // Drop selected ids that are no longer listed (e.g. processed while polling).
  useEffect(() => {
    if (!data) return;
    setSelected((prev) => {
      const visible = new Set(data.tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  // After tasks are removed, the current page may be past the end: go back to the last page.
  useEffect(() => {
    if (data && !isPlaceholderData && page > lastPage) setPage(lastPage);
  }, [data, isPlaceholderData, page, lastPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleTasks = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return tasks;
    return tasks.filter(
      (t) =>
        t.id.toLowerCase().includes(term) ||
        t.type.toLowerCase().includes(term) ||
        t.payload.toLowerCase().includes(term),
    );
  }, [tasks, filter]);

  const columns = useMemo<Column[]>(
    () => [
      {
        key: "id",
        label: "ID",
        render: (t) => (
          <Link
            href={taskPath(qname, t.id)}
            variant="plain"
            className="font-mono text-xs"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            title={t.id}
          >
            {shortId(t.id)}
          </Link>
        ),
      },
      {
        key: "type",
        label: "Type",
        render: (t) => <span className="font-mono text-xs font-medium whitespace-nowrap">{t.type}</span>,
      },
      ...stateColumns(state),
      // Last, so that it takes the remaining width without pushing state columns off screen.
      {
        key: "payload",
        label: "Payload",
        className: "w-full",
        render: (t) => (
          <span className="block max-w-[560px] min-w-[160px] truncate font-mono text-xs text-kumo-subtle">
            {payloadPreview(t.payload, 200)}
          </span>
        ),
      },
    ],
    [qname, state],
  );

  const canAct = !READ_ONLY && meta.actions.length > 0;
  const allSelected = visibleTasks.length > 0 && visibleTasks.every((t) => selected.has(t.id));
  const someSelected = visibleTasks.some((t) => selected.has(t.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleTasks.map((t) => t.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (error && !data) {
    return (
      <ErrorState title={`Could not load ${meta.label.toLowerCase()} tasks`} error={error} onRetry={() => refetch()} />
    );
  }
  if (isLoading) return <SkeletonRows />;
  if (total === 0 && tasks.length === 0) {
    return <Empty size="sm" title={`No ${meta.label.toLowerCase()} tasks`} description={meta.emptyDescription} />;
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar: bulk actions for the selection, or for every task in the state. */}
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-kumo-hairline px-3 py-2">
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 animate-fade-in-up">
            <span className="text-sm font-medium text-kumo-default">{pluralize(selected.size, "selected task")}</span>
            {meta.actions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "delete" || action === "cancel" ? "secondary-destructive" : "secondary"}
                icon={ACTION_ICONS[action]}
                disabled={runner.isPending}
                onClick={() => runner.trigger({ action, scope: "batch", ids: [...selected], count: selected.size })}
              >
                {ACTION_LABELS[action].verb}
              </Button>
            ))}
            <Button size="sm" variant="ghost" icon={XIcon} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        ) : (
          <>
            <InputGroup className="w-full max-w-xs" size="sm">
              <InputGroup.Addon>
                <FunnelSimpleIcon />
              </InputGroup.Addon>
              <InputGroup.Input
                placeholder="Filter this page by ID, type or payload"
                aria-label="Filter tasks on this page"
                value={filter}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
              />
              {filter && (
                <InputGroup.Addon align="end">
                  <InputGroup.Button
                    shape="square"
                    size="xs"
                    icon={XIcon}
                    aria-label="Clear filter"
                    onClick={() => setFilter("")}
                  />
                </InputGroup.Addon>
              )}
            </InputGroup>
            {canAct && (
              <div className="ml-auto">
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    render={
                      <Button size="sm" variant="secondary" disabled={runner.isPending}>
                        Bulk actions
                        <CaretDownIcon />
                      </Button>
                    }
                  />
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Group>
                      <DropdownMenu.Label>
                        All {formatNumber(total)} {meta.label.toLowerCase()} tasks
                      </DropdownMenu.Label>
                      {meta.allActions.map((action) => (
                        <DropdownMenu.Item
                          key={action}
                          icon={ACTION_ICONS[action]}
                          variant={action === "delete" || action === "cancel" ? "danger" : "default"}
                          onClick={() => runner.trigger({ action, scope: "all", count: total })}
                        >
                          {ACTION_LABELS[action].verb} all
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Group>
                  </DropdownMenu.Content>
                </DropdownMenu>
              </div>
            )}
          </>
        )}
      </div>

      <div className={cn("overflow-x-auto transition-opacity", isPlaceholderData && "opacity-60")}>
        <Table aria-label={`${meta.label} tasks`}>
          <Table.Header variant="compact">
            <Table.Row>
              {canAct && (
                <Table.CheckHead
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all tasks on this page"
                />
              )}
              {columns.map((c) => (
                <Table.Head key={c.key} className={cn("whitespace-nowrap", c.className)}>
                  {c.label}
                </Table.Head>
              ))}
              {canAct && (
                <Table.Head sticky="right">
                  <span className="sr-only">Actions</span>
                </Table.Head>
              )}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visibleTasks.map((task) => (
              <Table.Row
                key={task.id}
                variant={selected.has(task.id) ? "selected" : "default"}
                className="cursor-pointer"
                onClick={() => setPreviewId(task.id)}
              >
                {canAct && (
                  <Table.CheckCell
                    checked={selected.has(task.id)}
                    onCheckedChange={() => toggleOne(task.id)}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    aria-label={`Select task ${task.id}`}
                  />
                )}
                {columns.map((c) => (
                  <Table.Cell key={c.key} className={c.className}>
                    {c.render(task)}
                  </Table.Cell>
                ))}
                {canAct && (
                  <Table.Cell
                    sticky="right"
                    className="text-right"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenu.Trigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            shape="square"
                            icon={DotsThreeIcon}
                            aria-label={`Actions for task ${task.id}`}
                          />
                        }
                      />
                      <DropdownMenu.Content align="end">
                        {meta.actions.map((action) => (
                          <DropdownMenu.Item
                            key={action}
                            icon={ACTION_ICONS[action]}
                            variant={action === "delete" ? "danger" : "default"}
                            disabled={runner.isPending}
                            onClick={() => runner.trigger({ action, scope: "single", ids: [task.id], count: 1 })}
                          >
                            {ACTION_LABELS[action].label}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {visibleTasks.length === 0 && filter && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-kumo-subtle">
            <MagnifyingGlassIcon size={20} />
            No task on this page matches “{filter}”.
          </div>
        )}
      </div>

      <div className="border-t border-kumo-hairline px-3 py-2">
        <Pagination page={Math.min(page, lastPage)} setPage={setPage} perPage={pageSize} totalCount={total}>
          <Pagination.Info />
          <Pagination.Separator />
          <Pagination.PageSize
            value={pageSize}
            options={PAGE_SIZE_OPTIONS}
            onChange={(size) => {
              update({ pageSize: size });
              setPage(1);
            }}
          />
          <Pagination.Controls />
        </Pagination>
      </div>

      <TaskPreviewDialog
        qname={qname}
        taskId={previewId}
        state={state}
        group={group}
        onClose={() => setPreviewId(null)}
      />
      {runner.dialog}
    </div>
  );
}
