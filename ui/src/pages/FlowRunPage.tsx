import { useParams } from "react-router";
import { Badge, Breadcrumbs, Empty, InlineCopyText, LayerCard, Link, Table } from "@cloudflare/kumo";
import { GitForkIcon } from "@phosphor-icons/react";
import { useFlowRun } from "../lib/queries";
import { ApiError } from "../lib/api";
import { FLOW_NODE_STATE, FLOW_RUN_STATE, flowRunGraph, runDurationMs, runProgress } from "../lib/flows";
import { formatMs, formatNumber, shortId } from "../lib/format";
import { flowPath, paths, taskPath } from "../lib/paths";
import { Card, ErrorState, LoadingState, Page, PageHeader, RelativeTime, Stat } from "../components/common";
import { FlowGraph } from "../components/FlowGraph";

export function FlowRunPage() {
  const { runId = "" } = useParams();
  const { data: run, error, isLoading, refetch } = useFlowRun(runId);

  const breadcrumbs = (
    <Breadcrumbs size="sm">
      <Breadcrumbs.Link href={paths.flows}>Flows</Breadcrumbs.Link>
      <Breadcrumbs.Separator />
      {run?.flow && (
        <>
          <Breadcrumbs.Link href={flowPath(run.flow)}>{run.flow}</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
        </>
      )}
      <Breadcrumbs.Current>Run {shortId(runId)}</Breadcrumbs.Current>
    </Breadcrumbs>
  );

  if (isLoading) {
    return (
      <Page>
        <PageHeader eyebrow={breadcrumbs} title="Flow run" />
        <LoadingState />
      </Page>
    );
  }
  if (!run) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Page>
        <PageHeader eyebrow={breadcrumbs} title="Flow run" />
        {notFound ? (
          <Empty
            icon={<GitForkIcon size={32} />}
            title="Flow run not found"
            description="Runs are kept for 7 days after their last change."
          />
        ) : (
          <ErrorState title="Could not load the flow run" error={error} onRetry={() => refetch()} />
        )}
      </Page>
    );
  }

  const st = FLOW_RUN_STATE[run.state];
  const p = runProgress(run);
  const graph = flowRunGraph(run);
  const processingMs = run.nodes.reduce((s, n) => s + n.duration_ms, 0);

  return (
    <Page>
      <PageHeader
        eyebrow={breadcrumbs}
        title={
          <span className="flex items-center gap-3">
            <span className="truncate">{run.flow ? `${run.flow} run` : "Ad hoc run"}</span>
            <Badge variant={st.badge}>{st.label}</Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            Started by
            <Link href={taskPath(run.root_queue, run.root_id)} className="font-mono text-xs">
              {run.root_type}
            </Link>
            · <RelativeTime value={run.created_at} />
            <InlineCopyText value={run.id} labels={{ copyAction: "Copy run ID", copied: "Run ID copied" }}>
              {run.id}
            </InlineCopyText>
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Tasks" value={formatNumber(p.total)} />
        <Stat label="Completed" value={formatNumber(p.done)} tone={p.done === p.total ? "success" : "default"} />
        <Stat label="In progress" value={formatNumber(p.open)} />
        <Stat label="Failed" value={formatNumber(p.failed)} tone={p.failed > 0 ? "danger" : "default"} />
        <Stat label="Duration" value={formatMs(runDurationMs(run))} hint={`${formatMs(processingMs)} of processing`} />
      </div>
      <Card title="Graph" description="Tasks in the order they ran. Click a task to open it.">
        <FlowGraph nodes={graph.nodes} edges={graph.edges} ariaLabel="Tasks of the flow run" />
      </Card>
      <LayerCard className="min-w-0 overflow-hidden p-0">
        <div className="border-b border-kumo-hairline px-4 py-2 font-medium text-kumo-default">Tasks</div>
        <div className="overflow-x-auto">
          <Table aria-label="Tasks of the flow run">
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>Task</Table.Head>
                <Table.Head>Type</Table.Head>
                <Table.Head>Queue</Table.Head>
                <Table.Head>State</Table.Head>
                <Table.Head>Enqueued</Table.Head>
                <Table.Head>Started</Table.Head>
                <Table.Head className="text-right">Duration</Table.Head>
                <Table.Head className="w-full">Error</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {run.nodes.map((n) => {
                const ns = FLOW_NODE_STATE[n.state] ?? FLOW_NODE_STATE.pending;
                return (
                  <Table.Row key={n.id}>
                    <Table.Cell>
                      <Link href={taskPath(n.queue, n.id)} className="font-mono text-xs whitespace-nowrap" title={n.id}>
                        {shortId(n.id)}
                      </Link>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs whitespace-nowrap">{n.type}</Table.Cell>
                    <Table.Cell className="text-xs">{n.queue}</Table.Cell>
                    <Table.Cell>
                      <Badge variant={ns.badge}>{ns.label}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <RelativeTime value={n.enqueued_at} />
                    </Table.Cell>
                    <Table.Cell>
                      <RelativeTime value={n.started_at} />
                    </Table.Cell>
                    <Table.Cell className="tabular text-right">
                      {n.started_at ? formatMs(n.duration_ms) : "—"}
                    </Table.Cell>
                    <Table.Cell>
                      {n.error ? (
                        <span
                          className="block max-w-[420px] truncate font-mono text-xs text-kumo-danger"
                          title={n.error}
                        >
                          {n.error}
                        </span>
                      ) : (
                        <span className="text-kumo-subtle">—</span>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>
    </Page>
  );
}
