import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  InputGroup,
  LayerCard,
  Link,
  Pagination,
  Table,
  Tooltip,
} from "@cloudflare/kumo";
import {
  ClockCountdownIcon,
  ClockCounterClockwiseIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { READ_ONLY } from "../lib/flags";
import { useEnqueueEvents, useQueues, useRunSchedulerEntry, useSchedulerEntries } from "../lib/queries";
import { describeSpec } from "../lib/cron";
import { formatDateTime, payloadPreview, shortId } from "../lib/format";
import { useSettings } from "../lib/settings";
import { taskPath } from "../lib/paths";
import type { SchedulerEntry } from "../lib/types";
import { ErrorState, LoadingState, Page, PageHeader, RelativeTime } from "../components/common";
import { ConfirmDialog } from "../components/ConfirmDialog";

const PAGE_SIZE = 20;

/** Queue name from the entry options (e.g. `Queue("critical")`), defaulting to "default". */
function entryQueue(entry: SchedulerEntry): string {
  for (const opt of entry.options) {
    const m = opt.match(/^Queue\("(.*)"\)$/);
    if (m) return m[1];
  }
  return "default";
}

function HistoryDialog({ entry, onClose }: { entry: SchedulerEntry | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { settings } = useSettings();
  const { data: events, error, isLoading, refetch } = useEnqueueEvents(entry?.id ?? null, page);
  const queue = entry ? entryQueue(entry) : "";
  return (
    <Dialog.Root
      open={!!entry}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setPage(1);
        }
      }}
    >
      <Dialog size="lg" className="flex max-h-[85dvh] flex-col gap-4 overflow-hidden p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-lg font-semibold">Enqueue history</Dialog.Title>
            <Dialog.Description className="font-mono text-xs text-kumo-subtle">{entry?.task_type}</Dialog.Description>
          </div>
          <Button variant="ghost" size="sm" shape="square" icon={XIcon} aria-label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg ring ring-kumo-hairline">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title="Could not load the history" error={error} onRetry={() => refetch()} />
          ) : !events || events.length === 0 ? (
            <Empty
              size="sm"
              title={page === 1 ? "Never enqueued" : "No more events"}
              description="Events are kept for a limited time by asynq."
            />
          ) : (
            <Table>
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>Task</Table.Head>
                  <Table.Head>Enqueued</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {events.map((e) => (
                  <Table.Row key={e.task_id}>
                    <Table.Cell>
                      <Link
                        href={taskPath(queue, e.task_id)}
                        variant="plain"
                        className="font-mono text-xs"
                        title={e.task_id}
                        onClick={onClose}
                      >
                        {shortId(e.task_id)}
                      </Link>
                    </Table.Cell>
                    <Table.Cell className="text-sm">
                      <span className="flex flex-wrap gap-x-2">
                        <RelativeTime value={e.enqueued_at} />
                        <span className="text-kumo-subtle">{formatDateTime(e.enqueued_at, settings.timeZone)}</span>
                      </span>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
        <Pagination
          page={page}
          setPage={setPage}
          hasNextPage={(events?.length ?? 0) === PAGE_SIZE}
          controls="simple"
          text={() => `Page ${page}`}
        />
      </Dialog>
    </Dialog.Root>
  );
}

export function SchedulersPage() {
  const { data: entries, error, isLoading, refetch } = useSchedulerEntries();
  const { data: queues } = useQueues();
  const runEntry = useRunSchedulerEntry();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [historyFor, setHistoryFor] = useState<SchedulerEntry | null>(null);
  const [toRun, setToRun] = useState<SchedulerEntry | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = [...(entries ?? [])].sort((a, b) => Date.parse(a.next_enqueue_at) - Date.parse(b.next_enqueue_at));
    if (!term) return list;
    return list.filter(
      (e) =>
        e.task_type.toLowerCase().includes(term) ||
        e.spec.toLowerCase().includes(term) ||
        e.id.toLowerCase().includes(term) ||
        e.options.some((o) => o.toLowerCase().includes(term)),
    );
  }, [entries, search]);

  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, lastPage);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const pausedQueues = new Set((queues ?? []).filter((q) => q.paused).map((q) => q.queue));

  return (
    <Page>
      <PageHeader
        title="Schedulers"
        description="Periodic tasks registered by asynq schedulers, and when they run next."
      />
      {isLoading ? (
        <LoadingState />
      ) : error && !entries ? (
        <ErrorState title="Could not load scheduler entries" error={error} onRetry={() => refetch()} />
      ) : !entries || entries.length === 0 ? (
        <Empty
          icon={<ClockCountdownIcon size={32} />}
          title="No periodic tasks"
          description="Entries show up here while an asynq.Scheduler (or PeriodicTaskManager) is running."
        />
      ) : (
        <LayerCard className="min-w-0 overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-hairline px-3 py-2">
            <span className="px-1 font-medium">{entries.length} entries</span>
            <InputGroup size="sm" className="w-full max-w-xs">
              <InputGroup.Addon>
                <MagnifyingGlassIcon />
              </InputGroup.Addon>
              <InputGroup.Input
                placeholder="Filter by type, spec or option"
                aria-label="Filter scheduler entries"
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </InputGroup>
          </div>
          <div className="overflow-x-auto">
            <Table aria-label="Scheduler entries">
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>Task type</Table.Head>
                  <Table.Head>Schedule</Table.Head>
                  <Table.Head>Payload</Table.Head>
                  <Table.Head>Options</Table.Head>
                  <Table.Head>Next run</Table.Head>
                  <Table.Head>Previous run</Table.Head>
                  <Table.Head sticky="right">
                    <span className="sr-only">Actions</span>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((e) => {
                  const description = describeSpec(e.spec);
                  const queue = entryQueue(e);
                  return (
                    <Table.Row key={e.id}>
                      <Table.Cell>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-medium whitespace-nowrap">{e.task_type}</span>
                          <span className="text-xs text-kumo-subtle">
                            {queue}
                            {pausedQueues.has(queue) && (
                              <Badge variant="warning" className="ml-1.5">
                                queue paused
                              </Badge>
                            )}
                          </span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col">
                          <span className="text-sm">{description ?? e.spec}</span>
                          {description && <code className="font-mono text-xs text-kumo-subtle">{e.spec}</code>}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="block max-w-[240px] truncate font-mono text-xs text-kumo-subtle">
                          {payloadPreview(e.task_payload)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex max-w-[260px] flex-wrap gap-1">
                          {e.options.length === 0 ? (
                            <span className="text-kumo-subtle">—</span>
                          ) : (
                            e.options.map((o) => (
                              <Badge key={o} variant="outline" className="font-mono">
                                {o}
                              </Badge>
                            ))
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <RelativeTime value={e.next_enqueue_at} className="font-medium" />
                      </Table.Cell>
                      <Table.Cell>
                        <RelativeTime value={e.prev_enqueue_at} />
                      </Table.Cell>
                      <Table.Cell sticky="right">
                        <div className="flex justify-end gap-1">
                          <Tooltip
                            content="Enqueue history"
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                shape="square"
                                icon={ClockCounterClockwiseIcon}
                                aria-label="Enqueue history"
                                onClick={() => setHistoryFor(e)}
                              />
                            }
                          />
                          {!READ_ONLY && (
                            <Tooltip
                              content="Run now"
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  shape="square"
                                  icon={PlayIcon}
                                  aria-label="Run now"
                                  onClick={() => setToRun(e)}
                                />
                              }
                            />
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
            {rows.length === 0 && (
              <p className="py-10 text-center text-sm text-kumo-subtle">No entry matches “{search}”.</p>
            )}
          </div>
          {filtered.length > PAGE_SIZE && (
            <div className="border-t border-kumo-hairline px-3 py-2">
              <Pagination page={current} setPage={setPage} perPage={PAGE_SIZE} totalCount={filtered.length} />
            </div>
          )}
        </LayerCard>
      )}
      <HistoryDialog entry={historyFor} onClose={() => setHistoryFor(null)} />
      <ConfirmDialog
        open={!!toRun}
        onOpenChange={(open) => !open && setToRun(null)}
        title={`Run "${toRun?.task_type}" now?`}
        description={`A new task is enqueued right away to "${toRun ? entryQueue(toRun) : ""}" with the entry's payload and options. The regular schedule is not affected.`}
        confirmLabel="Run now"
        loading={runEntry.isPending}
        onConfirm={() => (toRun ? runEntry.mutateAsync(toRun.id) : undefined)}
      />
    </Page>
  );
}
