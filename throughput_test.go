package asynqdash

import (
	"context"
	"os"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

func TestComputeThroughputDelta(t *testing.T) {
	t0 := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	base := queueSample{Time: t0, Unfinished: 10, Archived: 2, Processed: 100, Failed: 5}
	at := func(d time.Duration, f func(s *queueSample)) queueSample {
		s := base
		s.Time = t0.Add(d)
		f(&s)
		return s
	}

	tests := []struct {
		desc   string
		prev   queueSample
		cur    queueSample
		want   throughputDelta
		wantOK bool
	}{
		{
			desc:   "tasks enqueued",
			prev:   base,
			cur:    at(10*time.Second, func(s *queueSample) { s.Unfinished += 3 }),
			want:   throughputDelta{Enqueued: 3},
			wantOK: true,
		},
		{
			desc: "tasks processed successfully leave the queue",
			prev: base,
			cur: at(10*time.Second, func(s *queueSample) {
				s.Unfinished -= 4
				s.Processed += 4
			}),
			want:   throughputDelta{Processed: 4},
			wantOK: true,
		},
		{
			desc: "failed task is retried: it stays unfinished",
			prev: base,
			cur: at(10*time.Second, func(s *queueSample) {
				s.Processed++
				s.Failed++
			}),
			want:   throughputDelta{Processed: 1, Failed: 1},
			wantOK: true,
		},
		{
			desc: "failed task is archived",
			prev: base,
			cur: at(10*time.Second, func(s *queueSample) {
				s.Unfinished--
				s.Archived++
				s.Processed++
				s.Failed++
			}),
			want:   throughputDelta{Processed: 1, Failed: 1},
			wantOK: true,
		},
		{
			desc: "enqueued and processed in the same interval",
			prev: base,
			cur: at(10*time.Second, func(s *queueSample) {
				s.Unfinished += 2 // 7 enqueued, 5 succeeded
				s.Processed += 5
			}),
			want:   throughputDelta{Enqueued: 7, Processed: 5},
			wantOK: true,
		},
		{
			desc:   "deleted tasks do not count as negative enqueued",
			prev:   base,
			cur:    at(10*time.Second, func(s *queueSample) { s.Unfinished -= 5 }),
			want:   throughputDelta{},
			wantOK: true,
		},
		{
			desc:   "no previous sample",
			prev:   queueSample{},
			cur:    base,
			wantOK: false,
		},
		{
			desc:   "samples too far apart",
			prev:   base,
			cur:    at(throughputMaxSampleGap+time.Second, func(s *queueSample) { s.Unfinished++ }),
			wantOK: false,
		},
		{
			desc:   "counters were reset",
			prev:   base,
			cur:    at(10*time.Second, func(s *queueSample) { s.Processed = 0; s.Failed = 0 }),
			wantOK: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			got, ok := computeThroughputDelta(tc.prev, tc.cur)
			if ok != tc.wantOK {
				t.Fatalf("computeThroughputDelta ok = %v, want %v", ok, tc.wantOK)
			}
			if ok && got != tc.want {
				t.Errorf("computeThroughputDelta = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// fakeList returns a list function over n tasks named "0" (oldest) to "n-1" (newest),
// paginated like asynq.
func fakeList(n int) func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
	return func(opts ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
		// The option types are unexported: tell them apart with reflection.
		size, page := 30, 1
		for _, opt := range opts {
			v := int(reflect.ValueOf(opt).Int())
			if reflect.TypeOf(opt) == reflect.TypeOf(asynq.PageSize(0)) {
				size = v
			} else {
				page = v
			}
		}
		var tasks []*asynq.TaskInfo
		for i := (page - 1) * size; i < page*size && i < n; i++ {
			tasks = append(tasks, &asynq.TaskInfo{ID: strconv.Itoa(i)})
		}
		return tasks, nil
	}
}

func ids(tasks []*asynq.TaskInfo) []string {
	res := []string{}
	for _, t := range tasks {
		res = append(res, t.ID)
	}
	return res
}

func TestListTasksInOrder(t *testing.T) {
	tests := []struct {
		desc              string
		total, size, page int
		order             string
		want              []string
	}{
		{"asc first page", 7, 3, 1, "asc", []string{"0", "1", "2"}},
		{"asc last page", 7, 3, 3, "asc", []string{"6"}},
		{"desc first page", 7, 3, 1, "desc", []string{"6", "5", "4"}},
		{"desc second page spans two asynq pages", 7, 3, 2, "desc", []string{"3", "2", "1"}},
		{"desc last page is partial", 7, 3, 3, "desc", []string{"0"}},
		{"desc past the end", 7, 3, 4, "desc", []string{}},
		{"desc aligned pages", 6, 3, 1, "desc", []string{"5", "4", "3"}},
		{"desc empty list", 0, 3, 1, "desc", []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			got, err := listTasksInOrder(fakeList(tc.total), tc.total, tc.size, tc.page, tc.order)
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(tc.want, ids(got)); diff != "" {
				t.Errorf("listTasksInOrder: (-want,+got)\n%s", diff)
			}
		})
	}
}

func TestTruncatingPayloadFormatter(t *testing.T) {
	f := truncatingPayloadFormatter(DefaultPayloadFormatter, 5)
	if got := f.FormatPayload("t", []byte("héllo world")); got != "héllo…" {
		t.Errorf("truncated payload = %q, want %q", got, "héllo…")
	}
	if got := f.FormatPayload("t", []byte("short")); got != "short" {
		t.Errorf("short payload = %q, want unchanged", got)
	}
	if got := truncatingPayloadFormatter(DefaultPayloadFormatter, 0).FormatPayload("t", []byte("héllo world")); got != "héllo world" {
		t.Errorf("payload with no limit = %q, want unchanged", got)
	}
}

// TestThroughputCollector runs against a real redis server, given by ASYNQDASH_TEST_REDIS_ADDR.
func TestThroughputCollector(t *testing.T) {
	addr := os.Getenv("ASYNQDASH_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("set ASYNQDASH_TEST_REDIS_ADDR to run this test")
	}
	ctx := context.Background()
	connOpt := asynq.RedisClientOpt{Addr: addr, DB: 14}
	rc := connOpt.MakeRedisClient().(redis.UniversalClient)
	defer rc.Close()
	if err := rc.FlushDB(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	inspector := asynq.NewInspector(connOpt)
	defer inspector.Close()
	client := asynq.NewClient(connOpt)
	defer client.Close()

	c := newThroughputCollector(rc, inspector)
	now := time.Now().Truncate(time.Minute).Add(5 * time.Second)

	enqueue := func(n int) {
		for i := 0; i < n; i++ {
			if _, err := client.Enqueue(asynq.NewTask("test", nil), asynq.Queue("throughput")); err != nil {
				t.Fatal(err)
			}
		}
	}
	enqueue(1) // creates the queue
	if err := c.tick(ctx, now); err != nil {
		t.Fatal(err)
	}
	enqueue(4)
	if err := c.tick(ctx, now.Add(10*time.Second)); err != nil {
		t.Fatal(err)
	}
	// A second instance in the same tick does not record twice.
	if err := c.tick(ctx, now.Add(12*time.Second)); err != nil {
		t.Fatal(err)
	}
	enqueue(2)
	if err := c.tick(ctx, now.Add(20*time.Second)); err != nil {
		t.Fatal(err)
	}

	minute := now.Truncate(time.Minute).Unix()
	for _, res := range []string{resolutionMinute, resolutionHour} {
		got, err := readThroughput(ctx, rc, []string{"throughput"}, res, now.Add(-time.Hour), now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		bucket := minute
		if res == resolutionHour {
			bucket = now.Truncate(time.Hour).Unix()
		}
		want := map[string][]throughputPoint{"throughput": {{bucket, 6, 0, 0}}}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Errorf("readThroughput(%s): (-want,+got)\n%s", res, diff)
		}
	}
}
