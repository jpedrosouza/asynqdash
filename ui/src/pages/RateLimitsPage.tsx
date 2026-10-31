import { useState } from "react";
import { Badge, Button, Empty, LayerCard, Link, Table } from "@cloudflare/kumo";
import { GaugeIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { READ_ONLY } from "../lib/flags";
import { useKeyRateLimitActions, useQueueSettings, useQueues, useRateLimits } from "../lib/queries";
import { formatNumber, formatRateLimit, formatRelative, parseTime } from "../lib/format";
import { queuePath } from "../lib/paths";
import { useNow } from "../lib/hooks";
import type { KeyRateLimit, Queue, RateLimitInfo } from "../lib/types";
import { ErrorState, Page, PageHeader, SkeletonRows } from "../components/common";
import { RateLimitDialog } from "../components/QueueDialogs";

/** Capacity of a rate limit right now: tasks that may start, or when the next one may. */
function Capacity({ rl, now }: { rl: RateLimitInfo; now: number }) {
  const next = parseTime(rl.next_at);
  if (rl.available > 0 || (next && next.getTime() <= now)) {
    return (
      <span className="tabular">
        {formatNumber(Math.max(rl.available, 1))} of {formatNumber(rl.burst)} available
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Badge variant="warning">Exhausted</Badge>
      {next && <span className="text-xs text-kumo-subtle">next task {formatRelative(next, now)}</span>}
    </span>
  );
}

function QueueRateLimitRow({ queue, now }: { queue: Queue; now: number }) {
  const [open, setOpen] = useState(false);
  const actions = useQueueSettings(queue.queue);
  const rl = queue.rate_limit!;
  return (
    <Table.Row>
      <Table.Cell>
        <Link href={queuePath(queue.queue)} className="font-medium">
          {queue.queue}
        </Link>
      </Table.Cell>
      <Table.Cell>{formatRateLimit(rl)}</Table.Cell>
      <Table.Cell>
        <Capacity rl={rl} now={now} />
      </Table.Cell>
      <Table.Cell className="tabular text-right">{formatNumber(queue.pending)}</Table.Cell>
      {!READ_ONLY && (
        <Table.Cell className="text-right">
          <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={() => setOpen(true)}>
            Edit
          </Button>
          <RateLimitDialog
            open={open}
            onOpenChange={setOpen}
            title={`Rate limit of "${queue.queue}"`}
            description="All the servers together start at most this many tasks of the queue."
            current={rl}
            saving={actions.setRateLimit.isPending || actions.removeRateLimit.isPending}
            onSave={(input) => actions.setRateLimit.mutateAsync(input)}
            onRemove={() => actions.removeRateLimit.mutateAsync()}
          />
        </Table.Cell>
      )}
    </Table.Row>
  );
}

export function RateLimitsPage() {
  const now = useNow(1000);
  const { data: limits, error, isLoading, refetch } = useRateLimits();
  const { data: queues } = useQueues();
  const { set, remove } = useKeyRateLimitActions();
  const [editing, setEditing] = useState<KeyRateLimit | null | "new">(null);
  const limitedQueues = (queues ?? []).filter((q) => q.rate_limit).sort((a, b) => a.queue.localeCompare(b.queue));
  const current = editing && editing !== "new" ? editing : null;

  return (
    <Page>
      <PageHeader
        title="Rate limits"
        description="How many tasks the servers may start per period. Tasks wait for the rate limit without counting as a retry."
        actions={
          !READ_ONLY && (
            <Button variant="primary" icon={PlusIcon} onClick={() => setEditing("new")}>
              Add key rate limit
            </Button>
          )
        }
      />

      <LayerCard className="min-w-0 overflow-hidden p-0">
        <div className="flex flex-col border-b border-kumo-hairline px-4 py-2">
          <span className="font-medium text-kumo-default">Keys</span>
          <span className="text-xs text-kumo-subtle">
            Shared by the tasks enqueued with <code className="font-mono">asynq.RateLimitKey(key)</code>, whatever their
            queue: e.g. the limit of a third party API, or of a tenant. A task over the limit reserves the next free
            slot and waits for it (in the scheduled state when it is more than a few seconds away).
          </span>
        </div>
        {error && !limits ? (
          <ErrorState title="Could not load the rate limits" error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={3} />
        ) : (limits ?? []).length === 0 ? (
          <Empty
            size="sm"
            icon={<GaugeIcon size={28} />}
            title="No key rate limit"
            description="Tasks enqueued with a key that has no rate limit are not limited."
            commandLine={'client.Enqueue(task, asynq.RateLimitKey("openai"))'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Key rate limits">
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>Key</Table.Head>
                  <Table.Head>Limit</Table.Head>
                  <Table.Head>Capacity</Table.Head>
                  {!READ_ONLY && (
                    <Table.Head>
                      <span className="sr-only">Actions</span>
                    </Table.Head>
                  )}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(limits ?? []).map((rl) => (
                  <Table.Row key={rl.key}>
                    <Table.Cell className="font-mono text-xs font-medium">{rl.key}</Table.Cell>
                    <Table.Cell>{formatRateLimit(rl)}</Table.Cell>
                    <Table.Cell>
                      <Capacity rl={rl} now={now} />
                    </Table.Cell>
                    {!READ_ONLY && (
                      <Table.Cell className="text-right">
                        <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={() => setEditing(rl)}>
                          Edit
                        </Button>
                      </Table.Cell>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </LayerCard>

      <LayerCard className="min-w-0 overflow-hidden p-0">
        <div className="flex flex-col border-b border-kumo-hairline px-4 py-2">
          <span className="font-medium text-kumo-default">Queues</span>
          <span className="text-xs text-kumo-subtle">
            Tasks of a rate limited queue stay pending until the limit allows them. Set a queue rate limit from the
            queue page.
          </span>
        </div>
        {limitedQueues.length === 0 ? (
          <p className="px-4 py-6 text-sm text-kumo-subtle">No queue has a rate limit.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Queue rate limits">
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>Queue</Table.Head>
                  <Table.Head>Limit</Table.Head>
                  <Table.Head>Capacity</Table.Head>
                  <Table.Head className="text-right">Pending</Table.Head>
                  {!READ_ONLY && (
                    <Table.Head>
                      <span className="sr-only">Actions</span>
                    </Table.Head>
                  )}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {limitedQueues.map((q) => (
                  <QueueRateLimitRow key={q.queue} queue={q} now={now} />
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </LayerCard>

      <RateLimitDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={current ? `Rate limit "${current.key}"` : "New key rate limit"}
        description="All the servers together start at most this many tasks with this key. It applies right away to servers running asynq v0.28 or later."
        current={current}
        keyEditable
        saving={set.isPending || remove.isPending}
        onSave={(rl, key) => set.mutateAsync({ key, rl })}
        onRemove={current ? () => remove.mutateAsync(current.key) : undefined}
      />
    </Page>
  );
}
