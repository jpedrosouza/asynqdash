import type { ReactNode } from "react";
import { Button, Link, LinkButton, Select, Tabs } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon, BugIcon, GithubLogoIcon } from "@phosphor-icons/react";
import {
  DEFAULT_SETTINGS,
  PAGE_SIZE_OPTIONS,
  useSettings,
  type ThemePreference,
  type TimeZonePreference,
} from "../lib/settings";
import { formatDateTime } from "../lib/format";
import { READ_ONLY } from "../lib/flags";
import { Card, Page, PageHeader } from "../components/common";

const POLL_OPTIONS = [2, 5, 10, 15, 30, 60];

const REPOSITORY_URL = "https://github.com/jpedrosouza/asynqmon";

function SettingRow({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex max-w-md flex-col gap-0.5">
        <span className="text-sm font-medium text-kumo-default">{title}</span>
        <span className="text-sm text-kumo-subtle">{description}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { settings, update } = useSettings();

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Preferences are saved in this browser."
        actions={
          <Button
            variant="ghost"
            icon={ArrowCounterClockwiseIcon}
            onClick={() => update({ ...DEFAULT_SETTINGS, sidebarOpen: settings.sidebarOpen })}
          >
            Reset to defaults
          </Button>
        }
      />
      <Card title="Appearance">
        <div className="divide-y divide-kumo-hairline">
          <SettingRow title="Theme" description="Follow the operating system, or force light or dark mode.">
            <Tabs
              size="sm"
              value={settings.theme}
              onValueChange={(v) => update({ theme: v as ThemePreference })}
              tabs={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </SettingRow>
          <SettingRow
            title="Time zone"
            description={<>Used for absolute timestamps. Example: {formatDateTime(new Date(), settings.timeZone)}</>}
          >
            <Tabs
              size="sm"
              value={settings.timeZone}
              onValueChange={(v) => update({ timeZone: v as TimeZonePreference })}
              tabs={[
                { value: "local", label: "Local" },
                { value: "utc", label: "UTC" },
              ]}
            />
          </SettingRow>
        </div>
      </Card>
      <Card title="Data">
        <div className="divide-y divide-kumo-hairline">
          <SettingRow
            title="Refresh interval"
            description="How often live data is fetched. Refreshing pauses while this tab is in the background."
          >
            <Select
              aria-label="Refresh interval"
              size="sm"
              className="w-40"
              value={settings.pollInterval}
              onValueChange={(v) => update({ pollInterval: Number(v) })}
              renderValue={(v: unknown) => `Every ${v}s`}
            >
              {POLL_OPTIONS.map((s) => (
                <Select.Option key={s} value={s}>
                  Every {s}s
                </Select.Option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow title="Tasks per page" description="Default page size of task tables.">
            <Select
              aria-label="Tasks per page"
              size="sm"
              className="w-40"
              value={settings.pageSize}
              onValueChange={(v) => update({ pageSize: Number(v) })}
              renderValue={(v: unknown) => `${v} tasks`}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <Select.Option key={n} value={n}>
                  {n} tasks
                </Select.Option>
              ))}
            </Select>
          </SettingRow>
        </div>
      </Card>
      <Card title="About">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-kumo-subtle">
            Web console for <Link href="https://github.com/hibiken/asynq">Asynq</Link>, based on the original asynqmon
            by Ken Hibino and contributors. Released under the MIT License.
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={REPOSITORY_URL} target="_blank" size="sm" icon={GithubLogoIcon}>
              Source code
            </LinkButton>
            <LinkButton href={`${REPOSITORY_URL}/issues`} target="_blank" size="sm" icon={BugIcon}>
              Report an issue
            </LinkButton>
          </div>
        </div>
      </Card>
      {READ_ONLY && (
        <p className="text-sm text-kumo-subtle">
          This console runs in read-only mode: actions that change queues or tasks are hidden.
        </p>
      )}
    </Page>
  );
}
