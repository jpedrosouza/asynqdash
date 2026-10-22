import { useEffect, useState } from "react";

/** Current time in ms, refreshed at the given interval. Useful for relative timestamps. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Calls handler on a global keyboard shortcut, unless the user is typing in a field. */
export function useHotkey(match: (e: KeyboardEvent) => boolean, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!match(e)) return;
      handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [match, handler]);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Copies text to the clipboard. Returns false if the clipboard is unavailable. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
