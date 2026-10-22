import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Button, Tooltip, cn } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useSettings } from "../lib/settings";
import { useNow } from "../lib/hooks";
import { formatRelativeLong } from "../lib/format";

/** Timestamp of the most recent successful data fetch across all queries. */
function useLastUpdated(): number {
  const client = useQueryClient();
  const [last, setLast] = useState(0);
  useEffect(() => {
    const cache = client.getQueryCache();
    let max = 0;
    for (const q of cache.getAll()) max = Math.max(max, q.state.dataUpdatedAt);
    setLast(max);
    return cache.subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const updatedAt = event.query.state.dataUpdatedAt;
      // Cache events can fire while other components render; defer the state update.
      queueMicrotask(() => setLast((prev) => Math.max(prev, updatedAt)));
    });
  }, [client]);
  return last;
}

/** Shows whether live updates are on, when data was last refreshed, and lets the user pause or refresh. */
export function LiveIndicator() {
  const { settings, update } = useSettings();
  const client = useQueryClient();
  const fetching = useIsFetching() > 0;
  const lastUpdated = useLastUpdated();
  const now = useNow(1000);
  const paused = settings.paused;

  return (
    <div className="flex items-center gap-1">
      <Tooltip
        content={
          paused
            ? "Live updates are paused"
            : `Refreshing every ${settings.pollInterval}s${lastUpdated ? ` · updated ${formatRelativeLong(new Date(lastUpdated), now)}` : ""}`
        }
      >
        <span className="hidden items-center gap-2 rounded-md px-2 py-1 text-xs text-kumo-subtle sm:flex">
          <span className="relative flex size-2">
            {!paused && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-kumo-success opacity-60" />
            )}
            <span
              className={cn("relative inline-flex size-2 rounded-full", paused ? "bg-kumo-fill" : "bg-kumo-success")}
            />
          </span>
          {paused ? "Paused" : "Live"}
        </span>
      </Tooltip>
      <Tooltip
        content={paused ? "Resume live updates" : "Pause live updates"}
        render={
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={paused ? PlayIcon : PauseIcon}
            aria-label={paused ? "Resume live updates" : "Pause live updates"}
            onClick={() => update({ paused: !paused })}
          />
        }
      />
      <Tooltip
        content="Refresh now"
        render={
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            aria-label="Refresh now"
            icon={<ArrowClockwiseIcon className={cn(fetching && "animate-spin")} />}
            onClick={() => client.invalidateQueries()}
          />
        }
      />
    </div>
  );
}
