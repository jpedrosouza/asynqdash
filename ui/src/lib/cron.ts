import cronstrue from "cronstrue";
import { formatDuration } from "./format";

const DESCRIPTORS: Record<string, string> = {
  "@yearly": "Once a year, at midnight on January 1st",
  "@annually": "Once a year, at midnight on January 1st",
  "@monthly": "Once a month, at midnight on the 1st",
  "@weekly": "Once a week, at midnight on Sunday",
  "@daily": "Once a day, at midnight",
  "@midnight": "Once a day, at midnight",
  "@hourly": "Every hour, at minute 0",
};

/** Parses Go duration strings such as "1h30m", "5m" or "30s" into seconds. */
function parseGoDuration(value: string): number | null {
  const re = /(\d+(?:\.\d+)?)(h|ms|m|s|us|µs|ns)/g;
  const factors: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, µs: 1e-6, ns: 1e-9 };
  let total = 0;
  let matched = "";
  for (const m of value.matchAll(re)) {
    total += parseFloat(m[1]) * factors[m[2]];
    matched += m[0];
  }
  return matched === value && matched !== "" ? total : null;
}

/**
 * Describes a scheduler spec in plain English.
 * Supports standard cron expressions, descriptors (@daily) and intervals (@every 5m).
 * Returns null if the spec cannot be described.
 */
export function describeSpec(spec: string): string | null {
  let s = spec.trim();
  let tz = "";
  const tzMatch = s.match(/^(?:CRON_TZ|TZ)=(\S+)\s+(.*)$/);
  if (tzMatch) {
    tz = ` (${tzMatch[1]})`;
    s = tzMatch[2];
  }
  if (s.startsWith("@every ")) {
    const secs = parseGoDuration(s.slice(7).trim());
    return secs !== null ? `Every ${formatDuration(secs)}` : null;
  }
  if (DESCRIPTORS[s]) return DESCRIPTORS[s] + tz;
  try {
    return cronstrue.toString(s, { verbose: false, use24HourTimeFormat: true }) + tz;
  } catch {
    return null;
  }
}
