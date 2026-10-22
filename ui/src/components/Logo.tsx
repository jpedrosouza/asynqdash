import { cn } from "@cloudflare/kumo";
import { LOGO_MARK_PATHS, LOGO_WORDMARK_PATHS } from "./logo-paths";

/** Asynq logo mark (the "knot" symbol only). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="50 50 300 300" className={cn("fill-kumo-brand", className)} aria-hidden="true">
      {LOGO_MARK_PATHS.map((d) => (
        <path key={d.slice(0, 16)} d={d} />
      ))}
    </svg>
  );
}

/** Full Asynq logo: mark and wordmark. The wordmark follows the current text color. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="50 50 1600 300" className={className} role="img" aria-label="Asynq">
      <g className="fill-kumo-brand">
        {LOGO_MARK_PATHS.map((d) => (
          <path key={d.slice(0, 16)} d={d} />
        ))}
      </g>
      <g fill="currentColor">
        {LOGO_WORDMARK_PATHS.map((d) => (
          <path key={d.slice(0, 16)} d={d} />
        ))}
      </g>
    </svg>
  );
}
