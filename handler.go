package asynqdash

import (
	"embed"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"github.com/jpedrosouza/asynq"
	"github.com/redis/go-redis/v9"
)

// Options are used to configure HTTPHandler.
type Options struct {
	// URL path the handler is responsible for.
	// The path is used for the homepage of asynqdash, and every other page is rooted in this subtree.
	//
	// This field is optional. Default is "/".
	RootPath string

	// RedisConnOpt specifies the connection to a redis-server or redis-cluster.
	//
	// This field is required.
	RedisConnOpt asynq.RedisConnOpt

	// PayloadFormatter is used to convert payload bytes to string shown in the UI.
	//
	// This field is optional.
	PayloadFormatter PayloadFormatter

	// ResultFormatter is used to convert result bytes to string shown in the UI.
	//
	// This field is optional.
	ResultFormatter ResultFormatter

	// PrometheusAddress specifies the address of the Prometheus to connect to.
	//
	// This field is optional. If this field is set, asynqdash will query the Prometheus server
	// to get the time series data about queue metrics and show them in the web UI.
	PrometheusAddress string

	// Set ReadOnly to true to restrict user to view-only mode.
	ReadOnly bool

	// MaxPayloadLength is the maximum number of characters of a payload shown in task lists.
	// Longer payloads are truncated. Task details always show the full payload.
	//
	// This field is optional. Zero means no limit.
	MaxPayloadLength int

	// MaxResultLength is the maximum number of characters of a result shown in task lists.
	// Longer results are truncated. Task details always show the full result.
	//
	// This field is optional. Zero means no limit.
	MaxResultLength int

	// By default, asynqdash samples the queues every 10 seconds and records how many tasks are
	// enqueued, processed and failed per minute and per hour, in keys prefixed with "asynqdash:"
	// in the same redis. This is shown as the throughput of each queue in the web UI.
	// Minute buckets are kept for 3 hours and hour buckets for 91 days.
	//
	// Set DisableThroughputCollector to true to stop recording. Data recorded by other
	// asynqdash instances connected to the same redis is still shown.
	DisableThroughputCollector bool
}

// HTTPHandler is a http.Handler for asynqdash application.
type HTTPHandler struct {
	router   *mux.Router
	closers  []func() error
	rootPath string // the value should not have the trailing slash
}

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.router.ServeHTTP(w, r)
}

// New creates a HTTPHandler with the given options.
func New(opts Options) *HTTPHandler {
	if opts.RedisConnOpt == nil {
		panic("asynqdash.New: RedisConnOpt field is required")
	}
	rc, ok := opts.RedisConnOpt.MakeRedisClient().(redis.UniversalClient)
	if !ok {
		panic(fmt.Sprintf("asynqdash.New: unsupported RedisConnOpt type %T", opts.RedisConnOpt))
	}
	i := asynq.NewInspector(opts.RedisConnOpt)
	c := asynq.NewClient(opts.RedisConnOpt)

	// Make sure that RootPath starts with a slash if provided.
	if opts.RootPath != "" && !strings.HasPrefix(opts.RootPath, "/") {
		panic("asynqdash.New: RootPath must start with a slash")
	}
	// Remove tailing slash from RootPath.
	opts.RootPath = strings.TrimSuffix(opts.RootPath, "/")

	closers := []func() error{rc.Close, i.Close, c.Close}
	if !opts.DisableThroughputCollector {
		collector := newThroughputCollector(rc, i)
		collector.start()
		// Stop the collector before closing the connections it uses.
		closers = append([]func() error{collector.stop}, closers...)
	}

	return &HTTPHandler{
		router:   muxRouter(opts, rc, i, c),
		closers:  closers,
		rootPath: opts.RootPath,
	}
}

// Close closes connections to redis.
func (h *HTTPHandler) Close() error {
	for _, f := range h.closers {
		if err := f(); err != nil {
			return err
		}
	}
	return nil
}

// RootPath returns the root URL path used for asynqdash application.
// Returned path string does not have the trailing slash.
func (h *HTTPHandler) RootPath() string {
	return h.rootPath
}

//go:embed ui/build/*
var staticContents embed.FS

