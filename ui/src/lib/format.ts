import type { TimeZonePreference } from "./settings";

const ZERO_TIME_PREFIX = "0001-01-01";

/** Parses an RFC3339 timestamp from the API. Returns null for empty or zero timestamps. */
export function parseTime(value: string | undefined | null): Date | null {
  if (!value || value.startsWith(ZERO_TIME_PREFIX)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | Date | null | undefined, tz: TimeZonePreference): string {
  const d = value instanceof Date ? value : parseTime(value);
  if (!d) return "—";
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: tz === "utc" ? "UTC" : undefined,
    }).format(d) + (tz === "utc" ? " UTC" : "")
  );
}

export function formatTimeShort(ms: number, tz: TimeZonePreference): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz === "utc" ? "UTC" : undefined,
  }).format(ms);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Compact duration such as "2h 5m", "45s" or "3 days". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s >= 86400 * 2) return `${Math.floor(s / 86400)} days`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}

/** Relative time from now, e.g. "in 5m" or "3h ago". */
export function formatRelative(value: string | Date | null | undefined, now = Date.now()): string {
  const d = value instanceof Date ? value : parseTime(value);
  if (!d) return "—";
  const diff = (d.getTime() - now) / 1000;
  if (Math.abs(diff) < 1) return "now";
  const text = formatDuration(Math.abs(diff));
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

/** Long relative time used in sentences, e.g. "3 minutes ago". */
export function formatRelativeLong(value: string | Date | null | undefined, now = Date.now()): string {
  const d = value instanceof Date ? value : parseTime(value);
  if (!d) return "—";
  const diff = (d.getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === "second") {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return "now";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatCompact(n: number): string {
  return n < 10000 ? numberFormat.format(n) : compactFormat.format(n);
}

/** Ratio as a percentage. Returns 0 when the denominator is 0. */
export function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function formatPercent(value: number): string {
  if (value === 0) return "0%";
  if (value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

/** Shortens a task id (usually a UUID) for display. */
export function shortId(id: string): string {
  // Tasks enqueued by a flow step have IDs derived from their parent ("<parent id>>type#n"): show the last step.
  const step = id.lastIndexOf(">");
  if (step > 0) {
    const tail = id.slice(step);
    return tail.length > 24 ? `…${tail.slice(0, 23)}…` : `…${tail}`;
  }
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Pretty-prints a payload if it is JSON. Non-JSON payloads are returned unchanged.
 */
export function prettifyPayload(payload: string): { text: string; isJson: boolean } {
  const trimmed = payload.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
    } catch {
      // Not valid JSON (e.g. truncated by the payload formatter).
    }
  }
  return { text: payload, isJson: false };
}

/** Single-line preview of a payload for table cells. */
export function payloadPreview(payload: string, maxLength = 140): string {
  const trimmed = payload.trim();
  if (!trimmed) return "—";
  let text = trimmed;
  try {
    text = JSON.stringify(JSON.parse(trimmed));
  } catch {
    text = trimmed.replace(/\s+/g, " ");
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

/** Duration given in milliseconds, with a precision fit for task processing times: "850 ms", "1.24 s", "3m 5s". */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1) return ms === 0 ? "0 ms" : "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return formatDuration(ms / 1000);
}

/** Period given in milliseconds as a unit: "second", "minute", "5 minutes", "hour"... */
export function formatPeriod(ms: number): string {
  const units: [string, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  for (const [unit, size] of units) {
    if (ms >= size && ms % size === 0) {
      const n = ms / size;
      return n === 1 ? unit : `${formatNumber(n)} ${unit}s`;
    }
  }
  return `${formatNumber(ms)} ms`;
}

/** Rate limit as a sentence: "200 per minute (burst 20)". */
export function formatRateLimit(rl: { limit: number; period_ms: number; burst: number }): string {
  const burst = rl.burst > 1 ? ` (burst ${formatNumber(rl.burst)})` : "";
  return `${formatNumber(rl.limit)} per ${formatPeriod(rl.period_ms)}${burst}`;
}
