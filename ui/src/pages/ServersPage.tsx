import { useMemo, useState } from "react";
import { Badge, Button, Empty, LayerCard, Link, Meter, Table, Tooltip } from "@cloudflare/kumo";
import { CaretDownIcon, CaretRightIcon, HardDrivesIcon, LightningIcon } from "@phosphor-icons/react";
import { useServers } from "../lib/queries";
import { formatNumber, formatPercent, payloadPreview, ratio, shortId } from "../lib/format";
import { queuePath, taskPath } from "../lib/paths";
import type { ServerInfo } from "../lib/types";
import { ErrorState, LoadingState, Page, PageHeader, RelativeTime, Stat } from "../components/common";

function ServerCard({ server }: { server: ServerInfo }) {
  const [open, setOpen] = useState(false);
  const busy = server.active_workers.length;
  const queues = Object.entries(server.queue_priorities).sort((a, b) => b[1] - a[1]);
  const utilization = ratio(busy, server.concurrency);

  return (
    <LayerCard className="min-w-0 p-0">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-mono text-sm font-medium text-kumo-default">
              {server.host}:{server.pid}
            </span>
            <span className="text-xs text-kumo-subtle">
              Started <RelativeTime value={server.start_time} />
            </span>
          </div>
          <Badge variant={server.status === "active" ? "success" : "warning"} appearance="dot">
            {server.status}
          </Badge>
        </div>

        <Meter
          label="Workers busy"
          value={busy}
          max={Math.max(server.concurrency, 1)}
          customValue={`${formatNumber(busy)} / ${formatNumber(server.concurrency)}`}
          indicatorClassName={utilization >= 1 ? "from-kumo-warning via-kumo-warning to-kumo-warning" : undefined}
        />

        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-xs text-kumo-subtle">
            Queue priorities
            {server.strict_priority_enabled && (
              <Tooltip content="Higher priority queues are always emptied before lower priority ones.">
                <Badge variant="outline" icon={<LightningIcon />}>
                  Strict
                </Badge>
              </Tooltip>
            )}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {queues.map(([qname, priority]) => (
              <Link key={qname} href={queuePath(qname)} variant="plain">
                <Badge variant="secondary">
                  {qname}
                  <span className="ml-1 text-kumo-subtle">×{priority}</span>
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-kumo-hairline">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start rounded-none rounded-b-xl"
          icon={open ? CaretDownIcon : CaretRightIcon}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={busy === 0}
        >
          {busy === 0 ? "No active workers" : `${formatNumber(busy)} active ${busy === 1 ? "worker" : "workers"}`}
        </Button>
        {open && busy > 0 && (
          <div className="overflow-x-auto border-t border-kumo-hairline animate-fade-in-up">
            <Table>
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>Task</Table.Head>
                  <Table.Head>Type</Table.Head>
                  <Table.Head>Queue</Table.Head>
                  <Table.Head>Payload</Table.Head>
                  <Table.Head>Started</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {server.active_workers.map((w) => (
                  <Table.Row key={w.task_id}>
                    <Table.Cell>
                      <Link
                        href={taskPath(w.queue, w.task_id)}
                        variant="plain"
                        className="font-mono text-xs"
                        title={w.task_id}
                      >
                        {shortId(w.task_id)}
                      </Link>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs whitespace-nowrap">{w.task_type}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap">{w.queue}</Table.Cell>
                    <Table.Cell>
                      <span className="block max-w-[260px] truncate font-mono text-xs text-kumo-subtle">
                        {payloadPreview(w.task_payload)}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <RelativeTime value={w.start_time} />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </div>
    </LayerCard>
  );
}

export function ServersPage() {
  const { data: servers, error, isLoading, refetch } = useServers();
  const sorted = useMemo(
    () => [...(servers ?? [])].sort((a, b) => a.host.localeCompare(b.host) || a.pid - b.pid),
    [servers],
  );
  const concurrency = sorted.reduce((s, x) => s + x.concurrency, 0);
  const busy = sorted.reduce((s, x) => s + x.active_workers.length, 0);

  return (
    <Page>
      <PageHeader
        title="Servers"
        description="Worker servers connected to this Redis instance and what they are processing."
      />
      {isLoading ? (
        <LoadingState />
      ) : error && !servers ? (
        <ErrorState title="Could not load servers" error={error} onRetry={() => refetch()} />
      ) : sorted.length === 0 ? (
        <Empty
          icon={<HardDrivesIcon size={32} />}
          title="No servers running"
          description="Servers show up here while an asynq.Server is running and sending heartbeats."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Servers" value={formatNumber(sorted.length)} />
            <Stat label="Concurrency" value={formatNumber(concurrency)} hint="Total worker slots" />
            <Stat label="Busy workers" value={formatNumber(busy)} />
            <Stat
              label="Utilization"
              value={formatPercent(ratio(busy, concurrency))}
              tone={ratio(busy, concurrency) >= 0.9 ? "warning" : "default"}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sorted.map((s) => (
              <ServerCard key={s.id} server={s} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
