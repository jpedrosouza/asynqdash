package main

import (
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

// A responseRecorderWriter records response status and size.
// It implements http.ResponseWriter interface.
type responseRecorderWriter struct {
	http.ResponseWriter
	// The status code that the server sends back to the client.
	status int
	// The size of the object returned to the client, not including the response headers.
	size int
}

func (w *responseRecorderWriter) WriteHeader(status int) {
	w.ResponseWriter.WriteHeader(status)
	w.status = status
}

func (w *responseRecorderWriter) Write(b []byte) (int, error) {
	// If WriteHeader is not called explicitly, the first call to Write
	// will trigger an implicit WriteHeader(http.StatusOK).
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.size += n
	return n, err
}

// basicAuthMiddleware requires HTTP basic authentication with the given credentials,
// except for the paths in public.
func basicAuthMiddleware(h http.Handler, username, password string, public ...string) http.Handler {
	wantUser, wantPass := []byte(username), []byte(password)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, p := range public {
			if r.URL.Path == p {
				h.ServeHTTP(w, r)
				return
			}
		}
		user, pass, ok := r.BasicAuth()
		if ok {
			// Constant-time comparisons (only the lengths can be inferred from the timing),
			// and both are always evaluated so that a valid username is not revealed.
			userOK := subtle.ConstantTimeCompare([]byte(user), wantUser)
			passOK := subtle.ConstantTimeCompare([]byte(pass), wantPass)
			if userOK&passOK == 1 {
				h.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="Asynqdash", charset="UTF-8"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	})
}

func loggingMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &responseRecorderWriter{ResponseWriter: w}
		h.ServeHTTP(rw, r)

		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		username := "-"
		if user := r.URL.User; user != nil {
			username = user.Username()
		}
		size := "-"
		if rw.size > 0 {
			size = strconv.Itoa(rw.size)
		}
		// Write a log in Apache common log format (http://httpd.apache.org/docs/2.2/logs.html#common).
		fmt.Fprintf(os.Stdout, "%s - %s [%s] \"%s %s %s\" %d %s\n",
			host, username, time.Now().Format("02/Jan/2006:15:04:05 -0700"),
			r.Method, r.URL, r.Proto, rw.status, size)
	})
}
