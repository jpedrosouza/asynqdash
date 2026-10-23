import { cn } from "@cloudflare/kumo";
import { LOGO_MARK_SCALE, LOGO_VIEWBOX, WORDMARK_ASYNQ_PATH, WORDMARK_DASH_PATH } from "./logo-paths";

// Colors come from the --logo-* tokens in app.css, which switch with the theme.
function Ring() {
  return (
    <>
      <circle
        cx="32"
        cy="32"
        r="20"
        fill="none"
        stroke="var(--logo-accent)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="18 14 18 14 18 43.66"
        transform="rotate(-90 32 32)"
      />
      <circle cx="14.3" cy="22.8" r="5" fill="var(--logo-dot)" />
    </>
  );
}

/** Asynqdash mark: the dash ring only. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <Ring />
    </svg>
  );
}

/** Full Asynqdash logo: mark and wordmark. "Asynq" follows the current text color. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={cn("text-kumo-default", className)} role="img" aria-label="Asynqdash">
      <g transform={`scale(${LOGO_MARK_SCALE})`}>
        <Ring />
      </g>
      <path fill="currentColor" d={WORDMARK_ASYNQ_PATH} />
      <path fill="var(--logo-dash)" d={WORDMARK_DASH_PATH} />
    </svg>
  );
}
