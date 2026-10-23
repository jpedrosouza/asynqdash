package main

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/hibiken/asynq/x/metrics"
	"github.com/jpedrosouza/asynqdash"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
)

// Config holds configurations for the program provided via the command line.
type Config struct {
	// Server port
	Port int
	// URL path under which the web UI and the API are served, e.g. "/asynqdash".
	RootPath string

	// HTTP basic authentication. Enabled when both are set.
	BasicAuthUsername string
	BasicAuthPassword string

	// Redis connection options
	RedisAddr         string
	RedisDB           int
	RedisUsername     string
	RedisPassword     string
	RedisTLS          string
	RedisURL          string
	RedisInsecureTLS  bool
	RedisCACert       string
	RedisClientCert   string
	RedisClientKey    string
	RedisClusterNodes string

	// UI related configs
	ReadOnly                   bool
	MaxPayloadLength           int
	MaxResultLength            int
	DisableThroughputCollector bool

	// Prometheus related configs
	EnableMetricsExporter bool
	PrometheusServerAddr  string

	// Args are the positional (non-flag) command line arguments
	Args []string
}

// parseFlags parses the command-line arguments provided to the program.
// Typically, os.Args[0] is provided as 'progname' and os.args[1:] as 'args'.
// Returns the Config in case parsing succeeded, or an error. In any case, the
// output of the flag.Parse is returned in output.
//
// Reference: https://eli.thegreenplace.net/2020/testing-flag-parsing-in-go-programs/
func parseFlags(progname string, args []string) (cfg *Config, output string, err error) {
	flags := flag.NewFlagSet(progname, flag.ContinueOnError)
	var buf bytes.Buffer
	flags.SetOutput(&buf)

	var conf Config
	flags.IntVar(&conf.Port, "port", getEnvOrDefaultInt("PORT", 8080), "port number to use for web ui server")
	flags.StringVar(&conf.RootPath, "root-path", getEnvDefaultString("ROOT_PATH", "/"), "URL path under which the web UI is served, e.g. /asynqdash behind a reverse proxy")
	flags.StringVar(&conf.BasicAuthUsername, "basic-auth-username", getEnvDefaultString("BASIC_AUTH_USERNAME", ""), "username for HTTP basic authentication (requires --basic-auth-password)")
	flags.StringVar(&conf.BasicAuthPassword, "basic-auth-password", getEnvDefaultString("BASIC_AUTH_PASSWORD", ""), "password for HTTP basic authentication (requires --basic-auth-username)")
	flags.StringVar(&conf.RedisAddr, "redis-addr", getEnvDefaultString("REDIS_ADDR", "127.0.0.1:6379"), "address of redis server to connect to")
	flags.IntVar(&conf.RedisDB, "redis-db", getEnvOrDefaultInt("REDIS_DB", 0), "redis database number")
	flags.StringVar(&conf.RedisUsername, "redis-username", getEnvDefaultString("REDIS_USERNAME", ""), "username to use when connecting to redis server (redis ACL)")
	flags.StringVar(&conf.RedisPassword, "redis-password", getEnvDefaultString("REDIS_PASSWORD", ""), "password to use when connecting to redis server (with a redis-sentinel URL, the password of the master)")
	flags.StringVar(&conf.RedisTLS, "redis-tls", getEnvDefaultString("REDIS_TLS", ""), "server name for TLS validation used when connecting to redis server")
	flags.StringVar(&conf.RedisURL, "redis-url", getEnvDefaultString("REDIS_URL", ""), "URL to redis server")
	flags.BoolVar(&conf.RedisInsecureTLS, "redis-insecure-tls", getEnvOrDefaultBool("REDIS_INSECURE_TLS", false), "disable TLS certificate host checks")
	flags.StringVar(&conf.RedisCACert, "redis-ca-cert", getEnvDefaultString("REDIS_CA_CERT", ""), "path to a PEM file with the CA certificates used to verify the redis server")
	flags.StringVar(&conf.RedisClientCert, "redis-client-cert", getEnvDefaultString("REDIS_CLIENT_CERT", ""), "path to a PEM client certificate for TLS client authentication (requires --redis-client-key)")
	flags.StringVar(&conf.RedisClientKey, "redis-client-key", getEnvDefaultString("REDIS_CLIENT_KEY", ""), "path to the PEM private key of --redis-client-cert")
	flags.StringVar(&conf.RedisClusterNodes, "redis-cluster-nodes", getEnvDefaultString("REDIS_CLUSTER_NODES", ""), "comma separated list of host:port addresses of cluster nodes")
	flags.IntVar(&conf.MaxPayloadLength, "max-payload-length", getEnvOrDefaultInt("MAX_PAYLOAD_LENGTH", 200), "maximum number of utf8 characters of a payload shown in task lists (task details show it in full)")
	flags.IntVar(&conf.MaxResultLength, "max-result-length", getEnvOrDefaultInt("MAX_RESULT_LENGTH", 200), "maximum number of utf8 characters of a result shown in task lists (task details show it in full)")
	flags.BoolVar(&conf.EnableMetricsExporter, "enable-metrics-exporter", getEnvOrDefaultBool("ENABLE_METRICS_EXPORTER", false), "enable prometheus metrics exporter to expose queue metrics")
	flags.StringVar(&conf.PrometheusServerAddr, "prometheus-addr", getEnvDefaultString("PROMETHEUS_ADDR", ""), "address of prometheus server to query time series")
	flags.BoolVar(&conf.ReadOnly, "read-only", getEnvOrDefaultBool("READ_ONLY", false), "restrict to read-only mode")
	flags.BoolVar(&conf.DisableThroughputCollector, "disable-throughput-collector", getEnvOrDefaultBool("DISABLE_THROUGHPUT_COLLECTOR", false), "do not record the throughput of queues (tasks enqueued, processed and failed per minute) in redis")

	err = flags.Parse(args)
	if err != nil {
		return nil, buf.String(), err
	}
	conf.Args = flags.Args()
	if err := conf.validate(); err != nil {
		return nil, buf.String(), err
	}
	return &conf, buf.String(), nil
}

