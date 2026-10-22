import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CommandPalette } from "@cloudflare/kumo";
import {
  ChartLineIcon,
  ClockCountdownIcon,
  DatabaseIcon,
  GearSixIcon,
  HardDrivesIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  StackIcon,
  SunIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { getTask, ApiError } from "../lib/api";
import { PROMETHEUS_ADDRESS } from "../lib/flags";
import { paths, queuePath, taskPath } from "../lib/paths";
import { useQueues } from "../lib/queries";
import { useSettings } from "../lib/settings";
import { notifyError } from "../lib/toast";
import { Kbd } from "./common";
import { pluralize } from "../lib/format";

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  keywords?: string;
  perform: () => void | Promise<void>;
}

interface CommandGroup {
  id: string;
  label: string;
  items: CommandItem[];
}

/** Looks for a task with the given id in every queue and returns the first queue that has it. */
async function findTaskQueue(taskId: string, queues: string[]): Promise<string | null> {
  const results = await Promise.allSettled(queues.map((q) => getTask(q, taskId).then(() => q)));
  for (const r of results) if (r.status === "fulfilled") return r.value;
  const unexpected = results.find(
    (r) => r.status === "rejected" && !(r.reason instanceof ApiError && r.reason.status === 404),
  );
  if (unexpected && unexpected.status === "rejected") throw unexpected.reason;
  return null;
}