func muxRouter(opts Options, rc redis.UniversalClient, inspector *asynq.Inspector, client *asynq.Client) *mux.Router {
	router := mux.NewRouter().PathPrefix(opts.RootPath).Subrouter()

	var payloadFmt PayloadFormatter = DefaultPayloadFormatter
	if opts.PayloadFormatter != nil {
		payloadFmt = opts.PayloadFormatter
	}

	var resultFmt ResultFormatter = DefaultResultFormatter
	if opts.ResultFormatter != nil {
		resultFmt = opts.ResultFormatter
	}

	// Lists show a preview of payloads and results; task details show them in full.
	listPayloadFmt := truncatingPayloadFormatter(payloadFmt, opts.MaxPayloadLength)
	listResultFmt := truncatingResultFormatter(resultFmt, opts.MaxResultLength)

	api := router.PathPrefix("/api").Subrouter()

	// Health check endpoint.
	api.HandleFunc("/health", newHealthHandlerFunc(rc)).Methods("GET")

	// Queue endpoints.
	api.HandleFunc("/queues", newListQueuesHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/queues/{qname}", newGetQueueHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/queues/{qname}", newDeleteQueueHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}:pause", newPauseQueueHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}:resume", newResumeQueueHandlerFunc(inspector)).Methods("POST")

	// Queue Historical Stats endpoint.
	api.HandleFunc("/queue_stats", newListQueueStatsHandlerFunc(inspector)).Methods("GET")

	// Task type breakdown endpoint.
	api.HandleFunc("/queues/{qname}/task_types", newListTaskTypesHandlerFunc(inspector)).Methods("GET")

	// Task endpoints.
	api.HandleFunc("/queues/{qname}/active_tasks", newListActiveTasksHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/active_tasks/{task_id}:cancel", newCancelActiveTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/active_tasks:cancel_all", newCancelAllActiveTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/active_tasks:batch_cancel", newBatchCancelActiveTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/pending_tasks", newListPendingTasksHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/pending_tasks/{task_id}", newDeleteTaskHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/pending_tasks:delete_all", newDeleteAllPendingTasksHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/pending_tasks:batch_delete", newBatchDeleteTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/pending_tasks/{task_id}:archive", newArchiveTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/pending_tasks:archive_all", newArchiveAllPendingTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/pending_tasks:batch_archive", newBatchArchiveTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/scheduled_tasks", newListScheduledTasksHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/scheduled_tasks/{task_id}", newDeleteTaskHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/scheduled_tasks:delete_all", newDeleteAllScheduledTasksHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/scheduled_tasks:batch_delete", newBatchDeleteTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/scheduled_tasks/{task_id}:run", newRunTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/scheduled_tasks:run_all", newRunAllScheduledTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/scheduled_tasks:batch_run", newBatchRunTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/scheduled_tasks/{task_id}:archive", newArchiveTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/scheduled_tasks:archive_all", newArchiveAllScheduledTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/scheduled_tasks:batch_archive", newBatchArchiveTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/retry_tasks", newListRetryTasksHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/retry_tasks/{task_id}", newDeleteTaskHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/retry_tasks:delete_all", newDeleteAllRetryTasksHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/retry_tasks:batch_delete", newBatchDeleteTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/retry_tasks/{task_id}:run", newRunTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/retry_tasks:run_all", newRunAllRetryTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/retry_tasks:batch_run", newBatchRunTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/retry_tasks/{task_id}:archive", newArchiveTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/retry_tasks:archive_all", newArchiveAllRetryTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/retry_tasks:batch_archive", newBatchArchiveTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/archived_tasks", newListArchivedTasksHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/archived_tasks/{task_id}", newDeleteTaskHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/archived_tasks:delete_all", newDeleteAllArchivedTasksHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/archived_tasks:batch_delete", newBatchDeleteTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/archived_tasks/{task_id}:run", newRunTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/archived_tasks:run_all", newRunAllArchivedTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/archived_tasks:batch_run", newBatchRunTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/completed_tasks", newListCompletedTasksHandlerFunc(inspector, listPayloadFmt, listResultFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/completed_tasks/{task_id}", newDeleteTaskHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/completed_tasks:delete_all", newDeleteAllCompletedTasksHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/completed_tasks:batch_delete", newBatchDeleteTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks", newListAggregatingTasksHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks/{task_id}", newDeleteTaskHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks:delete_all", newDeleteAllAggregatingTasksHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks:batch_delete", newBatchDeleteTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks/{task_id}:run", newRunTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks:run_all", newRunAllAggregatingTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks:batch_run", newBatchRunTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks/{task_id}:archive", newArchiveTaskHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks:archive_all", newArchiveAllAggregatingTasksHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/groups/{gname}/aggregating_tasks:batch_archive", newBatchArchiveTasksHandlerFunc(inspector)).Methods("POST")

	api.HandleFunc("/queues/{qname}/tasks/{task_id}", newGetTaskHandlerFunc(inspector, payloadFmt, resultFmt)).Methods("GET")

	// Groups endponts
	api.HandleFunc("/queues/{qname}/groups", newListGroupsHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/queues/{qname}/groups/{gname}:flush", newFlushGroupHandlerFunc(inspector)).Methods("POST")

	// Task metrics recorded by the asynq servers.
	api.HandleFunc("/queues/{qname}/task_metrics", newGetTaskMetricsHandlerFunc(inspector)).Methods("GET")

	// Queue metadata (categories).
	api.HandleFunc("/queue_metadata", newListQueueMetadataHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/queues/{qname}/metadata", newSetQueueMetadataHandlerFunc(inspector)).Methods("POST")

	// Rate limits.
	api.HandleFunc("/queues/{qname}/rate_limit", newSetQueueRateLimitHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/queues/{qname}/rate_limit", newRemoveQueueRateLimitHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/rate_limits", newListRateLimitsHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/rate_limits/{key}", newSetRateLimitHandlerFunc(inspector)).Methods("POST")
	api.HandleFunc("/rate_limits/{key}", newRemoveRateLimitHandlerFunc(inspector)).Methods("DELETE")

	// Flows.
	api.HandleFunc("/flows", newListFlowsHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/flows/{name}", newDeleteFlowHandlerFunc(inspector)).Methods("DELETE")
	api.HandleFunc("/flow_runs", newListFlowRunsHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/flow_runs/{run_id}", newGetFlowRunHandlerFunc(inspector, resultFmt)).Methods("GET")

	// Servers endpoints.
	api.HandleFunc("/servers", newListServersHandlerFunc(inspector, listPayloadFmt)).Methods("GET")

	// Scheduler Entry endpoints.
	api.HandleFunc("/scheduler_entries", newListSchedulerEntriesHandlerFunc(inspector, listPayloadFmt)).Methods("GET")
	api.HandleFunc("/scheduler_entries/{entry_id}/enqueue_events", newListSchedulerEnqueueEventsHandlerFunc(inspector)).Methods("GET")
	api.HandleFunc("/scheduler_entries/{entry_id}:run", newRunSchedulerEntryHandlerFunc(inspector, client)).Methods("POST")

	// Redis info endpoint.
	switch c := rc.(type) {
	case *redis.ClusterClient:
		api.HandleFunc("/redis_info", newRedisClusterInfoHandlerFunc(c, inspector)).Methods("GET")
	case *redis.Client:
		api.HandleFunc("/redis_info", newRedisInfoHandlerFunc(c)).Methods("GET")
	}

	// Throughput recorded by the collector.
	api.HandleFunc("/throughput", newGetThroughputHandlerFunc(rc, inspector, !opts.DisableThroughputCollector)).Methods("GET")

	// Time series metrics endpoints.
	api.HandleFunc("/metrics", newGetMetricsHandlerFunc(http.DefaultClient, opts.PrometheusAddress)).Methods("GET")

	// Restrict APIs when running in read-only mode.
	if opts.ReadOnly {
		api.Use(restrictToReadOnly)
	}

	// Everything else, route to uiAssetsHandler.
	router.NotFoundHandler = &uiAssetsHandler{
		rootPath:       opts.RootPath,
		contents:       staticContents,
		staticDirPath:  "ui/build",
		indexFileName:  "index.html",
		prometheusAddr: opts.PrometheusAddress,
		readOnly:       opts.ReadOnly,
	}

	return router
}

// restrictToReadOnly is a middleware function to restrict users to perform only GET requests.
func restrictToReadOnly(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "" {
			http.Error(w, fmt.Sprintf("API Server is running in read-only mode: %s request is not allowed", r.Method), http.StatusMethodNotAllowed)
			return
		}
		h.ServeHTTP(w, r)
	})
}
