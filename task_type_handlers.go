package asynqmon

import (
	"errors"
	"net/http"
	"sort"

	"github.com/gorilla/mux"

	"github.com/hibiken/asynq"
)

// ****************************************************************************
// This file defines:
//   - http.Handler(s) for task type breakdown endpoints
// ****************************************************************************

const (
	// taskTypeScanPageSize is the number of tasks fetched from redis per request.
	taskTypeScanPageSize = 1000
	// taskTypeScanMaxPerState caps the number of tasks inspected per task state
	// so that the endpoint stays cheap on very large queues.
	taskTypeScanMaxPerState = 10000
)

type taskTypeStats struct {
	Type   string         `json:"type"`
	Total  int            `json:"total"`
	States map[string]int `json:"states"`
}

type listTaskTypesResponse struct {
	Queue string           `json:"queue"`
	Types []*taskTypeStats `json:"types"`
	// Number of tasks inspected to compute the breakdown.
	Scanned int `json:"scanned"`
	// Truncated is true if at least one task state had more tasks than the scan limit,
	// in which case the counts are a lower bound.
	Truncated bool `json:"truncated"`
	// Maximum number of tasks inspected per task state.
	MaxPerState int `json:"max_per_state"`
}

type listTasksFunc func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error)

// newListTaskTypesHandlerFunc returns a handler that reports how many tasks of each
// task type exist in the queue, broken down by task state.
func newListTaskTypesHandlerFunc(inspector *asynq.Inspector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		qname := mux.Vars(r)["qname"]

		listers := map[string]listTasksFunc{
			"active": func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListActiveTasks(qname, opts...)
			},
			"pending": func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListPendingTasks(qname, opts...)
			},
			"scheduled": func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListScheduledTasks(qname, opts...)
			},
			"retry": func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListRetryTasks(qname, opts...)
			},
			"archived": func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListArchivedTasks(qname, opts...)
			},
			"completed": func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListCompletedTasks(qname, opts...)
			},
		}

		resp := listTaskTypesResponse{Queue: qname, MaxPerState: taskTypeScanMaxPerState}
		byType := make(map[string]*taskTypeStats)
		record := func(state string, tasks []*asynq.TaskInfo) {
			for _, t := range tasks {
				s, ok := byType[t.Type]
				if !ok {
					s = &taskTypeStats{Type: t.Type, States: make(map[string]int)}
					byType[t.Type] = s
				}
				s.Total++
				s.States[state]++
			}
			resp.Scanned += len(tasks)
		}

		for state, list := range listers {
			truncated, err := scanTasks(list, func(tasks []*asynq.TaskInfo) { record(state, tasks) })
			if err != nil {
				writeTaskTypesError(w, err)
				return
			}
			resp.Truncated = resp.Truncated || truncated
		}

		groups, err := inspector.Groups(qname)
		if err != nil {
			writeTaskTypesError(w, err)
			return
		}
		for _, g := range groups {
			gname := g.Group
			list := func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				return inspector.ListAggregatingTasks(qname, gname, opts...)
			}
			truncated, err := scanTasks(list, func(tasks []*asynq.TaskInfo) { record("aggregating", tasks) })
			if err != nil {
				writeTaskTypesError(w, err)
				return
			}
			resp.Truncated = resp.Truncated || truncated
		}

		resp.Types = make([]*taskTypeStats, 0, len(byType))
		for _, s := range byType {
			resp.Types = append(resp.Types, s)
		}
		sort.Slice(resp.Types, func(i, j int) bool {
			if resp.Types[i].Total == resp.Types[j].Total {
				return resp.Types[i].Type < resp.Types[j].Type
			}
			return resp.Types[i].Total > resp.Types[j].Total
		})
		writeResponseJSON(w, resp)
	}
}

// scanTasks pages through the tasks returned by list and calls fn with each page,
// up to taskTypeScanMaxPerState tasks. It reports whether more tasks were left unscanned.
func scanTasks(list listTasksFunc, fn func([]*asynq.TaskInfo)) (truncated bool, err error) {
	seen := 0
	for page := 1; ; page++ {
		tasks, err := list(asynq.PageSize(taskTypeScanPageSize), asynq.Page(page))
		if err != nil {
			return false, err
		}
		fn(tasks)
		seen += len(tasks)
		if len(tasks) < taskTypeScanPageSize {
			return false, nil
		}
		if seen >= taskTypeScanMaxPerState {
			return true, nil
		}
	}
}

func writeTaskTypesError(w http.ResponseWriter, err error) {
	if errors.Is(err, asynq.ErrQueueNotFound) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	http.Error(w, err.Error(), http.StatusInternalServerError)
}
