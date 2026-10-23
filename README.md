<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/asynqdash-logo-dark.svg">
    <img src="docs/logo/asynqdash-logo.svg" alt="Asynqdash" width="320">
  </picture>
</p>

# Web console for monitoring & administering [Asynq](https://github.com/hibiken/asynq) task queues

## Overview

Asynqdash is a web UI for monitoring and administering [Asynq](https://github.com/hibiken/asynq) queues and tasks.
It supports integration with [Prometheus](https://prometheus.io) to display time-series data.

Asynqdash is both a library that you can mount in your Go web application, and a binary that you can install and run.

> **About the project**
>
> Asynqdash started as a fork of [hibiken/asynqmon](https://github.com/hibiken/asynqmon) and is maintained independently.
> It ships a redesigned web UI and fixes for long-standing issues, and keeps asynqmon's Go API shape
> (`New`, `Options`) and command-line flags. It is not affiliated with or endorsed by the Asynq project.

## What's new compared to asynqmon

**A new web UI**, rebuilt with React 19, [Kumo](https://github.com/cloudflare/kumo) components and TanStack Query:

- Full-width, responsive layout with a collapsible sidebar that lists every queue and highlights retry/archived tasks.
- Command palette (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd>) to jump to queues and pages, or look up a task ID across all queues.
- Live indicator with pause/resume and "refresh now". Polling pauses while the browser tab is hidden.
- Dashboard with totals, queue size by state, processed/failed history and a sortable, filterable queue table.
- Queue page with stats, task-state tabs with counters, per-page filter, bulk actions on the selection or on every task,
  and a quick task preview without leaving the list. The current tab and page are kept in the URL.
- Confirmation before destructive or bulk actions. Deleting every task of a state requires typing the queue name.
- Success and error notifications for every action (errors used to fail silently).
- Task page with error banner, retry meter, timeline and full payload/result viewer (copy, download, line wrap).
- Servers page with worker utilization, schedulers page with human-readable cron specs, enqueue history and "Run now",
  Redis page with key metrics and a searchable INFO view.
- Throughput of each queue: tasks enqueued, succeeded and failed per minute (last 60 minutes), per hour (24 hours)
  or per day (7 and 30 days), recorded by Asynqdash itself (see [Throughput](#throughput)).
- Task lists show the newest tasks first, with a switch to show the oldest first.
- Light/dark/system theme, local or UTC time zone (also for charts and "today"), configurable refresh interval and page size.
- Read-only mode hides every action.

**Server-side improvements:**

- Static assets are served with correct MIME types, gzip compression and long-term caching for fingerprinted files.
- The embedded UI works on Windows (paths in `embed.FS` are always forward slashes).
- Payloads with line breaks or tabs are displayed instead of being reported as "non-printable bytes".
- Task details show the full payload and result; `--max-payload-length` and `--max-result-length` only shorten lists.
- The queue list loads queues concurrently, which keeps it fast with many queues.
- New endpoints: `GET /api/health`, `GET /api/throughput`, `GET /api/queues/{qname}/task_types` and
  `POST /api/scheduler_entries/{entry_id}:run`, and an `order` parameter for task lists (see [API additions](#api-additions)).

**Command-line improvements:**

- `--root-path` to serve the UI under a sub-path, e.g. behind a reverse proxy.
- Optional HTTP basic authentication (`--basic-auth-username`, `--basic-auth-password`).
- Redis ACL users (`--redis-username`), TLS with a custom CA and client certificates (`--redis-ca-cert`,
  `--redis-client-cert`, `--redis-client-key`), and a separate password for the master behind redis-sentinel.
- Multi-architecture Docker image (linux/amd64 and linux/arm64).

## Install the binary

### Release binaries

Download the release binary for your system from the [releases page](https://github.com/jpedrosouza/asynqdash/releases).

### Docker image

```bash
docker pull ghcr.io/jpedrosouza/asynqdash:latest
```

### Building from source

Requirements: [Go](https://golang.org/dl/) 1.21+ and [Node.js](https://nodejs.org/) 22+ (to build the UI).

```bash
make build
```

The `asynqdash` binary is created in the current directory. To build a Docker image instead, run `make docker`.

## Run the binary

To use the defaults, run it and open http://localhost:8080.

```bash
# with a binary
./asynqdash

# with a docker image
docker run --rm --name asynqdash -p 8080:8080 ghcr.io/jpedrosouza/asynqdash
```

By default, the web server listens on port `8080` and connects to a Redis server at `127.0.0.1:6379`.
Run `./asynqdash --help` to see every flag.

_Note_: Use `--redis-url` to specify address, db number, and password with one flag value; alternatively, use `--redis-addr`, `--redis-db`, and `--redis-password` to specify each value.

| Flag                                   | Env                            | Description                                                                                                                  | Default          |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `--port`(int)                          | `PORT`                         | port number to use for web ui server                                                                                         | 8080             |
| `--root-path`(string)                  | `ROOT_PATH`                    | URL path under which the web UI and the API are served, e.g. `/asynqdash` behind a reverse proxy                             | "/"              |
| `--basic-auth-username`(string)        | `BASIC_AUTH_USERNAME`          | username for HTTP basic authentication; requires `--basic-auth-password`                                                     | ""               |
| `--basic-auth-password`(string)        | `BASIC_AUTH_PASSWORD`          | password for HTTP basic authentication; requires `--basic-auth-username`                                                     | ""               |
| `--redis-url`(string)                  | `REDIS_URL`                    | URL to redis or sentinel server. See [godoc](https://pkg.go.dev/github.com/hibiken/asynq#ParseRedisURI) for supported format | ""               |
| `--redis-addr`(string)                 | `REDIS_ADDR`                   | address of redis server to connect to                                                                                        | "127.0.0.1:6379" |
| `--redis-db`(int)                      | `REDIS_DB`                     | redis database number                                                                                                        | 0                |
| `--redis-username`(string)             | `REDIS_USERNAME`               | username to use when connecting to redis server (Redis ACL)                                                                  | ""               |
| `--redis-password`(string)             | `REDIS_PASSWORD`               | password to use when connecting to redis server; with a redis-sentinel URL, the password of the master                       | ""               |
| `--redis-cluster-nodes`(string)        | `REDIS_CLUSTER_NODES`          | comma separated list of host:port addresses of cluster nodes                                                                 | ""               |
| `--redis-tls`(string)                  | `REDIS_TLS`                    | server name for TLS validation used when connecting to redis server                                                          | ""               |
| `--redis-insecure-tls`(bool)           | `REDIS_INSECURE_TLS`           | disable TLS certificate host checks                                                                                          | false            |
| `--redis-ca-cert`(string)              | `REDIS_CA_CERT`                | path to a PEM file with the CA certificates used to verify the redis server                                                  | ""               |
| `--redis-client-cert`(string)          | `REDIS_CLIENT_CERT`            | path to a PEM client certificate for TLS client authentication; requires `--redis-client-key`                                | ""               |
| `--redis-client-key`(string)           | `REDIS_CLIENT_KEY`             | path to the PEM private key of `--redis-client-cert`                                                                         | ""               |
| `--max-payload-length`(int)            | `MAX_PAYLOAD_LENGTH`           | maximum number of characters of a payload shown in task lists (task details show it in full)                                 | 200              |
| `--max-result-length`(int)             | `MAX_RESULT_LENGTH`            | maximum number of characters of a result shown in task lists (task details show it in full)                                  | 200              |
| `--disable-throughput-collector`(bool) | `DISABLE_THROUGHPUT_COLLECTOR` | do not record the throughput of queues in redis (see [Throughput](#throughput))                                              | false            |
| `--enable-metrics-exporter`(bool)      | `ENABLE_METRICS_EXPORTER`      | enable prometheus metrics exporter to expose queue metrics                                                                   | false            |
| `--prometheus-addr`(string)            | `PROMETHEUS_ADDR`              | address of prometheus server to query time series                                                                            | ""               |
| `--read-only`(bool)                    | `READ_ONLY`                    | use web UI in read-only mode                                                                                                 | false            |

### Connecting to Redis

To connect to a **single redis server**, use either `--redis-url` or (`--redis-addr`, `--redis-db`, and `--redis-password`):

```sh
./asynqdash --redis-url=redis://:mypassword@localhost:6380/2
./asynqdash --redis-addr=localhost:6380 --redis-db=2 --redis-password=mypassword
```

To connect to **redis-sentinels**, use `--redis-url`. The password in the URL authenticates with the sentinels;
use `--redis-password` (and `--redis-username`) for the master:

```sh
./asynqdash --redis-url=redis-sentinel://:sentinelpassword@localhost:5000,localhost:5001,localhost:5002?master=mymaster \
  --redis-password=masterpassword
```

To connect to a **redis-cluster**, use `--redis-cluster-nodes`:

```sh
./asynqdash --redis-cluster-nodes=localhost:7000,localhost:7001,localhost:7002,localhost:7003,localhost:7004,localhost:7006
```

To use **TLS** with a private CA or client certificates (e.g. managed Redis services), pass the PEM files:

```sh
./asynqdash --redis-url=rediss://myredis.example.com:6380 \
  --redis-ca-cert=ca.pem --redis-client-cert=client.pem --redis-client-key=client-key.pem
```

### Serving under a sub-path and authentication

Behind a reverse proxy that forwards `https://example.com/asynqdash/` to Asynqdash, set the same path with `--root-path`
(the proxy must keep the path prefix). Requests to `/` are redirected to the root path.

```sh
./asynqdash --root-path=/asynqdash
```

Asynqdash has no user accounts. To require a login, either put it behind an authenticating proxy, or enable HTTP basic
authentication. `{root-path}/api/health` stays open for health checks.

```sh
BASIC_AUTH_USERNAME=admin BASIC_AUTH_PASSWORD='a long random password' ./asynqdash
```

Basic authentication sends the password with every request: serve Asynqdash over HTTPS (e.g. through a proxy).

### Throughput

asynq only keeps a daily count of processed and failed tasks per queue (per UTC date), and does not count enqueued
tasks. To show recent activity, Asynqdash samples every queue every 10 seconds and records how many tasks were
enqueued, processed and failed in each minute and each hour. The queue page shows it for the last 60 minutes (per
minute), 24 hours (per hour), or 7 and 30 days (per day, in the time zone selected in the settings).

- The data is stored in the same Redis, in keys prefixed with `asynqdash:` (a few kilobytes per queue). Minute buckets
  are kept for 3 hours and hour buckets for 91 days, then expire.
- Data is only recorded while Asynqdash runs. Several instances can share a Redis: only one of them records each sample.
- The number of enqueued tasks is estimated from the changes in each queue. Tasks deleted by hand are not counted.
- With the local time zone, the dashboard also uses the recorded hours to show processed tasks per local day (and
  "today"), since asynq's own counters are per UTC day. Days before Asynqdash started recording are shown as UTC days.

Use `--disable-throughput-collector` (or `Options.DisableThroughputCollector`) to stop recording.

### Integration with Prometheus

First, enable the metrics exporter with `--enable-metrics-exporter` so that queue metrics are exposed under `/metrics` for Prometheus to scrape.
Then pass the address of the Prometheus server with `--prometheus-addr` to enable the Metrics page of the web UI.

```bash
./asynqdash --enable-metrics-exporter --prometheus-addr=http://localhost:9090
```

## Import as a library

[![Go Reference](https://pkg.go.dev/badge/github.com/jpedrosouza/asynqdash.svg)](https://pkg.go.dev/github.com/jpedrosouza/asynqdash)

```bash
go get github.com/jpedrosouza/asynqdash
```

Projects that use `github.com/hibiken/asynqmon` can switch by changing the import path and the package name (`asynqmon.New` → `asynqdash.New`); the options are the same.

Example with [net/http](https://pkg.go.dev/net/http):

```go
package main

import (
	"log"
	"net/http"

	"github.com/hibiken/asynq"
	"github.com/jpedrosouza/asynqdash"
)

func main() {
	h := asynqdash.New(asynqdash.Options{
		RootPath:     "/monitoring", // RootPath specifies the root for the asynqdash app
		RedisConnOpt: asynq.RedisClientOpt{Addr: ":6379"},
	})

	// Note: We need the trailing slash when using net/http.ServeMux.
	http.Handle(h.RootPath()+"/", h)

	// Go to http://localhost:8080/monitoring to see the asynqdash homepage.
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Example with [gorilla/mux](https://pkg.go.dev/github.com/gorilla/mux):

```go
h := asynqdash.New(asynqdash.Options{
	RootPath:     "/monitoring",
	RedisConnOpt: asynq.RedisClientOpt{Addr: ":6379"},
})

r := mux.NewRouter()
r.PathPrefix(h.RootPath()).Handler(h)
log.Fatal(http.ListenAndServe(":8080", r))
```

Example with [labstack/echo](https://github.com/labstack/echo):

```go
e := echo.New()
mon := asynqdash.New(asynqdash.Options{
	RootPath:     "/monitoring/tasks",
	RedisConnOpt: asynq.RedisClientOpt{Addr: ":6379"},
})
e.Any("/monitoring/tasks/*", echo.WrapHandler(mon))
e.Start(":8080")
```

### Theming

The UI uses Kumo design tokens, so the whole console can be re-branded from CSS. To change the accent color,
override the brand token in `ui/src/app.css` and rebuild the UI with `make assets`:

```css
:root {
  --color-kumo-brand: #7c3aed;
}
```

## API additions

These endpoints are available under `{RootPath}/api`, in addition to the ones used by the UI:

| Method | Path                                    | Description                                                                                                                                                                                   |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`                               | `200 {"status":"ok"}` when Redis is reachable, `503` otherwise. Suitable for liveness/readiness probes.                                                                                       |
| `GET`  | `/throughput`                           | Tasks enqueued, processed and failed per bucket, from the throughput collector. Parameters: `resolution` (`minute`, up to 3 hours, or `hour`, up to 91 days), `duration` (seconds), `queue` (repeatable; default every queue). Each point is `[unix time, enqueued, processed, failed]`. |
| `GET`  | `/queues/{qname}/{state}_tasks`         | Task lists accept `order=desc` to list the newest tasks first (for scheduled and retry tasks: the latest first). The default, `asc`, keeps the order of asynq.                              |
| `GET`  | `/queues/{qname}/task_types`            | Number of tasks of each type in the queue, by state. Large queues are sampled (up to 10,000 tasks per state); the response reports whether the counts were truncated.                         |
| `POST` | `/scheduler_entries/{entry_id}:run`     | Enqueues the task of a periodic scheduler entry right away, with the entry's payload and options. The regular schedule is not affected. Disabled in read-only mode, like every non-GET call. |

## Development

```bash
# Terminal 1: run the API server (without rebuilding the UI) against a local Redis
make api && ./api --redis-addr=localhost:6379

# Terminal 2: run the UI dev server with hot reload on http://localhost:3000
cd ui && npm ci && npm run dev
```

The dev server proxies `/api` to `http://localhost:8080` (set `ASYNQMON_API` to use another address).

The built UI in `ui/build` is embedded into the Go package and committed to the repository, so that `go get` users
don't need Node.js. After changing the UI, run `make assets` and commit `ui/build`. CI fails if it is out of date.

Useful commands: `npm run typecheck`, `npm run format`, `make test`.

## License

Asynqdash is free and open-source software licensed under the [MIT License](LICENSE). It is based on [asynqmon](https://github.com/hibiken/asynqmon), copyright (c) 2019-present [Ken Hibino](https://github.com/hibiken) and [contributors](https://github.com/hibiken/asynqmon/graphs/contributors). The Asynqdash wordmark uses [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) (SIL Open Font License 1.1). "Asynq" refers to the [Asynq](https://github.com/hibiken/asynq) project, which this console works with.
