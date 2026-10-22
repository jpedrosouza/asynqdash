import { useMemo, useState } from "react";
import { Badge, Banner, Collapsible, InputGroup, LayerCard, Meter, Table } from "@cloudflare/kumo";
import { InfoIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useRedisInfo } from "../lib/queries";
import { formatBytes, formatDuration, formatNumber, formatPercent, ratio } from "../lib/format";
import { Card, ErrorState, LoadingState, Page, PageHeader, Stat } from "../components/common";
import { JsonView } from "../components/JsonView";

interface InfoSection {
  name: string;
  entries: [string, string][];
}

/** Parses the output of the Redis INFO command into sections. */
function parseRawInfo(raw: string): InfoSection[] {
  const sections: InfoSection[] = [];
  let current: InfoSection | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      current = { name: trimmed.replace(/^#\s*/, ""), entries: [] };
      sections.push(current);
      continue;
    }
    const idx = trimmed.indexOf(":");
    if (idx < 0) continue;
    if (!current) {
      current = { name: "Info", entries: [] };
      sections.push(current);
    }
    current.entries.push([trimmed.slice(0, idx), trimmed.slice(idx + 1)]);
  }
  return sections;
}

const num = (v: string | undefined) => (v ? Number(v) : NaN);

export function RedisPage() {
  const { data, error, isLoading, refetch } = useRedisInfo();
  const [filter, setFilter] = useState("");
  const sections = useMemo(() => parseRawInfo(data?.raw_info ?? ""), [data?.raw_info]);
  const term = filter.trim().toLowerCase();
  const filteredSections = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          entries: term
            ? s.entries.filter(([k, v]) => k.toLowerCase().includes(term) || v.toLowerCase().includes(term))
            : s.entries,
        }))
        .filter((s) => s.entries.length > 0),
    [sections, term],
  );

  const info = data?.info ?? {};
  const used = num(info.used_memory);
  const maxMemory = num(info.maxmemory);
  const hits = num(info.keyspace_hits);
  const misses = num(info.keyspace_misses);
  const hitRate = ratio(hits, hits + misses);
  const evictionPolicyRisky = info.maxmemory_policy && info.maxmemory_policy !== "noeviction";

  return (
    <Page>
      <PageHeader
        title="Redis"
        description={
          data && (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{data.address}</span>
              {data.cluster && <Badge variant="info">Cluster</Badge>}
              {info.redis_version && <Badge variant="secondary">v{info.redis_version}</Badge>}
            </span>
          )
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState title="Could not load Redis info" error={error} onRetry={() => refetch()} />
      ) : data ? (
        <>
          {evictionPolicyRisky && (
            <Banner
              variant="alert"
              icon={<InfoIcon weight="fill" />}
              title={`Eviction policy is "${info.maxmemory_policy}"`}
              description='Redis may evict asynq keys when memory is full, which can lose tasks. Asynq recommends "noeviction".'
            />
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Uptime" value={info.uptime_in_seconds ? formatDuration(num(info.uptime_in_seconds)) : "—"} />
            <Stat
              label="Clients"
              value={info.connected_clients ? formatNumber(num(info.connected_clients)) : "—"}
              hint={info.blocked_clients ? `${info.blocked_clients} blocked` : undefined}
            />
            <Stat
              label="Ops / sec"
              value={info.instantaneous_ops_per_sec ? formatNumber(num(info.instantaneous_ops_per_sec)) : "—"}
            />
            <Stat label="Hit rate" value={hits + misses > 0 ? formatPercent(hitRate) : "—"} />
            <Stat label="Peak memory" value={info.used_memory_peak_human ?? "—"} />
            <Stat
              label="Fragmentation"
              value={info.mem_fragmentation_ratio ?? "—"}
              tone={num(info.mem_fragmentation_ratio) > 1.5 ? "warning" : "default"}
              hint="RSS / used memory"
            />
          </div>
          {Number.isFinite(used) && (
            <Card title="Memory">
              {maxMemory > 0 ? (
                <Meter
                  label="Used memory"
                  value={used}
                  max={maxMemory}
                  customValue={`${formatBytes(used)} / ${formatBytes(maxMemory)}`}
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-2xl font-semibold tabular">{formatBytes(used)}</span>
                  <span className="text-sm text-kumo-subtle">
                    No maxmemory limit configured
                    {info.total_system_memory_human ? ` (system: ${info.total_system_memory_human})` : ""}.
                  </span>
                </div>
              )}
            </Card>
          )}

          {data.cluster && data.queue_locations && data.queue_locations.length > 0 && (
            <Card title="Queue locations" description="Cluster nodes that store each queue." bodyClassName="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header variant="compact">
                    <Table.Row>
                      <Table.Head>Queue</Table.Head>
                      <Table.Head>Key slot</Table.Head>
                      <Table.Head>Nodes</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.queue_locations.map((l) => (
                      <Table.Row key={l.queue}>
                        <Table.Cell className="font-medium">{l.queue}</Table.Cell>
                        <Table.Cell className="tabular">{l.keyslot}</Table.Cell>
                        <Table.Cell className="font-mono text-xs">{l.nodes.join(", ")}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            </Card>
          )}

          <LayerCard className="min-w-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-hairline px-3 py-2">
              <span className="px-1 font-medium">INFO</span>
              <InputGroup size="sm" className="w-full max-w-xs">
                <InputGroup.Addon>
                  <MagnifyingGlassIcon />
                </InputGroup.Addon>
                <InputGroup.Input
                  placeholder="Filter keys or values"
                  aria-label="Filter Redis info"
                  value={filter}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
                />
              </InputGroup>
            </div>
            <div className="flex flex-col divide-y divide-kumo-hairline">
              {filteredSections.map((s) => (
                <Collapsible.Root
                  // Remount when filtering so matching sections open.
                  key={`${s.name}-${term ? "filtered" : "all"}`}
                  defaultOpen={!!term || s.name === "Server" || s.name === "Memory"}
                  className="px-4 py-2"
                >
                  <Collapsible.DefaultTrigger>
                    {s.name} <span className="text-kumo-subtle">({s.entries.length})</span>
                  </Collapsible.DefaultTrigger>
                  <Collapsible.DefaultPanel>
                    <dl className="grid grid-cols-1 gap-x-8 gap-y-1 py-2 md:grid-cols-2">
                      {s.entries.map(([k, v]) => (
                        <div
                          key={k}
                          className="flex min-w-0 justify-between gap-4 border-b border-kumo-hairline/60 py-1 text-sm"
                        >
                          <dt className="truncate font-mono text-xs text-kumo-subtle">{k}</dt>
                          <dd className="truncate text-right font-mono text-xs text-kumo-default" title={v}>
                            {v}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Collapsible.DefaultPanel>
                </Collapsible.Root>
              ))}
              {filteredSections.length === 0 && (
                <p className="py-10 text-center text-sm text-kumo-subtle">No entry matches “{filter}”.</p>
              )}
            </div>
          </LayerCard>

          {data.cluster && data.raw_cluster_nodes && (
            <Card title="CLUSTER NODES">
              <JsonView value={data.raw_cluster_nodes} filename="cluster-nodes" />
            </Card>
          )}
        </>
      ) : null}
    </Page>
  );
}