func (cfg *Config) validate() error {
	if (cfg.BasicAuthUsername == "") != (cfg.BasicAuthPassword == "") {
		return errors.New("--basic-auth-username and --basic-auth-password must be set together")
	}
	if (cfg.RedisClientCert == "") != (cfg.RedisClientKey == "") {
		return errors.New("--redis-client-cert and --redis-client-key must be set together")
	}
	return nil
}

// normalizedRootPath returns the root path with a leading slash and without a trailing slash,
// or "" for the server root.
func (cfg *Config) normalizedRootPath() string {
	p := strings.Trim(strings.TrimSpace(cfg.RootPath), "/")
	if p == "" {
		return ""
	}
	return "/" + p
}

// makeTLSConfig returns the TLS configuration for the redis connection, or nil if TLS is not configured.
func makeTLSConfig(cfg *Config) (*tls.Config, error) {
	if cfg.RedisTLS == "" && !cfg.RedisInsecureTLS && cfg.RedisCACert == "" && cfg.RedisClientCert == "" {
		return nil, nil
	}
	tlsCfg := &tls.Config{
		ServerName:         cfg.RedisTLS,
		InsecureSkipVerify: cfg.RedisInsecureTLS,
	}
	if err := addTLSCertificates(tlsCfg, cfg); err != nil {
		return nil, err
	}
	return tlsCfg, nil
}

