import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useMatch } from "react-router";
import { Badge, Button, LinkProvider, Sidebar, Tooltip, useSidebar } from "@cloudflare/kumo";
import {
  ChartLineIcon,
  ClockCountdownIcon,
  DatabaseIcon,
  GearSixIcon,
  GithubLogoIcon,
  HardDrivesIcon,
  ListIcon,
  MagnifyingGlassIcon,
  StackIcon,
  EyeIcon,
} from "@phosphor-icons/react";
import { AppLink } from "./AppLink";
import { Logo, LogoMark } from "./Logo";
import { LiveIndicator } from "./LiveIndicator";
import { CommandMenu } from "./CommandMenu";
import { Kbd } from "./common";
import { PROMETHEUS_ADDRESS, READ_ONLY } from "../lib/flags";
import { paths, queuePath } from "../lib/paths";
import { useQueues } from "../lib/queries";
import { useSettings } from "../lib/settings";
import { useHotkey } from "../lib/hooks";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function NavItem({
  to,
  icon,
  label,
  end = false,
}: {
  to: string;
  icon: React.ComponentType;
  label: string;
  end?: boolean;
}) {
  const active = !!useMatch({ path: to, end });
  return (
    <Sidebar.MenuButton href={to} icon={icon} active={active} tooltip={label}>
      {label}
    </Sidebar.MenuButton>
  );
}

function QueueNavList() {
  const { data: queues } = useQueues();
  const location = useLocation();
  if (!queues || queues.length === 0) return null;
  const sorted = [...queues].sort((a, b) => a.queue.localeCompare(b.queue));
  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>Queues</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {sorted.map((q) => {
          const href = queuePath(q.queue);
          const active = decodeURIComponent(location.pathname).startsWith(`/queues/${q.queue}`);
          const attention = q.archived + q.retry;
          return (
            <Sidebar.MenuButton key={q.queue} href={href} active={active} size="sm" tooltip={q.queue}>
              <span className="truncate">{q.queue}</span>
              {q.paused ? (
                <Sidebar.MenuBadge>paused</Sidebar.MenuBadge>
              ) : attention > 0 ? (
                <Sidebar.MenuBadge>{attention > 999 ? "999+" : attention}</Sidebar.MenuBadge>
              ) : null}
            </Sidebar.MenuButton>
          );
        })}
      </Sidebar.Menu>
    </Sidebar.Group>
  );
}

function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <Sidebar>
      <Sidebar.Header>
        <AppLink
          href={paths.home}
          className="flex h-8 items-center gap-2 px-1 text-kumo-default"
          aria-label="Asynqmon home"
        >
          {collapsed ? <LogoMark className="size-7" /> : <Logo className="h-6 w-auto" />}
        </AppLink>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu>
            <NavItem to={paths.home} icon={StackIcon} label="Queues" end />
            <NavItem to={paths.servers} icon={HardDrivesIcon} label="Servers" />
            <NavItem to={paths.schedulers} icon={ClockCountdownIcon} label="Schedulers" />
            <NavItem to={paths.redis} icon={DatabaseIcon} label="Redis" />
            {PROMETHEUS_ADDRESS && <NavItem to={paths.metrics} icon={ChartLineIcon} label="Metrics" />}
          </Sidebar.Menu>
        </Sidebar.Group>
        <QueueNavList />
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu>
          <NavItem to={paths.settings} icon={GearSixIcon} label="Settings" />
          <Sidebar.MenuButton
            href="https://github.com/jpedrosouza/asynqmon/issues"
            target="_blank"
            icon={GithubLogoIcon}
            tooltip="Report an issue"
          >
            Report an issue
          </Sidebar.MenuButton>
        </Sidebar.Menu>
      </Sidebar.Footer>
    </Sidebar>
  );
}

function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { toggleSidebar } = useSidebar();
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-kumo-hairline bg-kumo-canvas/85 px-3 backdrop-blur md:px-4">
      <Tooltip
        content="Toggle sidebar"
        render={
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={ListIcon}
            aria-label="Toggle sidebar"
            onClick={toggleSidebar}
          />
        }
      />
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg bg-kumo-base px-2.5 text-sm text-kumo-subtle ring ring-kumo-line hover:text-kumo-default"
      >
        <MagnifyingGlassIcon size={16} />
        <span className="flex-1 truncate text-left">Search queues, tasks, pages…</span>
        <span className="hidden gap-0.5 sm:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        {READ_ONLY && (
          <Tooltip content="This console runs in read-only mode: actions that change data are disabled.">
            <Badge variant="secondary" icon={<EyeIcon />}>
              Read-only
            </Badge>
          </Tooltip>
        )}
        <LiveIndicator />
      </div>
    </header>
  );
}

// Same breakpoint as Kumo's Sidebar, below which it renders as a sheet.
const MOBILE_QUERY = "(max-width: 767px)";

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function AppShell() {
  const { settings, update } = useSettings();
  const [searchOpen, setSearchOpen] = useState(false);
  const isMobile = useIsMobile();
  // On small screens the sidebar is a sheet: it starts closed and closes after navigating.
  // The saved preference only applies to the desktop rail.
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const matchSearch = useCallback((e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k", []);
  const openSearch = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    setSearchOpen((o) => !o);
  }, []);
  useHotkey(matchSearch, openSearch);

  return (
    <LinkProvider component={AppLink}>
      <Sidebar.Provider
        open={isMobile ? mobileOpen : settings.sidebarOpen}
        onOpenChange={(open) => (isMobile ? setMobileOpen(open) : update({ sidebarOpen: open }))}
        collapsible="icon"
        className="h-dvh overflow-hidden bg-kumo-canvas"
      >
        <AppSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopBar onOpenSearch={() => setSearchOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
      </Sidebar.Provider>
    </LinkProvider>
  );
}
