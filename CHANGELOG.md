# Changelog

All notable changes to this project will be documented in this file.

The format is based on ["Keep a Changelog"](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-23

First stable release of Asynqdash.

### Added

- (ui): Throughput of each queue on the queue page: tasks enqueued, succeeded and failed per minute (last 60 minutes),
  per hour (24 hours) or per day (7 and 30 days).
- (pkg): Throughput collector. Asynqdash samples every queue every 10 seconds and records the activity per minute
  (kept 3 hours) and per hour (kept 91 days) in redis keys prefixed with `asynqdash:`. Several instances can share
  a redis. Disable it with `Options.DisableThroughputCollector` or `--disable-throughput-collector`.
- (pkg): `GET /api/throughput` endpoint.
- (pkg): `order=desc` parameter for task lists, to list the newest tasks first.
- (ui): Task tables have a sort order switch (newest or oldest first), also available in the settings.
- (pkg): `Options.MaxPayloadLength` and `Options.MaxResultLength` shorten payloads and results in task lists only.
- (cmd): `--root-path` / `ROOT_PATH` to serve the UI under a sub-path, e.g. behind a reverse proxy (asynqmon#308, #259).
- (cmd): HTTP basic authentication with `--basic-auth-username` and `--basic-auth-password` (asynqmon#313, #285).
- (cmd): `--redis-username` / `REDIS_USERNAME` for redis ACL users, e.g. AWS MemoryDB (asynqmon#274, #328, #347).
- (cmd): `--redis-ca-cert`, `--redis-client-cert` and `--redis-client-key` for TLS with a custom CA and client
  certificates (asynqmon#322, #341).
- (cmd): Docker images for linux/arm64 in addition to linux/amd64 (asynqmon#291, #269, #280, #319).

### Changed

- (ui): Task lists show the newest tasks first by default.
- (ui): The logo reads "Asynqdash", with a capital A.
- (ui): With the local time zone, "processed today" and the daily "Tasks processed" chart use local days, rebuilt
  from the throughput collector; asynq records days in UTC. Days without collected data are labelled as UTC days.
- (pkg): The queue list fetches queue stats concurrently, so it stays fast with many queues (asynqmon#353).
- (cmd): With a redis-sentinel URL, `--redis-password` (and `--redis-username`) now authenticate with the master;
  the password in the URL still authenticates with the sentinels (asynqmon#271).
- (cmd): Spaces and empty entries in `--redis-cluster-nodes` are ignored.

### Fixed

- (ui): Charts ignored the local time zone setting and always used UTC days.
- (cmd): Task details showed payloads and results truncated to `--max-payload-length` / `--max-result-length`.
- (ui): The web app manifest could not be loaded behind basic authentication.

## [0.9.0] - 2026-10-22

### Changed

- Renamed the project to **Asynqdash**: module `github.com/jpedrosouza/asynqdash`, package `asynqdash`
  (`asynqdash.New`, `asynqdash.Options`), binary `asynqdash` and Docker image `ghcr.io/jpedrosouza/asynqdash`.
  The options, flags and HTTP API are unchanged.
- (ui): New logo, favicons and app icons. Saved preferences carry over from the previous name.
- (ci): Release binaries for linux/arm64 and darwin/arm64.

## [0.8.0] - 2026-10-22

This release starts the independently maintained fork (`github.com/jpedrosouza/asynqmon`).

### Changed

- (pkg): Module path is now `github.com/jpedrosouza/asynqmon`. The Go API and command-line flags are unchanged.
- (ui): Rebuilt the web UI with React 19, Vite, Kumo components and TanStack Query, replacing Material UI v4,
  Create React App and Redux.
- (ui): Full-width responsive layout, collapsible sidebar with queue list, command palette (Ctrl/⌘ + K),
  live indicator with pause/resume, task quick view, bulk actions, URL-synced tabs and pagination.
- (ui): Destructive and bulk actions ask for confirmation; deleting every task of a state requires typing the queue name.
- (ui): Every action reports success or failure with a notification.
- (ui): Settings for theme (system/light/dark), time zone (local/UTC), refresh interval and page size.
- (pkg): Static assets are served with correct MIME types, gzip compression and cache headers.
- (cmd): Docker image builds with Node 22 and Go 1.23, and is published to GitHub Container Registry.

### Added

- (pkg): `GET /api/health` endpoint for liveness/readiness probes.
- (pkg): `GET /api/queues/{qname}/task_types` endpoint with a breakdown of tasks by type and state.
- (pkg): `POST /api/scheduler_entries/{entry_id}:run` endpoint to enqueue a periodic task immediately.

### Fixed

- (pkg): Embedded UI assets could not be served on Windows.
- (pkg): Payloads containing line breaks or tabs were shown as "non-printable bytes"; empty payloads are shown as empty.
- (ui): Double scrollbars and fixed 1280px content width.
- (ui): Deleting the tasks of the last page left an empty page without pagination.
- (ui): Selections could include tasks that were no longer listed after a refresh.
- (ui): Queue actions were only reachable by hovering with a mouse.
- (ui): Error rate sorting was broken for queues without processed tasks.
- (ui): Chart tooltips ignored dark mode.
- (cmd): Test expectation for redis-sentinel URLs.
- (ui): Third-party license notices are shipped with the UI build (`THIRD_PARTY_LICENSES.md`, `NOTICES.md`).

## [0.7.0] - 2022-04-11

Version 0.7 added support for [Task Aggregation](https://github.com/hibiken/asynq/wiki/Task-aggregation) feature

### Added
 
- (ui): Added tasks view to show aggregated tasks

## [0.6.1] - 2022-03-17

### Fixed
- (ui): Show metrics link in sidebar when --prometheus-addr flag is provided

## [0.6.0] - 2022-03-02

### Added

- (cmd): Added `--read-only` flag to specify read-only mode
- (pkg): Added `Options.ReadOnly` to restrict user to view-only mode
- (ui): Hide action buttons in read-only mode
- (ui): Display queue latency in dashboard page and queue detail page.
- (ui): Added copy-to-clipboard button for task ID in tasks list-view page.
- (ui): Use logo image in the appbar (thank you @koddr!)

### Fixed
- (ui): Pagination in ActiveTasks table is fixed

## [0.5.0] - 2021-12-19

Version 0.5 added support for [Prometheus](https://prometheus.io/) integration.

- (cmd): Added `--enable-metrics-exporter` option to export queue metrics.
- (cmd): Added `--prometheus-addr` to enable metrics view in Web UI.
- (pkg): Added `Options.PrometheusAddress` to enable metrics view in Web UI.

## [0.4.0] - 2021-11-06

- Added "completed" state
- Updated to be compatible with asynq v0.19

## [0.3.2] - 2021-10-22

- (ui): Fixed build

## [0.3.1] - 2021-10-21

### Added

- (cmd): Added --max-payload-length to allow specifying number of characters displayed for payload, defaults to 200 chars
- (pkg): DefaultPayloadFormatter is now exported from the package

## [0.3.0]

### Changed

- Asynqmon is now a go package that can be imported to other projects!

## [0.2.1]

### Addded

- Task details view is added
- Search by task ID feature is added

## [0.2]

### Changed

- Updated to depend on asynq 0.18

## [0.1.0-beta1] - 2021-01-31

Initial Beta Release 🎉
