package main

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
	"github.com/jpedrosouza/asynq"
)

func TestParseFlags(t *testing.T) {
	tests := []struct {
		args []string
		want *Config
	}{
		{
			args: []string{"--redis-addr", "localhost:6380", "--redis-db", "3"},
			want: &Config{
				RedisAddr: "localhost:6380",
				RedisDB:   3,

				// Default values
				Port:                  8080,
				RootPath:              "/",
				RedisPassword:         "",
				RedisTLS:              "",
				RedisURL:              "",
				RedisInsecureTLS:      false,
				RedisClusterNodes:     "",
				MaxPayloadLength:      200,
				MaxResultLength:       200,
				EnableMetricsExporter: false,
				PrometheusServerAddr:  "",
				ReadOnly:              false,

				Args: []string{},
			},
		},
	}

	for _, tc := range tests {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			cfg, output, err := parseFlags("asynqdash", tc.args)
			if err != nil {
				t.Errorf("parseFlags returned error: %v", err)
			}
			if output != "" {
				t.Errorf("parseFlag returned output=%q, want empty", output)
			}
			if diff := cmp.Diff(tc.want, cfg); diff != "" {
				t.Errorf("parseFlag returned Config %v, want %v; (-want,+got)\n%s", cfg, tc.want, diff)
			}
		})
	}

}

func TestMakeRedisConnOpt(t *testing.T) {
	var tests = []struct {
		desc string
		cfg  *Config
		want asynq.RedisConnOpt
	}{
		{
			desc: "With address, db number and password",
			cfg: &Config{
				RedisAddr:     "localhost:6380",
				RedisDB:       1,
				RedisPassword: "foo",
			},
			want: asynq.RedisClientOpt{
				Addr:     "localhost:6380",
				DB:       1,
				Password: "foo",
			},
		},
		{
			desc: "With TLS server name",
			cfg: &Config{
				RedisAddr: "localhost:6379",
				RedisTLS:  "foobar",
			},
			want: asynq.RedisClientOpt{
				Addr:      "localhost:6379",
				TLSConfig: &tls.Config{ServerName: "foobar"},
			},
		},
		{
			desc: "With redis URL",
			cfg: &Config{
				RedisURL: "redis://:bar@localhost:6381/2",
			},
			want: asynq.RedisClientOpt{
				Addr:     "localhost:6381",
				DB:       2,
				Password: "bar",
			},
		},
		{
			desc: "With redis-sentinel URL",
			cfg: &Config{
				RedisURL: "redis-sentinel://:secretpassword@localhost:5000,localhost:5001,localhost:5002?master=mymaster",
			},
			want: asynq.RedisFailoverClientOpt{
				MasterName: "mymaster",
				SentinelAddrs: []string{
					"localhost:5000", "localhost:5001", "localhost:5002"},
				// asynq parses the password in a redis-sentinel URL as the sentinel password.
				SentinelPassword: "secretpassword",
			},
		},
		{
			desc: "With redis-sentinel URL and master credentials",
			cfg: &Config{
				RedisURL:      "redis-sentinel://:sentinelpass@localhost:5000?master=mymaster",
				RedisUsername: "app",
				RedisPassword: "masterpass",
				RedisDB:       2,
			},
			want: asynq.RedisFailoverClientOpt{
				MasterName:       "mymaster",
				SentinelAddrs:    []string{"localhost:5000"},
				SentinelPassword: "sentinelpass",
				Username:         "app",
				Password:         "masterpass",
				DB:               2,
			},
		},
		{
			desc: "With redis username",
			cfg: &Config{
				RedisAddr:     "localhost:6379",
				RedisUsername: "app",
				RedisPassword: "foo",
			},
			want: asynq.RedisClientOpt{
				Addr:     "localhost:6379",
				Username: "app",
				Password: "foo",
			},
		},
		{
			desc: "With cluster nodes",
			cfg: &Config{
				RedisClusterNodes: "localhost:5000, localhost:5001,localhost:5002,localhost:5003,localhost:5004,localhost:5005,",
			},
			want: asynq.RedisClusterClientOpt{
				Addrs: []string{
					"localhost:5000", "localhost:5001", "localhost:5002", "localhost:5003", "localhost:5004", "localhost:5005"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			got, err := makeRedisConnOpt(tc.cfg)
			if err != nil {
				t.Fatalf("makeRedisConnOpt returned error: %v", err)
			}

			if diff := cmp.Diff(tc.want, got, cmpopts.IgnoreUnexported(tls.Config{})); diff != "" {
				t.Errorf("diff found: want=%v, got=%v; (-want,+got)\n%s",
					tc.want, got, diff)
			}
		})
	}
}

func TestParseFlagsValidation(t *testing.T) {
	tests := [][]string{
		{"--basic-auth-username", "admin"},
		{"--basic-auth-password", "secret"},
		{"--redis-client-cert", "client.pem"},
	}
	for _, args := range tests {
		if _, _, err := parseFlags("asynqdash", args); err == nil {
			t.Errorf("parseFlags(%v) returned no error, want an error", args)
		}
	}
}

func TestNormalizedRootPath(t *testing.T) {
	tests := map[string]string{
		"":             "",
		"/":            "",
		"asynqdash":    "/asynqdash",
		"/asynqdash/":  "/asynqdash",
		"/tools/queue": "/tools/queue",
	}
	for in, want := range tests {
		cfg := &Config{RootPath: in}
		if got := cfg.normalizedRootPath(); got != want {
			t.Errorf("normalizedRootPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMakeRedisConnOptTLSFiles(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.pem")
	if _, err := makeRedisConnOpt(&Config{RedisAddr: "localhost:6379", RedisCACert: missing}); err == nil {
		t.Error("makeRedisConnOpt with a missing CA file returned no error")
	}
	notPEM := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(notPEM, []byte("not a certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := makeRedisConnOpt(&Config{RedisAddr: "localhost:6379", RedisCACert: notPEM}); err == nil {
		t.Error("makeRedisConnOpt with an invalid CA file returned no error")
	}
}

func TestBasicAuthMiddleware(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := basicAuthMiddleware(ok, "admin", "secret", "/api/health")

	tests := []struct {
		desc       string
		path       string
		user, pass string
		want       int
	}{
		{"no credentials", "/", "", "", http.StatusUnauthorized},
		{"wrong password", "/", "admin", "nope", http.StatusUnauthorized},
		{"wrong username", "/", "root", "secret", http.StatusUnauthorized},
		{"valid credentials", "/", "admin", "secret", http.StatusOK},
		{"public path", "/api/health", "", "", http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path, nil)
			if tc.user != "" {
				req.SetBasicAuth(tc.user, tc.pass)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d", rec.Code, tc.want)
			}
			if rec.Code == http.StatusUnauthorized && rec.Header().Get("WWW-Authenticate") == "" {
				t.Error("missing WWW-Authenticate header")
			}
		})
	}
}
