// Runtime flags injected by the Go server into index.html (see static.go).
// During development (vite dev server) the template actions are not evaluated,
// so values that still look like template actions fall back to defaults.

declare global {
  interface Window {
    FLAG_ROOT_PATH?: string;
    FLAG_PROMETHEUS_SERVER_ADDRESS?: string;
    FLAG_READ_ONLY?: string;
  }
}

const TEMPLATE_ACTION_PREFIX = "/[[";

function evaluated(value: string | undefined): string {
  if (!value || value.startsWith(TEMPLATE_ACTION_PREFIX)) return "";
  return value;
}

/** Root URL path of the app, without a trailing slash (e.g. "" or "/monitoring"). */
export const ROOT_PATH = evaluated(window.FLAG_ROOT_PATH).replace(/\/+$/, "");

/** Address of the Prometheus server. Empty if metrics are disabled. */
export const PROMETHEUS_ADDRESS = evaluated(window.FLAG_PROMETHEUS_SERVER_ADDRESS);

/** True when the server runs in read-only mode: actions are hidden. */
export const READ_ONLY = evaluated(window.FLAG_READ_ONLY) === "true";
