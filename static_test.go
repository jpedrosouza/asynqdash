package asynqmon

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func newTestAssetsHandler(rootPath string) *uiAssetsHandler {
	bigJS := strings.Repeat("console.log('asynqmon');\n", 200)
	return &uiAssetsHandler{
		rootPath: rootPath,
		contents: fstest.MapFS{
			"ui/build/index.html": &fstest.MapFile{Data: []byte(
				`<script>window.FLAG_ROOT_PATH = "/[[.RootPath]]"; window.FLAG_READ_ONLY = "/[[.ReadOnly]]";</script>` +
					`<script type="module" src="/[[.RootPath]]/assets/index-abc123.js"></script>`)},
			"ui/build/assets/index-abc123.js":   &fstest.MapFile{Data: []byte(bigJS)},
			"ui/build/assets/index-abc123.css":  &fstest.MapFile{Data: []byte("body{color:red}")},
			"ui/build/assets/font-abc123.woff2": &fstest.MapFile{Data: []byte("wOF2")},
			"ui/build/favicon.ico":              &fstest.MapFile{Data: []byte{0, 0, 1, 0}},
		},
		staticDirPath: "ui/build",
		indexFileName: "index.html",
		readOnly:      true,
	}
}

func TestUIAssetsHandlerContentTypes(t *testing.T) {
	h := newTestAssetsHandler("/monitoring")
	tests := []struct {
		path        string
		contentType string
		cache       string
	}{
		{"/monitoring/assets/index-abc123.js", "text/javascript; charset=utf-8", "immutable"},
		{"/monitoring/assets/index-abc123.css", "text/css; charset=utf-8", "immutable"},
		{"/monitoring/assets/font-abc123.woff2", "font/woff2", "immutable"},
		{"/monitoring/favicon.ico", "image/x-icon", "max-age=3600"},
	}
	for _, tc := range tests {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s: status = %d, want 200", tc.path, rec.Code)
			continue
		}
		if got := rec.Header().Get("Content-Type"); got != tc.contentType {
			t.Errorf("GET %s: Content-Type = %q, want %q", tc.path, got, tc.contentType)
		}
		if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, tc.cache) {
			t.Errorf("GET %s: Cache-Control = %q, want it to contain %q", tc.path, got, tc.cache)
		}
	}
}

func TestUIAssetsHandlerRendersIndexForSPARoutes(t *testing.T) {
	h := newTestAssetsHandler("/monitoring")
	for _, p := range []string{"/monitoring", "/monitoring/", "/monitoring/queues/default", "/monitoring/queues/default/tasks/123"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: status = %d, want 200", p, rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `src="/monitoring/assets/index-abc123.js"`) {
			t.Errorf("GET %s: index does not reference assets under the root path:\n%s", p, body)
		}
		if !strings.Contains(body, `FLAG_READ_ONLY = "true"`) {
			t.Errorf("GET %s: index does not include the read-only flag:\n%s", p, body)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("GET %s: Cache-Control = %q, want no-cache", p, got)
		}
	}
}

func TestUIAssetsHandlerGzip(t *testing.T) {
	h := newTestAssetsHandler("")
	req := httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil)
	req.Header.Set("Accept-Encoding", "br, gzip;q=0.9")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	data, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("reading gzip body: %v", err)
	}
	if !strings.HasPrefix(string(data), "console.log") {
		t.Errorf("decompressed body = %q, want the original file", string(data[:20]))
	}

	// Clients that do not accept gzip get the original bytes.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil))
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want none", got)
	}
}

func TestUIAssetsHandlerRejectsPathOutsideRoot(t *testing.T) {
	h := newTestAssetsHandler("/monitoring")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/other/assets/index-abc123.js", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestIsPrintable(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{`{"user_id": 42}`, true},
		{"{\n  \"user_id\": 42\n}", true},
		{"line1\r\nline2\tend", true},
		{"   ", false},
		{"\x00\x01binary", false},
		{string([]byte{0xff, 0xfe}), false},
	}
	for _, tc := range tests {
		if got := isPrintable([]byte(tc.in)); got != tc.want {
			t.Errorf("isPrintable(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
