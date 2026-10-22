import { useState } from "react";
import type { TaskAction } from "../../lib/api";
import { useTaskActions } from "../../lib/queries";
import { ACTION_LABELS, TASK_STATE_META } from "../../lib/task-states";
import { formatNumber, pluralize } from "../../lib/format";
import type { TaskState } from "../../lib/types";
import { ConfirmDialog } from "../ConfirmDialog";

export type ActionScope = "single" | "batch" | "all";

export interface ActionRequest {
  action: TaskAction;
  scope: ActionScope;
  /** Task ids for single and batch actions. */
  ids?: string[];
  /** Number of affected tasks, used in confirmation messages. */
  count: number;
}

/** Actions that run without confirmation when applied to a single task. */
const SAFE_SINGLE_ACTIONS: TaskAction[] = ["run", "archive", "cancel"];

function needsConfirmation(req: ActionRequest): boolean {
  if (req.scope === "single") return !SAFE_SINGLE_ACTIONS.includes(req.action);
  if (req.scope === "batch") return req.action !== "run" && req.action !== "cancel";
  return true;
}

function describe(req: ActionRequest, qname: string, state: TaskState) {
  const stateLabel = TASK_STATE_META[state].label.toLowerCase();
  const target =
    req.scope === "all"
      ? `all ${formatNumber(req.count)} ${stateLabel} tasks in "${qname}"`
      : req.scope === "batch"
        ? pluralize(req.count, `selected task`)
        : "this task";
  const irreversible = req.action === "delete" ? " This cannot be undone." : "";
  switch (req.action) {
    case "delete":
      return { title: `Delete ${target}?`, description: `The tasks will be removed permanently.${irreversible}` };
    case "archive":
      return {
        title: `Archive ${target}?`,
        description:
          "Archived tasks are not processed until you run them again. You can run or delete them from the Archived tab.",
      };
    case "run":
      return {
        title: `Run ${target} now?`,
        description: "The tasks will move to pending and be processed as soon as a worker is available.",
      };
    case "cancel":
      return {
        title: `Cancel ${target}?`,
        description:
          "A cancelation signal is sent to the workers. Handlers that respect context cancelation will stop.",
      };
  }
}

/**
 * Runs task actions, asking for confirmation when the action is destructive or
 * affects many tasks. Render `dialog` once in the component tree.
 */
export function useTaskActionRunner(
  qname: string,
  state: TaskState,
  group?: string,
  onDone?: (req: ActionRequest) => void,
) {
  const { single, batch, all } = useTaskActions(qname, state, group);
  const [pending, setPending] = useState<ActionRequest | null>(null);

  const execute = async (req: ActionRequest) => {
    if (req.scope === "single" && req.ids?.[0]) await single.mutateAsync({ action: req.action, id: req.ids[0] });
    else if (req.scope === "batch" && req.ids) await batch.mutateAsync({ action: req.action, ids: req.ids });
    else if (req.scope === "all") await all.mutateAsync({ action: req.action });
    onDone?.(req);
  };

  const trigger = (req: ActionRequest) => {
    if (needsConfirmation(req)) setPending(req);
    else
      execute(req).catch(() => {
        // Reported by the mutation's toast.
      });
  };

  const text = pending ? describe(pending, qname, state) : null;
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(open) => !open && setPending(null)}
      title={text?.title}
      description={text?.description}
      confirmLabel={pending ? ACTION_LABELS[pending.action].verb + (pending.scope === "all" ? " all" : "") : ""}
      destructive={pending?.action === "delete" || pending?.action === "cancel"}
      // Deleting every task of a state is the riskiest action: require typing the queue name.
      confirmText={pending?.scope === "all" && pending.action === "delete" ? qname : undefined}
      onConfirm={() => (pending ? execute(pending) : undefined)}
    />
  );

  const isPending = single.isPending || batch.isPending || all.isPending;
  return { trigger, dialog, isPending };
}
