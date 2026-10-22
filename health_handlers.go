package asynqmon

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// ****************************************************************************
// This file defines:
//   - http.Handler(s) for health check endpoints
// ****************************************************************************

type healthResponse struct {
	Status string `json:"status"`
	Redis  string `json:"redis"`
	Error  string `json:"error,omitempty"`
}

// newHealthHandlerFunc returns a handler that reports whether asynqmon can reach redis.
// It responds with 200 when redis is reachable and 503 otherwise, so it can be used
// as a liveness/readiness probe.
func newHealthHandlerFunc(rc redis.UniversalClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		resp := healthResponse{Status: "ok", Redis: "ok"}
		status := http.StatusOK
		if err := rc.Ping(ctx).Err(); err != nil {
			resp = healthResponse{Status: "unavailable", Redis: "unreachable", Error: err.Error()}
			status = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(resp)
	}
}
