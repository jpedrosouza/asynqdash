import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Dialog, Input, Select } from "@cloudflare/kumo";
import type { RateLimitInput } from "../lib/api";
import { formatMs, formatNumber } from "../lib/format";
import type { Queue, QueueMetadata, RateLimitInfo } from "../lib/types";

/** Dialog frame shared by the forms below: title, description, fields and footer buttons. */
function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onSubmit: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="base" className="flex flex-col gap-4 p-6">
        <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
        {description && <Dialog.Description className="text-sm text-kumo-subtle">{description}</Dialog.Description>}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <div className="mt-2 flex flex-wrap justify-end gap-2">{footer}</div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}

/** Edits the category, subcategory and description of a queue. */
export function QueueDetailsDialog({
  open,
  onOpenChange,
  queue,
  queues,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue: Queue;
  /** All queues, to suggest the existing categories. */
  queues: Queue[];
  saving: boolean;
  onSave: (md: QueueMetadata) => Promise<unknown>;
}) {
  const [md, setMd] = useState<QueueMetadata>({ category: "", subcategory: "", description: "" });
  useEffect(() => {
    if (open) {
      setMd({
        category: queue.category ?? "",
        subcategory: queue.subcategory ?? "",
        description: queue.description ?? "",
      });
    }
  }, [open, queue]);

  const categories = useMemo(
    () => [...new Set(queues.map((q) => q.category).filter((c): c is string => !!c))].sort(),
    [queues],
  );
  const subcategories = useMemo(
    () =>
      [
        ...new Set(
          queues
            .filter((q) => q.category === md.category.trim())
            .map((q) => q.subcategory)
            .filter((c): c is string => !!c),
        ),
      ].sort(),
    [queues, md.category],
  );

  const save = async () => {
    try {
      await onSave({
        category: md.category.trim(),
        subcategory: md.category.trim() ? md.subcategory.trim() : "",
        description: md.description.trim(),
      });
      onOpenChange(false);
    } catch {
      // Reported by the mutation; keep the dialog open.
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={`Details of "${queue.queue}"`}
      description="Categories group related queues on the dashboard, e.g. all report queues together. They do not change how tasks are processed."
      onSubmit={save}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <Input
        label="Category"
        placeholder="e.g. Reports"
        value={md.category}
        list="queue-categories"
        onChange={(e) => setMd({ ...md, category: e.target.value })}
        autoFocus
      />
      <datalist id="queue-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Input
        label="Subcategory"
        description="Optional, divides a category."
        placeholder="e.g. Daily"
        value={md.subcategory}
        list="queue-subcategories"
        disabled={!md.category.trim()}
        onChange={(e) => setMd({ ...md, subcategory: e.target.value })}
      />
      <datalist id="queue-subcategories">
        {subcategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Input
        label="Description"
        placeholder="What the tasks of this queue do"
        value={md.description}
        onChange={(e) => setMd({ ...md, description: e.target.value })}
      />
    </FormDialog>
  );
}

const PERIODS = [
  { value: 1000, label: "second" },
  { value: 60_000, label: "minute" },
  { value: 3_600_000, label: "hour" },
  { value: 86_400_000, label: "day" },
];

/** Sets or removes a rate limit (of a queue, or of a key when keyEditable is set). */
export function RateLimitDialog({
  open,
  onOpenChange,
  title,
  description,
  current,
  keyEditable = false,
  saving,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  current?: (RateLimitInfo & { key?: string }) | null;
  /** Shows a field for the rate limit key (new key level rate limit). */
  keyEditable?: boolean;
  saving: boolean;
  onSave: (rl: RateLimitInput, key: string) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
}) {
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState("");
  const [period, setPeriod] = useState(60_000);
  const [burst, setBurst] = useState("");

  useEffect(() => {
    if (!open) return;
    setKey(current?.key ?? "");
    if (current) {
      const p = PERIODS.find((x) => x.value === current.period_ms);
      // A period that is not a whole unit is converted to a limit per minute.
      setPeriod(p ? p.value : 60_000);
      setLimit(String(p ? current.limit : Math.max(1, Math.round((current.limit * 60_000) / current.period_ms))));
      setBurst(current.burst > 1 ? String(current.burst) : "");
    } else {
      setLimit("");
      setPeriod(60_000);
      setBurst("");
    }
  }, [open, current]);

  const limitNum = parseInt(limit, 10);
  const burstNum = burst.trim() === "" ? 1 : parseInt(burst, 10);
  const keyValid = !keyEditable || key.trim() !== "";
  const valid = keyValid && Number.isFinite(limitNum) && limitNum >= 1 && Number.isFinite(burstNum) && burstNum >= 1;
  const interval = valid ? period / limitNum : 0;

  const save = async () => {
    if (!valid) return;
    try {
      await onSave({ limit: limitNum, period_ms: period, burst: burstNum }, key.trim());
      onOpenChange(false);
    } catch {
      // Reported by the mutation; keep the dialog open.
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={title}
      description={description}
      onSubmit={save}
      footer={
        <>
          {onRemove && current && (
            <Button
              variant="secondary-destructive"
              className="mr-auto"
              disabled={saving}
              onClick={async () => {
                try {
                  await onRemove();
                  onOpenChange(false);
                } catch {
                  // Reported by the mutation.
                }
              }}
            >
              Remove limit
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={saving} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      {keyEditable && (
        <Input
          label="Key"
          description="Tasks enqueued with asynq.RateLimitKey(key) share this limit, whatever their queue."
          placeholder="e.g. openai or tenant:42"
          value={key}
          disabled={!!current?.key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus={!current?.key}
        />
      )}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Input
          label="Tasks"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="200"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          autoFocus={!keyEditable || !!current?.key}
        />
        <Select
          aria-label="Period"
          value={period}
          onValueChange={(v) => setPeriod(Number(v))}
          renderValue={(v: unknown) => `per ${PERIODS.find((p) => p.value === v)?.label ?? ""}`}
          className="min-w-32"
        >
          {PERIODS.map((p) => (
            <Select.Option key={p.value} value={p.value}>
              per {p.label}
            </Select.Option>
          ))}
        </Select>
      </div>
      <Input
        label="Burst"
        description="Tasks that may start back to back after a pause. Leave empty to spread tasks evenly."
        type="number"
        min={1}
        inputMode="numeric"
        placeholder="1"
        value={burst}
        onChange={(e) => setBurst(e.target.value)}
      />
      {valid && (
        <p className="rounded-lg bg-kumo-recessed px-3 py-2 text-sm text-kumo-subtle">
          At most one task every <strong className="text-kumo-default">{formatMs(interval)}</strong>
          {burstNum > 1 && <>, or {formatNumber(burstNum)} at once after a pause</>}. Tasks wait in the pending state;
          waiting does not count as a retry.
        </p>
      )}
    </FormDialog>
  );
}