// addTLSCertificates loads the CA and client certificates given on the command line into tlsCfg.
func addTLSCertificates(tlsCfg *tls.Config, cfg *Config) error {
	if cfg.RedisCACert != "" {
		pem, err := os.ReadFile(cfg.RedisCACert)
		if err != nil {
			return fmt.Errorf("could not read the redis CA certificate: %v", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return fmt.Errorf("no PEM certificate found in %s", cfg.RedisCACert)
		}
		tlsCfg.RootCAs = pool
	}
	if cfg.RedisClientCert != "" {
		cert, err := tls.LoadX509KeyPair(cfg.RedisClientCert, cfg.RedisClientKey)
		if err != nil {
			return fmt.Errorf("could not load the redis client certificate: %v", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}
	return nil
}

// splitClusterNodes splits a comma separated list of addresses, ignoring spaces and empty entries.
func splitClusterNodes(s string) []string {
	var addrs []string
	for _, addr := range strings.Split(s, ",") {
		if addr = strings.TrimSpace(addr); addr != "" {
			addrs = append(addrs, addr)
		}
	}
	return addrs
}

func makeRedisConnOpt(cfg *Config) (asynq.RedisConnOpt, error) {
	tlsCfg, err := makeTLSConfig(cfg)
	if err != nil {
		return nil, err
	}

	// Connecting to redis-cluster
	if len(cfg.RedisClusterNodes) > 0 {
		return asynq.RedisClusterClientOpt{
			Addrs:     splitClusterNodes(cfg.RedisClusterNodes),
			Username:  cfg.RedisUsername,
			Password:  cfg.RedisPassword,
			TLSConfig: tlsCfg,
		}, nil
	}

	// Connecting to redis-sentinels
	if strings.HasPrefix(cfg.RedisURL, "redis-sentinel") {
		res, err := asynq.ParseRedisURI(cfg.RedisURL)
		if err != nil {
			return nil, err
		}
		connOpt := res.(asynq.RedisFailoverClientOpt) // safe to type-assert
		// The password in the URL authenticates with the sentinels; the master uses its own credentials.
		connOpt.Username = cfg.RedisUsername
		connOpt.Password = cfg.RedisPassword
		connOpt.DB = cfg.RedisDB
		connOpt.TLSConfig = tlsCfg
		return connOpt, nil
	}

	// Connecting to single redis server
	var connOpt asynq.RedisClientOpt
	if len(cfg.RedisURL) > 0 {
		res, err := asynq.ParseRedisURI(cfg.RedisURL)
		if err != nil {
			return nil, err
		}
		connOpt = res.(asynq.RedisClientOpt) // safe to type-assert
		if connOpt.Username == "" {
			connOpt.Username = cfg.RedisUsername
		}
	} else {
		connOpt.Addr = cfg.RedisAddr
		connOpt.DB = cfg.RedisDB
		connOpt.Username = cfg.RedisUsername
		connOpt.Password = cfg.RedisPassword
	}
	switch {
	case connOpt.TLSConfig == nil:
		connOpt.TLSConfig = tlsCfg
	case tlsCfg != nil:
		// A rediss:// URL enables TLS; apply the checks and certificates given on the command line.
		connOpt.TLSConfig.InsecureSkipVerify = tlsCfg.InsecureSkipVerify
		if tlsCfg.ServerName != "" {
			connOpt.TLSConfig.ServerName = tlsCfg.ServerName
		}
		connOpt.TLSConfig.RootCAs = tlsCfg.RootCAs
		connOpt.TLSConfig.Certificates = tlsCfg.Certificates
	}
	return connOpt, nil
}

func main() {
	cfg, output, err := parseFlags(os.Args[0], os.Args[1:])
	if err == flag.ErrHelp {
		fmt.Println(output)
		os.Exit(2)
	} else if err != nil {
		fmt.Printf("error: %v\n", err)
		fmt.Println(output)
		os.Exit(1)
	}

	redisConnOpt, err := makeRedisConnOpt(cfg)
	if err != nil {
		log.Fatal(err)
	}

	rootPath := cfg.normalizedRootPath()
	h := asynqdash.New(asynqdash.Options{
		RootPath:                   rootPath,
		RedisConnOpt:               redisConnOpt,
		MaxPayloadLength:           cfg.MaxPayloadLength,
		MaxResultLength:            cfg.MaxResultLength,
		PrometheusAddress:          cfg.PrometheusServerAddr,
		ReadOnly:                   cfg.ReadOnly,
		DisableThroughputCollector: cfg.DisableThroughputCollector,
	})
	defer h.Close()

	c := cors.New(cors.Options{
		AllowedMethods: []string{"GET", "POST", "DELETE"},
	})
	mux := http.NewServeMux()
	mux.Handle(rootPath+"/", c.Handler(h))
	if rootPath != "" {
		mux.Handle(rootPath, http.RedirectHandler(rootPath+"/", http.StatusMovedPermanently))
	}
	if cfg.EnableMetricsExporter {
		// Using NewPedanticRegistry here to test the implementation of Collectors and Metrics.
		reg := prometheus.NewPedanticRegistry()

		inspector := asynq.NewInspector(redisConnOpt)

		reg.MustRegister(
			metrics.NewQueueMetricsCollector(inspector),
			// Add the standard process and go metrics to the registry
			prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
			prometheus.NewGoCollector(),
		)
		mux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	}
	if rootPath != "" {
		// Send visitors of the server root to the web UI.
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			http.Redirect(w, r, rootPath+"/", http.StatusFound)
		})
	}

	var handler http.Handler = mux
	if cfg.BasicAuthUsername != "" {
		// The health check stays open for liveness and readiness probes.
		handler = basicAuthMiddleware(handler, cfg.BasicAuthUsername, cfg.BasicAuthPassword, rootPath+"/api/health")
	}

	srv := &http.Server{
		Handler:      handler,
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		WriteTimeout: 10 * time.Second,
		ReadTimeout:  10 * time.Second,
	}

	fmt.Printf("Asynqdash is listening on port %d (http://localhost:%d%s/)\n", cfg.Port, cfg.Port, rootPath)
	log.Fatal(srv.ListenAndServe())
}

func getEnvDefaultString(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}

	return v
}

func getEnvOrDefaultInt(key string, def int) int {
	v, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return def
	}
	return v
}

func getEnvOrDefaultBool(key string, def bool) bool {
	v, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return def
	}
	return v
}
