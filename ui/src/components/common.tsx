import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, LayerCard, Loader, Text, Tooltip, cn } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { formatDateTime, formatRelative, parseTime } from "../lib/format";
import { useSettings } from "../lib/settings";
import { useNow } from "../lib/hooks";

/* ------------------------------- Layout ------------------------------- */

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8", className)}>
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Content rendered above the title, e.g. breadcrumbs. */
  eyebrow?: ReactNode;
}

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      {eyebrow}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold text-kumo-default md:text-2xl">{title}</h1>
          {description && <div className="text-sm text-kumo-subtle">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Content card with an optional header row. */
export function Card({ title, description, actions, children, className, bodyClassName }: CardProps) {
  return (
    <LayerCard className={cn("min-w-0", className)}>
      {(title || actions) && (
        <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium text-kumo-default">{title}</span>
            {description && <span className="text-xs font-normal text-kumo-subtle">{description}</span>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </LayerCard.Secondary>
      )}
      <LayerCard.Primary className={cn("min-w-0", bodyClassName)}>{children}</LayerCard.Primary>
    </LayerCard>
  );
}

/* ------------------------------- States ------------------------------- */

export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <Empty
      className={className}
      size="sm"
      icon={<WarningCircleIcon size={32} className="text-kumo-danger" />}
      title={title}
      description={message}
      contents={
        onRetry && (
          <Button variant="secondary" icon={ArrowClockwiseIcon} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-16 text-sm text-kumo-subtle", className)}>
      <Loader size="sm" />
      {label}
    </div>
  );
}

/** Placeholder bars shown while a table loads for the first time. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-5 rounded-md" style={{ width: `${92 - ((i * 17) % 30)}%` }} />
      ))}
    </div>
  );
}

/* ------------------------------ Data bits ------------------------------ */

/** Relative time that updates every few seconds, with the absolute time in a tooltip. */
export function RelativeTime({ value, className }: { value: string | null | undefined; className?: string }) {
  const { settings } = useSettings();
  const now = useNow(5000);
  const d = parseTime(value);
  if (!d) return <span className={cn("text-kumo-subtle", className)}>—</span>;
  return (
    <Tooltip content={formatDateTime(d, settings.timeZone)}>
      <time dateTime={d.toISOString()} className={cn("whitespace-nowrap", className)}>
        {formatRelative(d, now)}
      </time>
    </Tooltip>
  );
}

/** Number that briefly highlights when its value changes (e.g. while polling). */
export function LiveNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash((f) => f + 1);
    }
  }, [value]);
  return (
    <span key={flash} className={cn("tabular rounded px-0.5", flash > 0 && "animate-value-flash", className)}>
      {format ? format(value) : value}
    </span>
  );
}

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
  className?: string;
}

export function Stat({ label, value, hint, tone = "default", className }: StatProps) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1 rounded-xl bg-kumo-base px-4 py-3 ring ring-kumo-hairline", className)}
    >
      <span className="truncate text-xs font-medium uppercase tracking-wide text-kumo-subtle">{label}</span>
      <span
        className={cn(
          "tabular truncate text-xl font-semibold",
          tone === "danger" && "text-kumo-danger",
          tone === "warning" && "text-kumo-warning",
          tone === "success" && "text-kumo-success",
          tone === "default" && "text-kumo-default",
        )}
      >
        {value}
      </span>
      {hint && <span className="truncate text-xs text-kumo-subtle">{hint}</span>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 font-sans text-[11px] text-kumo-subtle">
      {children}
    </kbd>
  );
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-kumo-subtle">{label}</dt>
      <dd className="min-w-0 text-sm text-kumo-default">{children}</dd>
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text variant="secondary">{children}</Text>;
}
