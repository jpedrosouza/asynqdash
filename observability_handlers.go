package asynqdash

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/jpedrosouza/asynq"
)

// ****************************************************************************
// This file defines:
//   - http.Handler(s) for the task metrics, queue metadata, rate limits, group flush and flow endpoints
// ****************************************************************************

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// ---------------------------------------------------------------------------
// Task metrics
// ---------------------------------------------------------------------------

// taskMetricsStats summarizes the processing metrics of a set of tasks. Durations are in milliseconds.
type taskMetricsStats struct {
	Processed int64   `json:"processed"`
	Failed    int64   `json:"failed"`
	TotalMs   int64   `json:"total_ms"`
	AvgMs     float64 `json:"avg_ms"`
	P50Ms     float64 `json:"p50_ms"`
	P95Ms     float64 `json:"p95_ms"`
	P99Ms     float64 `json:"p99_ms"`
	MaxMs     int64   `json:"max_ms"`
	WaitAvgMs float64 `json:"wait_avg_ms"`
	WaitP95Ms float64 `json:"wait_p95_ms"`
	WaitMaxMs int64   `json:"wait_max_ms"`
}

func toTaskMetricsStats(m *asynq.TaskMetrics) taskMetricsStats {
	ms := func(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }
	return taskMetricsStats{
		Processed: m.Processed,
		Failed:    m.Failed,
		TotalMs:   m.TotalDuration.Milliseconds(),
		AvgMs:     ms(m.AvgDuration()),
		P50Ms:     ms(m.DurationPercentile(50)),
		P95Ms:     ms(m.DurationPercentile(95)),
		P99Ms:     ms(m.DurationPercentile(99)),
		MaxMs:     m.MaxDuration.Milliseconds(),
		WaitAvgMs: ms(m.AvgWait()),
		WaitP95Ms: ms(m.WaitPercentile(95)),
		WaitMaxMs: m.MaxWait.Milliseconds(),
	}
}

type taskMetricsPoint struct {
	// Time is the start of the bucket in unix seconds.
	Time int64 `json:"time"`
	taskMetricsStats
}

type taskTypeMetrics struct {
	Type string `json:"type"`
	taskMetricsStats
}

type taskMetricsResponse struct {
	Queue      string             `json:"queue"`
	Resolution string             `json:"resolution"`
	Start      int64              `json:"start"`
	End        int64              `json:"end"`
	Types      []string           `json:"types"`
	Points     []taskMetricsPoint `json:"points"`
	Summary    taskMetricsStats   `json:"summary"`
	ByType     []taskTypeMetrics  `json:"by_type"`
}

// Limits of the time range of the task metrics endpoint, by resolution.
var maxTaskMetricsRange = map[string]time.Duration{
	resolutionMinute: 48 * time.Hour,
	resolutionHour:   91 * 24 * time.Hour,
}

func parseUnixParam(r *http.Request, name string, def time.Time) (time.Time, error) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s: %q", name, v)
	}
	return time.Unix(n, 0), nil
}

