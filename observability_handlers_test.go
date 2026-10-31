package asynqdash

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jpedrosouza/asynq"
	"github.com/redis/go-redis/v9"
)

// observabilityTestEnv runs against a real redis server, given by ASYNQDASH_TEST_REDIS_ADDR.
type observabilityTestEnv struct {
	t         *testing.T
	opt       asynq.RedisClientOpt
	router    http.Handler
	inspector *asynq.Inspector
	client    *asynq.Client
}

func newObservabilityTestEnv(t *testing.T) *observabilityTestEnv {
	addr := os.Getenv("ASYNQDASH_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("set ASYNQDASH_TEST_REDIS_ADDR to run this test")
	}
	opt := asynq.RedisClientOpt{Addr: addr, DB: 13}
	rc := redis.NewClient(&redis.Options{Addr: addr, DB: 13})
	if err := rc.FlushDB(context.Background()).Err(); err != nil {
		t.Fatal(err)
	}
	inspector := asynq.NewInspectorFromRedisClient(rc)
	client := asynq.NewClientFromRedisClient(rc)
	t.Cleanup(func() { rc.Close() })
	return &observabilityTestEnv{
		t:         t,
		opt:       opt,
		router:    muxRouter(Options{RootPath: ""}, rc, inspector, client),
		inspector: inspector,
		client:    client,
	}
}

func (e *observabilityTestEnv) do(method, path string, body interface{}, out interface{}) int {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			e.t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if out != nil && rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			e.t.Fatalf("%s %s: cannot decode %q: %v", method, path, rec.Body.String(), err)
		}
	}
	return rec.Code
}

// process runs an asynq server on the queues for the given time.
func (e *observabilityTestEnv) process(handler asynq.Handler, cfg asynq.Config, d time.Duration) {
	e.t.Helper()
	cfg.LogLevel = asynq.FatalLevel
	srv := asynq.NewServer(e.opt, cfg)
	if err := srv.Start(handler); err != nil {
		e.t.Fatal(err)
	}
	time.Sleep(d)
	srv.Shutdown()
}

