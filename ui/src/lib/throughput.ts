import type { TimeZonePreference } from "./settings";
import type { DailyStat, Queue, ThroughputResponse } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Activity during one bucket. Processed includes failed tasks. */
export interface ActivityPoint {
  /** Start of the bucket, in ms. */
  time: number;
  enqueued: number;
  processed: number;
  failed: number;
}

/** Whether days in the given time zone are the same as UTC days, as recorded by asynq. */
export function isUtcDays(tz: TimeZonePreference, now = Date.now()): boolean {
  return tz === "utc" || new Date(now).getTimezoneOffset() === 0;
}

/** Sums the points of the given queues (every queue when omitted) per bucket, sorted by time. */
export function sumQueues(resp: ThroughputResponse | undefined, queues?: string[]): ActivityPoint[] {
  const byTime = new Map<number, ActivityPoint>();
  for (const [name, points] of Object.entries(resp?.queues ?? {})) {
    if (queues && !queues.includes(name)) continue;
    for (const [t, enqueued, processed, failed] of points) {
      const p = byTime.get(t) ?? { time: t * 1000, enqueued: 0, processed: 0, failed: 0 };
      p.enqueued += enqueued;
      p.processed += processed;
      p.failed += failed;
      byTime.set(t, p);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function startOfDay(ms: number, tz: TimeZonePreference): number {
  if (tz === "utc") return Math.floor(ms / DAY) * DAY;
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(dayStart: number, n: number, tz: TimeZonePreference): number {
  if (tz === "utc") return dayStart + n * DAY;
  // Calendar arithmetic keeps local midnights across daylight saving changes.
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Start of each of the last n days in the time zone, oldest first; the last one is today. */
export function lastDays(n: number, tz: TimeZonePreference, now = Date.now()): number[] {
  const today = startOfDay(now, tz);
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1), tz));
}

/** Sums hourly points per day in the time zone. Days without any point are omitted. */
export function sumByDay(points: ActivityPoint[], tz: TimeZonePreference): ActivityPoint[] {
  const byDay = new Map<number, ActivityPoint>();
  for (const p of points) {
    const day = startOfDay(p.time, tz);
    const d = byDay.get(day) ?? { time: day, enqueued: 0, processed: 0, failed: 0 };
    d.enqueued += p.enqueued;
    d.processed += p.processed;
    d.failed += p.failed;
    byDay.set(day, d);
  }
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

/**
 * Whether the collector observed (nearly) every hour between start and end, given the start times
 * of the hours it observed. The first hour it observed is usually partial; 90% leaves room for that
 * and for short interruptions.
 */
function observedPeriod(hours: number[], start: number, end: number): boolean {
  const expected = Math.ceil((end - start) / HOUR);
  const observed = hours.filter((t) => t >= start && t < end).length;
  return expected > 0 && observed >= Math.max(1, Math.floor(expected * 0.9));
}

function localDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface DailyProcessed {
  /** Time zone of the day boundaries: UTC when only asynq's counters are used. */
  timeZone: TimeZonePreference;
  points: DailyPoint[];
}

export interface DailyPoint {
  /** Start of the day in the selected time zone, in ms. */
  time: number;
  processed: number;
  failed: number;
  /** "utc" when the value is the UTC day recorded by asynq, used when the collector has no data for the day. */
  source: "collector" | "utc";
}

/**
 * Processed and failed tasks per day over the last `days` days, summed across queues.
 *
 * asynq records one counter per UTC date. In UTC (or a time zone without offset), those are used as is.
 * Otherwise days are rebuilt from the hourly buckets of the throughput collector; days it did not
 * observe fall back to the UTC counter of the same date.
 */
export function dailyProcessed(
  stats: Record<string, DailyStat[]>,
  hourly: ActivityPoint[] | undefined,
  days: number,
  tz: TimeZonePreference,
  now = Date.now(),
): DailyProcessed {
  const utcByDate = new Map<string, { processed: number; failed: number }>();
  for (const list of Object.values(stats)) {
    for (const s of list) {
      const entry = utcByDate.get(s.date) ?? { processed: 0, failed: 0 };
      entry.processed += s.processed;
      entry.failed += s.failed;
      utcByDate.set(s.date, entry);
    }
  }

  if (isUtcDays(tz, now) || !hourly) {
    const points = lastDays(days, "utc", now).map((day): DailyPoint => {
      const entry = utcByDate.get(new Date(day).toISOString().slice(0, 10));
      return { time: day, processed: entry?.processed ?? 0, failed: entry?.failed ?? 0, source: "utc" };
    });
    return { timeZone: "utc", points };
  }

  const hours = hourly.map((p) => p.time);
  const points = lastDays(days, tz, now).map((day): DailyPoint => {
    const end = Math.min(addDays(day, 1, tz), now);
    if (observedPeriod(hours, day, end)) {
      let processed = 0;
      let failed = 0;
      for (const p of hourly) {
        if (p.time >= day && p.time < end) {
          processed += p.processed;
          failed += p.failed;
        }
      }
      return { time: day, processed, failed, source: "collector" };
    }
    const entry = utcByDate.get(localDateKey(day));
    return { time: day, processed: entry?.processed ?? 0, failed: entry?.failed ?? 0, source: "utc" };
  });
  return { timeZone: tz, points };
}

export interface QueueToday {
  queue: string;
  processed: number;
  failed: number;
}

/**
 * Processed and failed tasks of each queue since the start of today in the time zone.
 *
 * asynq counts "today" in UTC. In other time zones, today is rebuilt from the hourly buckets of the
 * collector when it observed the whole day so far; otherwise the UTC counters of asynq are used.
 */
export function processedToday(
  queues: Queue[],
  hourly: ThroughputResponse | undefined,
  tz: TimeZonePreference,
  now = Date.now(),
): { queues: QueueToday[]; source: "collector" | "utc" } {
  const fromAsynq = () => ({
    queues: queues.map((q) => ({ queue: q.queue, processed: q.processed, failed: q.failed })),
    source: "utc" as const,
  });
  if (isUtcDays(tz, now) || !hourly) return fromAsynq();

  const today = startOfDay(now, tz);
  const hours = sumQueues(hourly).map((p) => p.time);
  if (!observedPeriod(hours, today, now)) return fromAsynq();

  return {
    queues: queues.map((q) => {
      let processed = 0;
      let failed = 0;
      for (const [t, , p, f] of hourly.queues[q.queue] ?? []) {
        if (t * 1000 >= today) {
          processed += p;
          failed += f;
        }
      }
      return { queue: q.queue, processed, failed };
    }),
    source: "collector",
  };
}
