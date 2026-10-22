import { Button, Dialog, LinkButton } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { useTask } from "../../lib/queries";
import { taskPath } from "../../lib/paths";
import type { TaskState } from "../../lib/types";
import { ErrorState, LoadingState } from "../common";
import { TaskActionButtons, TaskDetailsBody, TaskHeading } from "./TaskDetails";
import { useTaskActionRunner } from "./useTaskActionRunner";

interface TaskPreviewDialogProps {
  qname: string;
  taskId: string | null;
  /** State of the list the task was opened from, used until the task is loaded. */
  state: TaskState;
  group?: string;
  onClose: () => void;
}

/** Quick view of a task without leaving the task list. */
export function TaskPreviewDialog({ qname, taskId, state, group, onClose }: TaskPreviewDialogProps) {
  return (
    <Dialog.Root open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <Dialog
        size="xl"
        className="flex max-h-[90dvh] w-[min(960px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden p-0"
      >
        {taskId && <PreviewContent qname={qname} taskId={taskId} state={state} group={group} onClose={onClose} />}
      </Dialog>
    </Dialog.Root>
  );
}

function PreviewContent({
  qname,
  taskId,
  state,
  group,
  onClose,
}: Omit<TaskPreviewDialogProps, "taskId"> & { taskId: string }) {
  const { data: task, error, isLoading, refetch } = useTask(qname, taskId);
  const runner = useTaskActionRunner(qname, task?.state ?? state, task?.group || group, (req) => {
    // The task leaves its current state (or is deleted): close the preview.
    if (req.action !== "cancel") onClose();
  });

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-kumo-hairline px-6 py-4">
        <Dialog.Title className="min-w-0">
          {task ? <TaskHeading task={task} /> : <span className="text-lg font-semibold">Task</span>}
        </Dialog.Title>
        <div className="flex shrink-0 items-center gap-1">
          <LinkButton href={taskPath(qname, taskId)} variant="ghost" size="sm" icon={ArrowSquareOutIcon}>
            Open page
          </LinkButton>
          <Button variant="ghost" size="sm" shape="square" icon={XIcon} aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <LoadingState label="Loading task…" />
        ) : error ? (
          <ErrorState title="Could not load the task" error={error} onRetry={() => refetch()} />
        ) : task ? (
          <div className="flex flex-col gap-4">
            <TaskActionButtons task={task} onAction={runner.trigger} disabled={runner.isPending} />
            <TaskDetailsBody task={task} />
          </div>
        ) : null}
      </div>
      {runner.dialog}
    </>
  );
}
