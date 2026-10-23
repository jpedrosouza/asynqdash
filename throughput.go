package asynqdash

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

// ****************************************************************************
// This file defines:
//   - throughputCollector, which records how many tasks enter and leave each queue
//   - http.Handler for the throughput endpoint
// ****************************************************************************

// asynq only keeps daily processed/failed counters (per UTC date), and does not count enqueued tasks.
// The collector samples the queue counters periodically and stores the deltas in per-minute and
// per-hour buckets, so the UI can show recent activity at a finer resolution and in any time zone.
//
// The number of enqueued tasks is derived from the samples: tasks that entered the queue are the
// change in the number of unfinished tasks (pending, active, scheduled, retry and aggregating),
// plus the tasks that left them by succeeding or by being archived. Tasks deleted by hand are
// not seen as such, so the value is an estimate.

const (
	throughputTickInterval = 10 * time.Second

	// Samples further apart than this are not compared: the collector was not running in between,
	// and the changes cannot be attributed to a minute.
	throughputMaxSampleGap = 2 * time.Minute

	throughputMinuteRetention = 3 * time.Hour
	throughputHourRetention   = 91 * 24 * time.Hour

	throughputKeyPrefix = "asynqdash:"
)

// Throughput resolutions accepted by the API.
const (
	resolutionMinute = "minute"
	resolutionHour   = "hour"
)

// Metric suffixes of the bucket hash fields.
const (
	metricEnqueued  = "e"
	metricProcessed = "p"
	metricFailed    = "f"
)

// The queue name is used as a hash tag so that every key of a queue lives in the same cluster slot.
func throughputSnapshotKey(qname string) string {
	return fmt.Sprintf("%s{%s}:throughput:last", throughputKeyPrefix, qname)
}

// Minute buckets are grouped by hour, hour buckets by day (UTC), so each key can simply expire.
func throughputMinuteKey(qname string, hour time.Time) string {
	return fmt.Sprintf("%s{%s}:throughput:m:%d", throughputKeyPrefix, qname, hour.Unix())
}

func throughputHourKey(qname string, day time.Time) string {
	return fmt.Sprintf("%s{%s}:throughput:h:%d", throughputKeyPrefix, qname, day.Unix())
}

func throughputTickKey(tick time.Time) string {
	return fmt.Sprintf("%sthroughput:tick:%d", throughputKeyPrefix, tick.Unix())
}

func truncateDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// queueSample holds the counters of a queue at a point in time.
type queueSample struct {
	Time       time.Time
	Unfinished int64 // pending + active + scheduled + retry + aggregating
	Archived   int64
	Processed  int64 // cumulative, includes failed
	Failed     int64 // cumulative
}

func sampleFromQueueInfo(info *asynq.QueueInfo, now time.Time) queueSample {
	return queueSample{
		Time:       now,
		Unfinished: int64(info.Pending + info.Active + info.Scheduled + info.Retry + info.Aggregating),
		Archived:   int64(info.Archived),
		Processed:  int64(info.ProcessedTotal),
		Failed:     int64(info.FailedTotal),
	}
}

// throughputDelta is the activity of a queue between two samples.
type throughputDelta struct {
	Enqueued  int64
	Processed int64
	Failed    int64
}

func nonNegative(n int64) int64 {
	if n < 0 {
		return 0
	}
	return n
}

// computeThroughputDelta returns the activity between prev and cur.
// It returns false if the samples cannot be compared.
func computeThroughputDelta(prev, cur queueSample) (throughputDelta, bool) {
	if prev.Time.IsZero() || !cur.Time.After(prev.Time) || cur.Time.Sub(prev.Time) > throughputMaxSampleGap {
		return throughputDelta{}, false
	}
	processed := cur.Processed - prev.Processed
	failed := cur.Failed - prev.Failed
	if processed < 0 || failed < 0 {
		// Counters were reset, e.g. the queue was deleted and created again.
		return throughputDelta{}, false
	}
	succeeded := processed - failed
	enqueued := (cur.Unfinished - prev.Unfinished) + succeeded + (cur.Archived - prev.Archived)
	return throughputDelta{
		Enqueued:  nonNegative(enqueued),
		Processed: processed,
		Failed:    failed,
	}, true
}

// throughputCollector samples every queue periodically and records the activity in redis.
// When several asynqdash instances share a redis server, only one of them records each tick.
type throughputCollector struct {
	rc        redis.UniversalClient
	inspector *asynq.Inspector
	interval  time.Duration

	cancel context.CancelFunc
	done   chan struct{}
}

func newThroughputCollector(rc redis.UniversalClient, inspector *asynq.Inspector) *throughputCollector {
	return &throughputCollector{rc: rc, inspector: inspector, interval: throughputTickInterval}
}

