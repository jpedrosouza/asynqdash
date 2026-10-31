import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Badge, Button, Empty, LayerCard, Link, Select, Table, Tooltip } from "@cloudflare/kumo";
import { CaretLeftIcon, CaretRightIcon, GitForkIcon, TrashIcon } from "@phosphor-icons/react";
import { READ_ONLY } from "../lib/flags";
import { useDeleteFlow, useFlowRuns, useFlows } from "../lib/queries";
import { FLOW_RUN_STATE, flowDefinitionGraph, runDurationMs, runProgress } from "../lib/flows";
import { formatMs, formatNumber, parseTime, shortId } from "../lib/format";
import { flowRunPath } from "../lib/paths";
import { useNow } from "../lib/hooks";
import type { FlowInfo } from "../lib/types";
import { Card, ErrorState, LoadingState, Page, PageHeader, RelativeTime, SkeletonRows } from "../components/common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FlowGraph } from "../components/FlowGraph";

const ALL_FLOWS = "__all__";
const RUNS_PAGE_SIZE = 20;

/** A flow not published for this long is probably no longer run by any server. */
const STALE_AFTER_MS = 5 * 60_000;

function FlowDefinitionCard({ flow, onDelete }: { flow: FlowInfo; onDelete: () => void }) {
  const now = useNow(30_000);
  const graph = flowDefinitionGraph(flow);
  const updated = parseTime(flow.updated_at);
  const stale = updated ? now - updated.getTime() > STALE_AFTER_MS : true;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <GitForkIcon className="text-kumo-subtle" />
          {flow.name}
          {stale && (
            <Tooltip content="No server published this flow in the last 5 minutes: it may have been removed from the code.">
              <Badge variant="warning">Not published recently</Badge>
            </Tooltip>
          )}
        </span>
      }
      description={
        <>
          {formatNumber(flow.steps.length)} steps · published <RelativeTime value={flow.updated_at} />
        </>
      }
      actions={
        <>
          <Link href={`?flow=${encodeURIComponent(flow.name)}`}>Runs</Link>
          {!READ_ONLY && stale && (
            <Button size="sm" variant="ghost" icon={TrashIcon} onClick={onDelete}>
              Remove
            </Button>
          )}
        </>
      }
    >
      <FlowGraph nodes={graph.nodes} edges={graph.edges} ariaLabel={`Steps of the flow ${flow.name}`} />
      <p className="mt-3 text-xs text-kumo-subtle">
        An arrow means that when a task of the first type completes, the server enqueues tasks of the second type.
        Dashed arrows wait for all the joined tasks of the run.
      </p>
    </Card>
  );
}