func TestTaskMetricsEndpoint(t *testing.T) {
	e := newObservabilityTestEnv(t)
	for i := 0; i < 3; i++ {
		if _, err := e.client.Enqueue(asynq.NewTask("report:build", nil), asynq.Queue("reports"), asynq.Retention(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	mux := asynq.NewServeMux()
	mux.HandleFunc("report:build", func(ctx context.Context, task *asynq.Task) error {
		time.Sleep(30 * time.Millisecond)
		return nil
	})
	e.process(mux, asynq.Config{Queues: map[string]int{"reports": 1}, Concurrency: 1}, 2*time.Second)

	var resp taskMetricsResponse
	if code := e.do("GET", "/api/queues/reports/task_metrics?resolution=minute", nil, &resp); code != http.StatusOK {
		t.Fatalf("task_metrics returned %d", code)
	}
	if resp.Summary.Processed != 3 || resp.Summary.AvgMs < 30 || resp.Summary.P95Ms < 25 {
		t.Errorf("summary = %+v, want 3 tasks of about 30ms", resp.Summary)
	}
	if len(resp.ByType) != 1 || resp.ByType[0].Type != "report:build" || len(resp.Points) == 0 {
		t.Errorf("by_type = %+v, points = %d", resp.ByType, len(resp.Points))
	}
	if code := e.do("GET", "/api/queues/reports/task_metrics?resolution=second", nil, nil); code != http.StatusBadRequest {
		t.Errorf("invalid resolution returned %d, want 400", code)
	}
	if code := e.do("GET", "/api/queues/reports/task_metrics?resolution=minute&start=0", nil, nil); code != http.StatusBadRequest {
		t.Errorf("too large range returned %d, want 400", code)
	}

	// Completed tasks carry their timing.
	var tasks struct {
		Tasks []map[string]interface{} `json:"tasks"`
	}
	if code := e.do("GET", "/api/queues/reports/completed_tasks", nil, &tasks); code != http.StatusOK || len(tasks.Tasks) != 3 {
		t.Fatalf("completed_tasks returned %d with %d tasks", code, len(tasks.Tasks))
	}
	for _, task := range tasks.Tasks {
		if task["enqueued_at"] == nil || task["started_at"] == nil || task["duration_ms"].(float64) < 30 || task["wait_ms"] == nil {
			t.Errorf("completed task without timing: %v", task)
		}
	}
}

func TestQueueMetadataAndRateLimitEndpoints(t *testing.T) {
	e := newObservabilityTestEnv(t)
	if _, err := e.client.Enqueue(asynq.NewTask("video:encode", nil), asynq.Queue("video")); err != nil {
		t.Fatal(err)
	}
	if code := e.do("POST", "/api/queues/video/metadata", queueMetadata{Category: "Media", Subcategory: "Video"}, nil); code != http.StatusNoContent {
		t.Fatalf("set metadata returned %d", code)
	}
	if code := e.do("POST", "/api/queues/video/rate_limit", rateLimitRequest{Limit: 10, PeriodMs: 60000, Burst: 2}, nil); code != http.StatusNoContent {
		t.Fatalf("set rate limit returned %d", code)
	}
	if code := e.do("POST", "/api/queues/video/rate_limit", rateLimitRequest{Limit: 0, PeriodMs: 1000}, nil); code != http.StatusBadRequest {
		t.Errorf("invalid rate limit returned %d, want 400", code)
	}
	var queues struct {
		Queues []*queueStateSnapshot `json:"queues"`
	}
	if code := e.do("GET", "/api/queues", nil, &queues); code != http.StatusOK || len(queues.Queues) != 1 {
		t.Fatalf("queues returned %d: %+v", code, queues)
	}
	q := queues.Queues[0]
	if q.Category != "Media" || q.Subcategory != "Video" || q.RateLimit == nil || q.RateLimit.Limit != 10 || q.RateLimit.Available != 2 {
		t.Errorf("queue snapshot = %+v (rate limit %+v)", q, q.RateLimit)
	}
	var md struct {
		Metadata map[string]queueMetadata `json:"metadata"`
	}
	if code := e.do("GET", "/api/queue_metadata", nil, &md); code != http.StatusOK || md.Metadata["video"].Category != "Media" {
		t.Errorf("queue_metadata returned %d: %+v", code, md)
	}
	if code := e.do("DELETE", "/api/queues/video/rate_limit", nil, nil); code != http.StatusNoContent {
		t.Errorf("remove rate limit returned %d", code)
	}

	if code := e.do("POST", "/api/rate_limits/openai:gpt", rateLimitRequest{Limit: 500, PeriodMs: 60000}, nil); code != http.StatusNoContent {
		t.Fatalf("set key rate limit returned %d", code)
	}
	var limits struct {
		RateLimits []keyRateLimit `json:"rate_limits"`
	}
	if code := e.do("GET", "/api/rate_limits", nil, &limits); code != http.StatusOK || len(limits.RateLimits) != 1 ||
		limits.RateLimits[0].Key != "openai:gpt" || limits.RateLimits[0].Limit != 500 {
		t.Errorf("rate_limits returned %d: %+v", code, limits)
	}
	if code := e.do("DELETE", "/api/rate_limits/openai:gpt", nil, nil); code != http.StatusNoContent {
		t.Errorf("remove key rate limit returned %d", code)
	}
}

func TestGroupAndFlowEndpoints(t *testing.T) {
	e := newObservabilityTestEnv(t)
	for i := 0; i < 3; i++ {
		if _, err := e.client.Enqueue(asynq.NewTask("llm:classify", []byte(`{"doc":1}`)), asynq.Queue("llm"), asynq.Group("docs")); err != nil {
			t.Fatal(err)
		}
	}
	if code := e.do("POST", "/api/queues/llm/groups/docs:flush", nil, nil); code != http.StatusNoContent {
		t.Fatalf("flush returned %d", code)
	}
	var groups listGroupsResponse
	if code := e.do("GET", "/api/queues/llm/groups", nil, &groups); code != http.StatusOK || len(groups.Groups) != 1 {
		t.Fatalf("groups returned %d: %+v", code, groups)
	}
	if g := groups.Groups[0]; g.Size != 3 || !g.FlushRequested || g.OldestTaskAt == "" {
		t.Errorf("group = %+v", g)
	}

	flow := asynq.NewFlow("docs").Then("llm:batch", "docs:index", nil)
	mux := asynq.NewServeMux()
	mux.HandleBatchFunc("llm:batch", func(ctx context.Context, b *asynq.Batch) error {
		_, err := asynq.EnqueueChild(ctx, asynq.NewTask("docs:audit", nil))
		return err
	})
	mux.HandleFunc("docs:", func(context.Context, *asynq.Task) error { return nil })
	e.process(mux, asynq.Config{
		Queues: map[string]int{"llm": 1},
		GroupAggregator: asynq.GroupAggregatorFunc(func(group string, tasks []*asynq.Task) *asynq.Task {
			return asynq.NewBatchTask("llm:batch", tasks, asynq.Retention(time.Hour))
		}),
		GroupGracePeriod: time.Second,
		Flows:            []*asynq.Flow{flow},
	}, 4*time.Second)

	var flows struct {
		Flows []flowInfo `json:"flows"`
	}
	if code := e.do("GET", "/api/flows", nil, &flows); code != http.StatusOK || len(flows.Flows) != 1 || flows.Flows[0].Name != "docs" {
		t.Fatalf("flows returned %d: %+v", code, flows)
	}
	var runs struct {
		Runs []flowRun `json:"runs"`
	}
	if code := e.do("GET", "/api/flow_runs?flow=docs", nil, &runs); code != http.StatusOK || len(runs.Runs) != 1 {
		t.Fatalf("flow_runs returned %d: %+v", code, runs)
	}
	var run flowRun
	if code := e.do("GET", "/api/flow_runs/"+runs.Runs[0].ID, nil, &run); code != http.StatusOK {
		t.Fatalf("flow run returned %d", code)
	}
	if run.State != "completed" || len(run.Nodes) != 3 || run.RootType != "llm:batch" {
		t.Errorf("run = %+v", run)
	}
	if code := e.do("GET", "/api/flow_runs/nope", nil, nil); code != http.StatusNotFound {
		t.Errorf("unknown flow run returned %d, want 404", code)
	}

	// The completed batch task lists its items.
	var task taskInfo
	if code := e.do("GET", "/api/queues/llm/tasks/"+run.RootID, nil, &task); code != http.StatusOK {
		t.Fatalf("task returned %d", code)
	}
	if task.BatchSize != 3 || len(task.BatchItems) != 3 || task.BatchItems[0].Type != "llm:classify" {
		t.Errorf("batch task: size=%d items=%+v", task.BatchSize, task.BatchItems)
	}
}
