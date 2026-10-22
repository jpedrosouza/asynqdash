import { useNavigate, useParams } from "react-router";
import { Breadcrumbs, Button, Empty } from "@cloudflare/kumo";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { ApiError } from "../lib/api";
import { useTask } from "../lib/queries";
import { paths, queuePath } from "../lib/paths";
import { ErrorState, LoadingState, Page } from "../components/common";
import { TaskActionButtons, TaskDetailsBody, TaskHeading } from "../components/tasks/TaskDetails";
import { useTaskActionRunner } from "../components/tasks/useTaskActionRunner";

export function TaskPage() {
  const { qname = "", taskId = "" } = useParams();
  const navigate = useNavigate();
  const { data: task, error, isLoading, refetch } = useTask(qname, taskId);
  const runner = useTaskActionRunner(qname, task?.state ?? "pending", task?.group || undefined, (req) => {
    if (req.action === "delete") navigate(queuePath(qname, task?.state));
  });

  const breadcrumbs = (
    <Breadcrumbs size="sm">
      <Breadcrumbs.Link href={paths.home}>Queues</Breadcrumbs.Link>
      <Breadcrumbs.Separator />
      <Breadcrumbs.Link href={queuePath(qname, task?.state)}>{qname}</Breadcrumbs.Link>
      <Breadcrumbs.Separator />
      <Breadcrumbs.Current>Task</Breadcrumbs.Current>
      <Breadcrumbs.Clipboard text={taskId} />
    </Breadcrumbs>
  );

  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <Page className="max-w-[1200px]">
      {breadcrumbs}
      {isLoading ? (
        <LoadingState label="Loading task…" />
      ) : notFound ? (
        <Empty
          icon={<MagnifyingGlassIcon size={32} />}
          title="Task not found"
          description={`No task with ID "${taskId}" exists in "${qname}". It may have been processed and removed, or deleted.`}
          contents={
            <Button icon={ArrowLeftIcon} onClick={() => navigate(queuePath(qname))}>
              Back to {qname}
            </Button>
          }
        />
      ) : error && !task ? (
        <ErrorState title="Could not load the task" error={error} onRetry={() => refetch()} />
      ) : task ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <TaskHeading task={task} />
            <TaskActionButtons task={task} onAction={runner.trigger} disabled={runner.isPending} size="base" />
          </div>
          <TaskDetailsBody task={task} />
        </>
      ) : null}
      {runner.dialog}
    </Page>
  );
}