function matches(item: CommandItem, search: string): boolean {
  const haystack = `${item.title} ${item.subtitle ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { data: queues = [] } = useQueues();
  const { settings, update, isDarkMode } = useSettings();
  const [search, setSearch] = useState("");

  const close = () => {
    onOpenChange(false);
    setSearch("");
  };

  const groups = useMemo<CommandGroup[]>(() => {
    const term = search.trim();
    const go = (to: string) => () => navigate(to);

    const pages: CommandItem[] = [
      {
        id: "p-queues",
        title: "Queues",
        icon: <StackIcon />,
        keywords: "dashboard home overview",
        perform: go(paths.home),
      },
      { id: "p-servers", title: "Servers", icon: <HardDrivesIcon />, keywords: "workers", perform: go(paths.servers) },
      {
        id: "p-schedulers",
        title: "Schedulers",
        icon: <ClockCountdownIcon />,
        keywords: "cron periodic",
        perform: go(paths.schedulers),
      },
      { id: "p-redis", title: "Redis", icon: <DatabaseIcon />, keywords: "info memory", perform: go(paths.redis) },
      ...(PROMETHEUS_ADDRESS
        ? [
            {
              id: "p-metrics",
              title: "Metrics",
              icon: <ChartLineIcon />,
              keywords: "prometheus charts",
              perform: go(paths.metrics),
            },
          ]
        : []),
      {
        id: "p-settings",
        title: "Settings",
        icon: <GearSixIcon />,
        keywords: "preferences theme",
        perform: go(paths.settings),
      },
    ];

    const queueItems: CommandItem[] = [...queues]
      .sort((a, b) => a.queue.localeCompare(b.queue))
      .flatMap((q) => [
        {
          id: `q-${q.queue}`,
          title: q.queue,
          subtitle: `${pluralize(q.size, "task")}${q.paused ? " · paused" : ""}`,
          icon: <TrayIcon />,
          keywords: "queue",
          perform: go(queuePath(q.queue)),
        },
        ...(term && q.archived > 0
          ? [
              {
                id: `q-${q.queue}-archived`,
                title: `${q.queue} › Archived`,
                subtitle: pluralize(q.archived, "task"),
                icon: <TrayIcon />,
                keywords: "queue archived failed dead",
                perform: go(queuePath(q.queue, "archived")),
              },
            ]
          : []),
        ...(term && q.retry > 0
          ? [
              {
                id: `q-${q.queue}-retry`,
                title: `${q.queue} › Retry`,
                subtitle: pluralize(q.retry, "task"),
                icon: <TrayIcon />,
                keywords: "queue retry failed",
                perform: go(queuePath(q.queue, "retry")),
              },
            ]
          : []),
      ]);

    const actions: CommandItem[] = [
      {
        id: "a-theme",
        title: isDarkMode ? "Switch to light theme" : "Switch to dark theme",
        icon: isDarkMode ? <SunIcon /> : <MoonIcon />,
        keywords: "theme dark light mode appearance",
        perform: () => update({ theme: isDarkMode ? "light" : "dark" }),
      },
      {
        id: "a-live",
        title: settings.paused ? "Resume live updates" : "Pause live updates",
        icon: settings.paused ? <PlayIcon /> : <PauseIcon />,
        keywords: "polling refresh live",
        perform: () => update({ paused: !settings.paused }),
      },
    ];

    const result: CommandGroup[] = [];
    // Anything without spaces could be a task id: offer a lookup across all queues.
    if (term.length >= 4 && !/\s/.test(term)) {
      result.push({
        id: "task",
        label: "Tasks",
        items: [
          {
            id: "t-lookup",
            title: `Find task "${term}"`,
            subtitle: "Search every queue for a task with this ID",
            icon: <MagnifyingGlassIcon />,
            perform: async () => {
              try {
                const qname = await findTaskQueue(
                  term,
                  queues.map((q) => q.queue),
                );
                if (qname) navigate(taskPath(qname, term));
                else notifyError("Task not found", new Error(`No queue has a task with ID "${term}".`));
              } catch (err) {
                notifyError("Could not look up the task", err);
              }
            },
          },
        ],
      });
    }
    const filter = (items: CommandItem[]) => (term ? items.filter((i) => matches(i, term)) : items);
    const q = filter(queueItems);
    const p = filter(pages);
    const a = filter(actions);
    if (q.length) result.push({ id: "queues", label: "Queues", items: q.slice(0, 30) });
    if (p.length) result.push({ id: "pages", label: "Pages", items: p });
    if (a.length) result.push({ id: "actions", label: "Actions", items: a });
    return result;
  }, [search, queues, navigate, isDarkMode, settings.paused, update]);

  const run = (item: CommandItem) => {
    close();
    void item.perform();
  };

  return (
    <CommandPalette.Root
      open={open}
      onOpenChange={(o: boolean) => (o ? onOpenChange(true) : close())}
      items={groups}
      value={search}
      onValueChange={setSearch}
      itemToStringValue={(group: CommandGroup) => group.label}
      onSelect={(item: CommandItem) => run(item)}
      getSelectableItems={(gs: CommandGroup[]) => gs.flatMap((g) => g.items)}
    >
      <CommandPalette.Input
        placeholder="Search queues, pages, or paste a task ID…"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <CommandPalette.List>
        <CommandPalette.Results>
          {(group: CommandGroup) => (
            <CommandPalette.Group key={group.id} items={group.items}>
              <CommandPalette.GroupLabel>{group.label}</CommandPalette.GroupLabel>
              <CommandPalette.Items>
                {(item: CommandItem) => (
                  <CommandPalette.Item key={item.id} value={item} onClick={() => run(item)}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="text-kumo-subtle">{item.icon}</span>
                      <span className="truncate">{item.title}</span>
                      {item.subtitle && <span className="truncate text-xs text-kumo-subtle">{item.subtitle}</span>}
                    </span>
                  </CommandPalette.Item>
                )}
              </CommandPalette.Items>
            </CommandPalette.Group>
          )}
        </CommandPalette.Results>
        <CommandPalette.Empty>No results</CommandPalette.Empty>
      </CommandPalette.List>
      <CommandPalette.Footer>
        <span className="flex items-center gap-2">
          <Kbd>↑↓</Kbd>
          <span>Navigate</span>
        </span>
        <span className="flex items-center gap-2">
          <Kbd>↵</Kbd>
          <span>Select</span>
        </span>
        <span className="flex items-center gap-2">
          <Kbd>Esc</Kbd>
          <span>Close</span>
        </span>
      </CommandPalette.Footer>
    </CommandPalette.Root>
  );
}