// newGetTaskMetricsHandlerFunc returns the processing metrics recorded by the asynq servers for the tasks of a queue:
// a time series of durations and counts, and a summary by task type.
//
// Query parameters: resolution ("minute" or "hour"), start and end (unix seconds), type (a task type to filter by).
func newGetTaskMetricsHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		qname := mux.Vars(r)["qname"]
		q := r.URL.Query()
		resolution := q.Get("resolution")
		if resolution == "" {
			resolution = resolutionMinute
		}
		var step time.Duration
		switch resolution {
		case resolutionMinute:
			step = time.Minute
		case resolutionHour:
			step = time.Hour
		default:
			http.Error(w, fmt.Sprintf("invalid resolution %q", resolution), http.StatusBadRequest)
			return
		}
		now := time.Now()
		end, err := parseUnixParam(r, "end", now)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		start, err := parseUnixParam(r, "start", end.Add(-time.Hour))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if !start.Before(end) {
			http.Error(w, "start must be before end", http.StatusBadRequest)
			return
		}
		if end.Sub(start) > maxTaskMetricsRange[resolution] {
			http.Error(w, "time range is too large for the resolution", http.StatusBadRequest)
			return
		}
		points, err := inspector.TaskMetrics(qname, step, start, end)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		filter := q.Get("type")
		resp := taskMetricsResponse{
			Queue:      qname,
			Resolution: resolution,
			Start:      start.Unix(),
			End:        end.Unix(),
			Types:      []string{},
			Points:     []taskMetricsPoint{},
			ByType:     []taskTypeMetrics{},
		}
		summary := &asynq.TaskMetrics{}
		byType := map[string]*asynq.TaskMetrics{}
		for _, p := range points {
			total := &asynq.TaskMetrics{}
			for typename, m := range p.Types {
				if _, ok := byType[typename]; !ok {
					byType[typename] = &asynq.TaskMetrics{}
				}
				byType[typename].Merge(m)
				if filter == "" || filter == typename {
					total.Merge(m)
				}
			}
			if total.Processed == 0 && total.Failed == 0 {
				continue
			}
			summary.Merge(total)
			resp.Points = append(resp.Points, taskMetricsPoint{Time: p.Time.Unix(), taskMetricsStats: toTaskMetricsStats(total)})
		}
		resp.Summary = toTaskMetricsStats(summary)
		for typename, m := range byType {
			resp.Types = append(resp.Types, typename)
			resp.ByType = append(resp.ByType, taskTypeMetrics{Type: typename, taskMetricsStats: toTaskMetricsStats(m)})
		}
		sort.Strings(resp.Types)
		// Slowest first: by total time spent, which is what an optimization would save.
		sort.Slice(resp.ByType, func(i, j int) bool { return resp.ByType[i].TotalMs > resp.ByType[j].TotalMs })
		writeJSON(w, resp)
	}
}

// ---------------------------------------------------------------------------
// Queue metadata
// ---------------------------------------------------------------------------

type queueMetadata struct {
	Category    string `json:"category"`
	Subcategory string `json:"subcategory"`
	Description string `json:"description"`
}

func newListQueueMetadataHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		all, err := inspector.ListQueueMetadata()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		res := make(map[string]queueMetadata, len(all))
		for qname, md := range all {
			res[qname] = queueMetadata{Category: md.Category, Subcategory: md.Subcategory, Description: md.Description}
		}
		writeJSON(w, map[string]interface{}{"metadata": res})
	}
}

func newSetQueueMetadataHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		qname := mux.Vars(r)["qname"]
		var req queueMetadata
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		md := asynq.QueueMetadata{Category: req.Category, Subcategory: req.Subcategory, Description: req.Description}
		if err := inspector.SetQueueMetadata(qname, md); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

type rateLimitRequest struct {
	Limit    int   `json:"limit"`
	PeriodMs int64 `json:"period_ms"`
	Burst    int   `json:"burst"`
}

func decodeRateLimit(w http.ResponseWriter, r *http.Request) (asynq.RateLimit, bool) {
	var req rateLimitRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return asynq.RateLimit{}, false
	}
	if req.Limit < 1 || req.PeriodMs < 1 || req.Burst < 0 {
		http.Error(w, "limit and period_ms must be positive, burst cannot be negative", http.StatusBadRequest)
		return asynq.RateLimit{}, false
	}
	return asynq.RateLimit{Limit: req.Limit, Period: time.Duration(req.PeriodMs) * time.Millisecond, Burst: req.Burst}, true
}

func newSetQueueRateLimitHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rl, ok := decodeRateLimit(w, r)
		if !ok {
			return
		}
		if err := inspector.SetQueueRateLimit(mux.Vars(r)["qname"], rl); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func newRemoveQueueRateLimitHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := inspector.RemoveQueueRateLimit(mux.Vars(r)["qname"]); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type keyRateLimit struct {
	Key string `json:"key"`
	rateLimitInfo
}

func newListRateLimitsHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		all, err := inspector.RateLimits()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		res := make([]keyRateLimit, 0, len(all))
		for key, rl := range all {
			res = append(res, keyRateLimit{Key: key, rateLimitInfo: *toRateLimitInfo(rl)})
		}
		sort.Slice(res, func(i, j int) bool { return res[i].Key < res[j].Key })
		writeJSON(w, map[string]interface{}{"rate_limits": res})
	}
}

func newSetRateLimitHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rl, ok := decodeRateLimit(w, r)
		if !ok {
			return
		}
		if err := inspector.SetRateLimit(mux.Vars(r)["key"], rl); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func newRemoveRateLimitHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := inspector.RemoveRateLimit(mux.Vars(r)["key"]); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

func newFlushGroupHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		if err := inspector.FlushGroup(vars["qname"], vars["gname"]); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

type flowStep struct {
	From []string `json:"from"`
	To   string   `json:"to"`
	Join bool     `json:"join"`
}

type flowInfo struct {
	Name      string     `json:"name"`
	Steps     []flowStep `json:"steps"`
	UpdatedAt string     `json:"updated_at"`
}

func newListFlowsHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flows, err := inspector.Flows()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		res := make([]flowInfo, len(flows))
		for i, f := range flows {
			fi := flowInfo{Name: f.Name, UpdatedAt: formatTimeInRFC3339(f.UpdatedAt), Steps: []flowStep{}}
			for _, st := range f.Steps {
				fi.Steps = append(fi.Steps, flowStep{From: st.From, To: st.To, Join: st.Join})
			}
			res[i] = fi
		}
		writeJSON(w, map[string]interface{}{"flows": res})
	}
}

func newDeleteFlowHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := inspector.DeleteFlow(mux.Vars(r)["name"]); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type flowNode struct {
	ID         string   `json:"id"`
	Queue      string   `json:"queue"`
	Type       string   `json:"type"`
	Parents    []string `json:"parents"`
	State      string   `json:"state"`
	EnqueuedAt string   `json:"enqueued_at,omitempty"`
	StartedAt  string   `json:"started_at,omitempty"`
	DurationMs int64    `json:"duration_ms"`
	Error      string   `json:"error,omitempty"`
	Result     string   `json:"result,omitempty"`
}

type flowRun struct {
	ID        string     `json:"id"`
	Flow      string     `json:"flow"`
	RootID    string     `json:"root_id"`
	RootQueue string     `json:"root_queue"`
	RootType  string     `json:"root_type"`
	State     string     `json:"state"`
	CreatedAt string     `json:"created_at"`
	UpdatedAt string     `json:"updated_at"`
	Nodes     []flowNode `json:"nodes"`
}

func toFlowRun(run *asynq.FlowRunInfo, rf ResultFormatter) flowRun {
	res := flowRun{
		ID:        run.ID,
		Flow:      run.Flow,
		RootID:    run.RootID,
		RootQueue: run.RootQueue,
		RootType:  run.RootType,
		State:     run.State,
		CreatedAt: formatTimeMillis(run.CreatedAt),
		UpdatedAt: formatTimeInRFC3339(run.UpdatedAt),
		Nodes:     []flowNode{},
	}
	for _, n := range run.Nodes {
		parents := n.Parents
		if parents == nil {
			parents = []string{}
		}
		node := flowNode{
			ID:         n.ID,
			Queue:      n.Queue,
			Type:       n.Type,
			Parents:    parents,
			State:      n.State,
			EnqueuedAt: formatTimeMillis(n.EnqueuedAt),
			StartedAt:  formatTimeMillis(n.StartedAt),
			DurationMs: n.Duration.Milliseconds(),
			Error:      n.Error,
		}
		if rf != nil && len(n.Result) > 0 {
			node.Result = rf.FormatResult(n.Type, n.Result)
		}
		res.Nodes = append(res.Nodes, node)
	}
	return res
}

func newListFlowRunsHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize, pageNum := getPageOptions(r)
		runs, err := inspector.FlowRuns(r.URL.Query().Get("flow"), asynq.PageSize(pageSize), asynq.Page(pageNum))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		res := make([]flowRun, len(runs))
		for i, run := range runs {
			res[i] = toFlowRun(run, nil)
		}
		writeJSON(w, map[string]interface{}{"runs": res})
	}
}

func newGetFlowRunHandlerFunc(inspector *asynq.Inspector, rf ResultFormatter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		run, err := inspector.GetFlowRun(mux.Vars(r)["run_id"])
		if errors.Is(err, asynq.ErrFlowRunNotFound) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, toFlowRun(run, rf))
	}
}
