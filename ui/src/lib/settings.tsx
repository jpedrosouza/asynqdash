import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type TimeZonePreference = "local" | "utc";
export type DailyStatsRange = "today" | "7d" | "30d" | "90d";

export interface Settings {
  theme: ThemePreference;
  timeZone: TimeZonePreference;
  /** Seconds between live data refreshes. */
  pollInterval: number;
  /** Whether live data refresh is paused. */
  paused: boolean;
  /** Number of tasks per page in task tables. */
  pageSize: number;
  sidebarOpen: boolean;
  dailyStatsRange: DailyStatsRange;
}

const STORAGE_KEY = "asynqdash:settings";
// Key used before the project was renamed; read once so saved preferences carry over.
const LEGACY_STORAGE_KEY = "asynqmon:settings";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  timeZone: "local",
  pollInterval: 5,
  paused: false,
  pageSize: 20,
  sidebarOpen: true,
  dailyStatsRange: "7d",
};

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Theme actually applied, after resolving "system". */
  isDarkMode: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function usePrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const prefersDark = usePrefersDark();
  const isDarkMode = settings.theme === "dark" || (settings.theme === "system" && prefersDark);

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage may be unavailable (e.g. private mode); settings then last for the session.
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(() => ({ settings, update, isDarkMode }), [settings, update, isDarkMode]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

/** Refetch interval (ms) for live queries, or false when live updates are paused. */
export function useRefetchInterval(): number | false {
  const { settings } = useSettings();
  return settings.paused ? false : settings.pollInterval * 1000;
}
