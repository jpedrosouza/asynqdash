<img src="https://user-images.githubusercontent.com/11155743/114745460-57760500-9d57-11eb-9a2c-43fa88171807.png" alt="Asynqmon logo" width="360px" />

# Web UI for monitoring & administering [Asynq](https://github.com/hibiken/asynq) task queues

## Overview

Asynqmon is a web UI for monitoring and administering [Asynq](https://github.com/hibiken/asynq) queues and tasks.
It supports integration with [Prometheus](https://prometheus.io) to display time-series data.

Asynqmon is both a library that you can mount in your Go web application, and a binary that you can install and run.

> **About this fork**
>
> This is an independently maintained fork of [hibiken/asynqmon](https://github.com/hibiken/asynqmon).
> It ships a redesigned web UI and fixes for long-standing issues, while keeping the same Go API
> (`asynqmon.New`, `asynqmon.Options`) and the same command-line flags. See [What's new](#whats-new-in-this-fork).

## What's new in this fork

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
- Light/dark/system theme, local or UTC time zone, configurable refresh interval and page size.
- Read-only mode hides every action.

**Server-side improvements:**

- Static assets are served with correct MIME types, gzip compression and long-term caching for fingerprinted files.
- The embedded UI works on Windows (paths in `embed.FS` are always forward slashes).
- Payloads with line breaks or tabs are displayed instead of being reported as "non-printable bytes".
- New endpoints: `GET /api/health`, `GET /api/queues/{qname}/task_types` and `POST /api/scheduler_entries/{entry_id}:run`
  (see [API additions](#api-additions)).

## Install the binary

### Release binaries

Download the release binary for your system from the [releases page](https://github.com/jpedrosouza/asynqmon/releases).

### Docker image

```bash
docker pull ghcr.io/jpedrosouza/asynqmon:latest
```

### Building from source

Requirements: [Go](https://golang.org/dl/) 1.21+ and [Node.js](https://nodejs.org/) 22+ (to build the UI).

```bash
make build
```

The `asynqmon` binary is created in the current directory. To build a Docker image instead, run `make docker`.

## Run the binary

To use the defaults, run it and open http://localhost:8080.

```bash
# with a binary
./asynqmon

# with a docker image
docker run --rm --name asynqmon -p 8080:8080 ghcr.io/jpedrosouza/asynqmon
```

By default, the web server listens on port `8080` and connects to a Redis server at `127.0.0.1:6379`.
Run `./asynqmon --help` to see every flag.

_Note_: Use `--redis-url` to specify address, db number, and password with one flag value; alternatively, use `--redis-addr`, `--redis-db`, and `--redis-password` to specify each value.

| Flag                              | Env                       | Description                                                                                                                  | Default          |
| --------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `--port`(int)                     | `PORT`                    | port number to use for web ui server                                                                                         | 8080             |
| `--redis-url`(string)             | `REDIS_URL`               | URL to redis or sentinel server. See [godoc](https://pkg.go.dev/github.com/hibiken/asynq#ParseRedisURI) for supported format | ""               |
| `--redis-addr`(string)            | `REDIS_ADDR`              | address of redis server to connect to                                                                                        | "127.0.0.1:6379" |
| `--redis-db`(int)                 | `REDIS_DB`                | redis database number                                                                                                        | 0                |
| `--redis-password`(string)        | `REDIS_PASSWORD`          | password to use when connecting to redis server                                                                              | ""               |
| `--redis-cluster-nodes`(string)   | `REDIS_CLUSTER_NODES`     | comma separated list of host:port addresses of cluster nodes                                                                 | ""               |
| `--redis-tls`(string)             | `REDIS_TLS`               | server name for TLS validation used when connecting to redis server                                                          | ""               |
| `--redis-insecure-tls`(bool)      | `REDIS_INSECURE_TLS`      | disable TLS certificate host checks                                                                                          | false            |
| `--enable-metrics-exporter`(bool) | `ENABLE_METRICS_EXPORTER` | enable prometheus metrics exporter to expose queue metrics                                                                   | false            |
| `--prometheus-addr`(string)       | `PROMETHEUS_ADDR`         | address of prometheus server to query time series                                                                            | ""               |
| `--read-only`(bool)               | `READ_ONLY`               | use web UI in read-only mode                                                                                                 | false            |

### Connecting to Redis

To connect to a **single redis server**, use either `--redis-url` or (`--redis-addr`, `--redis-db`, and `--redis-password`):

```sh
./asynqmon --redis-url=redis://:mypassword@localhost:6380/2
./asynqmon --redis-addr=localhost:6380 --redis-db=2 --redis-password=mypassword
```

To connect to **redis-sentinels**, use `--redis-url`:

```sh
./asynqmon --redis-url=redis-sentinel://:mypassword@localhost:5000,localhost:5001,localhost:5002?master=mymaster
```

To connect to a **redis-cluster**, use `--redis-cluster-nodes`:

```sh
./asynqmon --redis-cluster-nodes=localhost:7000,localhost:7001,localhost:7002,localhost:7003,localhost:7004,localhost:7006
```

### Integration with Prometheus

First, enable the metrics exporter with `--enable-metrics-exporter` so that queue metrics are exposed under `/metrics` for Prometheus to scrape.
Then pass the address of the Prometheus server with `--prometheus-addr` to enable the Metrics page of the web UI.

```bash
./asynqmon --enable-metrics-exporter --prometheus-addr=http://localhost:9090
```

## Import as a library

[![Go Reference](https://pkg.go.dev/badge/github.com/jpedrosouza/asynqmon.svg)](https://pkg.go.dev/github.com/jpedrosouza/asynqmon)

```bash
go get github.com/jpedrosouza/asynqmon
```

Projects that already use `github.com/hibiken/asynqmon` only need to change the import path: the API is the same.

Example with [net/http](https://pkg.go.dev/net/http):

```go
package main

import (
	"log"
	"net/http"

	"github.com/hibiken/asynq"
	"github.com/jpedrosouza/asynqmon"
)

func main() {
	h := asynqmon.New(asynqmon.Options{
		RootPath:     "/monitoring", // RootPath specifies the root for asynqmon app
		RedisConnOpt: asynq.RedisClientOpt{Addr: ":6379"},
	})

	// Note: We need the trailing slash when using net/http.ServeMux.
	http.Handle(h.RootPath()+"/", h)

	// Go to http://localhost:8080/monitoring to see asynqmon homepage.
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Example with [gorilla/mux](https://pkg.go.dev/github.com/gorilla/mux):

```go
h := asynqmon.New(asynqmon.Options{
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
mon := asynqmon.New(asynqmon.Options{
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

Copyright (c) 2019-present [Ken Hibino](https://github.com/hibiken) and [Contributors](https://github.com/hibiken/asynqmon/graphs/contributors). `Asynqmon` is free and open-source software licensed under the [MIT License](LICENSE). Official logo was created by [Vic Shóstak](https://github.com/koddr) and distributed under [Creative Commons](https://creativecommons.org/publicdomain/zero/1.0/) license (CC0 1.0 Universal).