function FlowRunsCard({
  flow,
  onFlowChange,
  flows,
}: {
  flow: string;
  onFlowChange: (f: string) => void;
  flows: string[];
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, error, isLoading, isPlaceholderData, refetch } = useFlowRuns(flow, page, RUNS_PAGE_SIZE);
  const runs = data ?? [];
  return (
    <LayerCard className="min-w-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-hairline px-3 py-2">
        <span className="px-1 font-medium text-kumo-default">Recent runs</span>
        <Select
          aria-label="Flow"
          size="sm"
          value={flow || ALL_FLOWS}
          onValueChange={(v) => {
            setPage(1);
            onFlowChange(v === ALL_FLOWS ? "" : String(v));
          }}
          className="min-w-48"
          renderValue={(v: unknown) => (v === ALL_FLOWS ? "All flows" : String(v))}
        >
          <Select.Option value={ALL_FLOWS}>All flows</Select.Option>
          {flows.map((f) => (
            <Select.Option key={f} value={f}>
              {f}
            </Select.Option>
          ))}
        </Select>
      </div>
      {error && !data ? (
        <ErrorState title="Could not load the flow runs" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows />
      ) : runs.length === 0 && page === 1 ? (
        <Empty
          size="sm"
          icon={<GitForkIcon size={28} />}
          title="No flow run yet"
          description="A run starts when a task with flow steps completes, or when a handler calls asynq.EnqueueChild. Runs are kept for 7 days."
        />
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <div className="overflow-x-auto">
            <Table aria-label="Flow runs">
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>Run</Table.Head>
                  <Table.Head>Flow</Table.Head>
                  <Table.Head>First task</Table.Head>
                  <Table.Head>State</Table.Head>
                  <Table.Head className="text-right">Tasks</Table.Head>
                  <Table.Head>Started</Table.Head>
                  <Table.Head className="text-right">Duration</Table.Head>
                  <Table.Head>Updated</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {runs.map((run) => {
                  const p = runProgress(run);
                  const st = FLOW_RUN_STATE[run.state];
                  return (
                    <Table.Row key={run.id} className="cursor-pointer" onClick={() => navigate(flowRunPath(run.id))}>
                      <Table.Cell>
                        <Link
                          href={flowRunPath(run.id)}
                          className="font-mono text-xs"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          title={run.id}
                        >
                          {shortId(run.id)}
                        </Link>
                      </Table.Cell>
                      <Table.Cell>{run.flow || <span className="text-kumo-subtle">ad hoc</span>}</Table.Cell>
                      <Table.Cell className="font-mono text-xs whitespace-nowrap">{run.root_type}</Table.Cell>
                      <Table.Cell>
                        <Badge variant={st.badge}>{st.label}</Badge>
                      </Table.Cell>
                      <Table.Cell className="tabular text-right whitespace-nowrap">
                        {formatNumber(p.done)}/{formatNumber(p.total)}
                        {p.failed > 0 && (
                          <span className="ml-1 text-kumo-danger">({formatNumber(p.failed)} failed)</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <RelativeTime value={run.created_at} />
                      </Table.Cell>
                      <Table.Cell className="tabular text-right">{formatMs(runDurationMs(run))}</Table.Cell>
                      <Table.Cell>
                        <RelativeTime value={run.updated_at} />
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-kumo-hairline px-3 py-2">
            <span className="mr-auto text-xs text-kumo-subtle">Page {page}</span>
            <Button
              size="sm"
              variant="secondary"
              icon={CaretLeftIcon}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Newer
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={runs.length < RUNS_PAGE_SIZE}
              onClick={() => setPage(page + 1)}
            >
              Older
              <CaretRightIcon />
            </Button>
          </div>
        </div>
      )}
    </LayerCard>
  );
}

export function FlowsPage() {
  const [params, setParams] = useSearchParams();
  const flow = params.get("flow") ?? "";
  const { data: flows, error, isLoading, refetch } = useFlows();
  const remove = useDeleteFlow();
  const [toDelete, setToDelete] = useState<string | null>(null);
  const setFlow = (f: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (f) next.set("flow", f);
        else next.delete("flow");
        return next;
      },
      { replace: true },
    );
  const shown = (flows ?? []).filter((f) => !flow || f.name === flow);

  return (
    <Page>
      <PageHeader
        title="Flows"
        description="Tasks chained by the servers: when a task completes, the next tasks of its flow are enqueued with its result."
      />
      {error && !flows ? (
        <ErrorState title="Could not load the flows" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState />
      ) : (flows ?? []).length === 0 ? (
        <Empty
          icon={<GitForkIcon size={32} />}
          title="No flow published"
          description="Servers publish the flows passed in asynq.Config.Flows when they start (asynq v0.28 or later)."
          commandLine={'asynq.NewFlow("images").Then("image:upload", "image:resize", nil)'}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((f) => (
            <FlowDefinitionCard key={f.name} flow={f} onDelete={() => setToDelete(f.name)} />
          ))}
        </div>
      )}
      <FlowRunsCard flow={flow} onFlowChange={setFlow} flows={(flows ?? []).map((f) => f.name)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Remove the flow "${toDelete}"?`}
        description="Its definition is removed from Redis. A server that still runs the flow publishes it again within a minute. Its runs are kept."
        confirmLabel="Remove flow"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutateAsync(toDelete!)}
      />
    </Page>
  );
}