func (c *throughputCollector) start() {
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.done = make(chan struct{})
	go func() {
		defer close(c.done)
		ticker := time.NewTicker(c.interval)
		defer ticker.Stop()
		for {
			if err := c.tick(ctx, time.Now()); err != nil && ctx.Err() == nil {
				log.Printf("asynqdash: throughput collector: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// stop stops the collector and waits for the current tick to finish.
func (c *throughputCollector) stop() error {
	if c.cancel != nil {
		c.cancel()
		<-c.done
	}
	return nil
}

func (c *throughputCollector) tick(ctx context.Context, now time.Time) error {
	tick := now.Truncate(c.interval)
	ok, err := c.rc.SetNX(ctx, throughputTickKey(tick), 1, time.Minute).Result()
	if err != nil {
		return err
	}
	if !ok {
		return nil // Another instance records this tick.
	}
	qnames, err := c.inspector.Queues()
	if err != nil {
		return err
	}
	infos, err := getQueueInfos(c.inspector, qnames)
	if err != nil {
		return err
	}
	for _, info := range infos {
		if err := c.record(ctx, info.Queue, sampleFromQueueInfo(info, now)); err != nil {
			return err
		}
	}
	return nil
}

// record compares the sample with the previous one of the queue, adds the activity in between
// to the buckets of the current minute and hour, and saves the sample.
func (c *throughputCollector) record(ctx context.Context, qname string, cur queueSample) error {
	snapshotKey := throughputSnapshotKey(qname)
	prev, err := c.loadSample(ctx, snapshotKey)
	if err != nil {
		return err
	}

	pipe := c.rc.Pipeline()
	if delta, ok := computeThroughputDelta(prev, cur); ok {
		minute := cur.Time.UTC().Truncate(time.Minute)
		hour := cur.Time.UTC().Truncate(time.Hour)
		minuteKey := throughputMinuteKey(qname, hour)
		hourKey := throughputHourKey(qname, truncateDay(cur.Time))
		// Fields are written even when the delta is zero: an existing field means the bucket was observed.
		for _, b := range []struct {
			key    string
			bucket time.Time
		}{{minuteKey, minute}, {hourKey, hour}} {
			prefix := strconv.FormatInt(b.bucket.Unix(), 10) + ":"
			pipe.HIncrBy(ctx, b.key, prefix+metricEnqueued, delta.Enqueued)
			pipe.HIncrBy(ctx, b.key, prefix+metricProcessed, delta.Processed)
			pipe.HIncrBy(ctx, b.key, prefix+metricFailed, delta.Failed)
		}
		pipe.Expire(ctx, minuteKey, throughputMinuteRetention+time.Hour)
		pipe.Expire(ctx, hourKey, throughputHourRetention+24*time.Hour)
	}
	pipe.HSet(ctx, snapshotKey,
		"time", cur.Time.UnixNano(),
		"unfinished", cur.Unfinished,
		"archived", cur.Archived,
		"processed", cur.Processed,
		"failed", cur.Failed,
	)
	pipe.Expire(ctx, snapshotKey, time.Hour)
	_, err = pipe.Exec(ctx)
	return err
}

func (c *throughputCollector) loadSample(ctx context.Context, key string) (queueSample, error) {
	vals, err := c.rc.HGetAll(ctx, key).Result()
	if err != nil {
		return queueSample{}, err
	}
	if len(vals) == 0 {
		return queueSample{}, nil
	}
	n := func(field string) int64 {
		v, _ := strconv.ParseInt(vals[field], 10, 64)
		return v
	}
	return queueSample{
		Time:       time.Unix(0, n("time")),
		Unfinished: n("unfinished"),
		Archived:   n("archived"),
		Processed:  n("processed"),
		Failed:     n("failed"),
	}, nil
}

// throughputPoint is the activity of a queue during one bucket: [time (unix seconds), enqueued, processed, failed].
// Processed includes failed tasks.
type throughputPoint [4]int64

type throughputResponse struct {
	Resolution string `json:"resolution"`
	// Start and end (unix seconds) of the requested period.
	Start int64 `json:"start"`
	End   int64 `json:"end"`
	// Whether the collector runs in this asynqdash instance.
	CollectorEnabled bool `json:"collector_enabled"`
	// Points of each queue, sorted by time. Buckets that were not observed by the collector are omitted.
	Queues map[string][]throughputPoint `json:"queues"`
}

// readThroughput returns the buckets of the given queues between start and end.
func readThroughput(ctx context.Context, rc redis.UniversalClient, qnames []string, resolution string, start, end time.Time) (map[string][]throughputPoint, error) {
	var step time.Duration
	var keyStep time.Duration
	var keyFn func(qname string, t time.Time) string
	switch resolution {
	case resolutionMinute:
		step, keyStep, keyFn = time.Minute, time.Hour, throughputMinuteKey
	case resolutionHour:
		step, keyStep, keyFn = time.Hour, 24*time.Hour, throughputHourKey
	default:
		return nil, fmt.Errorf("unsupported resolution %q", resolution)
	}
	first := start.UTC().Truncate(step)

	type keyCmd struct {
		qname string
		cmd   *redis.MapStringStringCmd
	}
	var cmds []keyCmd
	pipe := rc.Pipeline()
	for _, qname := range qnames {
		// Keys are aligned to hours/days in UTC; Truncate is relative to the zero time, which is UTC-aligned.
		for t := first.Truncate(keyStep); !t.After(end); t = t.Add(keyStep) {
			cmds = append(cmds, keyCmd{qname, pipe.HGetAll(ctx, keyFn(qname, t))})
		}
	}
	if len(cmds) > 0 {
		if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
			return nil, err
		}
	}

	byQueue := make(map[string]map[int64]*throughputPoint)
	for _, kc := range cmds {
		fields, err := kc.cmd.Result()
		if err != nil && err != redis.Nil {
			return nil, err
		}
		points := byQueue[kc.qname]
		if points == nil {
			points = make(map[int64]*throughputPoint)
			byQueue[kc.qname] = points
		}
		for field, value := range fields {
			i := strings.IndexByte(field, ':')
			if i < 0 {
				continue
			}
			ts, err := strconv.ParseInt(field[:i], 10, 64)
			if err != nil || ts < first.Unix() || ts > end.Unix() {
				continue
			}
			n, _ := strconv.ParseInt(value, 10, 64)
			p := points[ts]
			if p == nil {
				p = &throughputPoint{ts}
				points[ts] = p
			}
			switch field[i+1:] {
			case metricEnqueued:
				p[1] = n
			case metricProcessed:
				p[2] = n
			case metricFailed:
				p[3] = n
			}
		}
	}

	res := make(map[string][]throughputPoint, len(qnames))
	for _, qname := range qnames {
		points := make([]throughputPoint, 0, len(byQueue[qname]))
		for t := first; !t.After(end); t = t.Add(step) {
			if p, ok := byQueue[qname][t.Unix()]; ok {
				points = append(points, *p)
			}
		}
		res[qname] = points
	}
	return res, nil
}

// newGetThroughputHandlerFunc returns the activity of queues over a period.
//
// Query parameters:
//   - resolution: "minute" (up to 3 hours) or "hour" (up to 91 days). Default "minute".
//   - duration: length of the period in seconds, ending now. Default 3600.
//   - queue: queue to include; can be repeated. Default every queue.
func newGetThroughputHandlerFunc(rc redis.UniversalClient, inspector *asynq.Inspector, collectorEnabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		resolution := q.Get("resolution")
		if resolution == "" {
			resolution = resolutionMinute
		}
		var maxDuration time.Duration
		switch resolution {
		case resolutionMinute:
			maxDuration = throughputMinuteRetention
		case resolutionHour:
			maxDuration = throughputHourRetention
		default:
			http.Error(w, `resolution must be "minute" or "hour"`, http.StatusBadRequest)
			return
		}
		duration := time.Hour
		if s := q.Get("duration"); s != "" {
			secs, err := strconv.Atoi(s)
			if err != nil || secs <= 0 {
				http.Error(w, "duration must be a positive number of seconds", http.StatusBadRequest)
				return
			}
			duration = time.Duration(secs) * time.Second
		}
		if duration > maxDuration {
			duration = maxDuration
		}

		qnames := q["queue"]
		if len(qnames) == 0 {
			var err error
			if qnames, err = inspector.Queues(); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		end := time.Now()
		start := end.Add(-duration)
		queues, err := readThroughput(r.Context(), rc, qnames, resolution, start, end)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeResponseJSON(w, throughputResponse{
			Resolution:       resolution,
			Start:            start.Unix(),
			End:              end.Unix(),
			CollectorEnabled: collectorEnabled,
			Queues:           queues,
		})
	}
}

// getQueueInfos fetches the info of the given queues concurrently, in batches to bound the load
// on redis. The result has the same order as qnames.
func getQueueInfos(inspector *asynq.Inspector, qnames []string) ([]*asynq.QueueInfo, error) {
	const batchSize = 10
	infos := make([]*asynq.QueueInfo, len(qnames))
	for lo := 0; lo < len(qnames); lo += batchSize {
		hi := lo + batchSize
		if hi > len(qnames) {
			hi = len(qnames)
		}
		errs := make([]error, hi-lo)
		var wg sync.WaitGroup
		for i := lo; i < hi; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				infos[i], errs[i-lo] = inspector.GetQueueInfo(qnames[i])
			}(i)
		}
		wg.Wait()
		for _, err := range errs {
			if err != nil {
				return nil, err
			}
		}
	}
	return infos, nil
}
