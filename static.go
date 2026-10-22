package asynqmon

import (
	"bytes"
	"compress/gzip"
	"errors"
	"html/template"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
)

// uiAssetsHandler is a http.Handler.
// The path to the static file directory and
// the path to the index file within that static directory are used to
// serve the SPA.
type uiAssetsHandler struct {
	rootPath       string
	contents       fs.FS
	staticDirPath  string
	indexFileName  string
	prometheusAddr string
	readOnly       bool

	// gzipCache holds gzip-compressed copies of static files, keyed by path.
	gzipCache sync.Map
}

// ServeHTTP inspects the URL path to locate a file within the static dir
// on the SPA handler.
// If path '/' is requested, it will serve the index file, otherwise it will
// serve the file specified by the URL path.
func (h *uiAssetsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Clean the URL path to prevent directory traversal.
	// Note: embed.FS always uses forward slashes, so the "path" package is used
	// instead of "path/filepath" to keep this handler working on Windows.
	p := path.Clean("/" + r.URL.Path)

	// Get the path relative to the root path.
	if !strings.HasPrefix(p, h.rootPath) {
		http.Error(w, "unexpected path prefix", http.StatusBadRequest)
		return
	}
	p = strings.TrimPrefix(p, h.rootPath)

	if code, err := h.serveFile(w, r, p); err != nil {
		http.Error(w, err.Error(), code)
		return
	}
}

func (h *uiAssetsHandler) indexFilePath() string {
	return path.Join(h.staticDirPath, h.indexFileName)
}

func (h *uiAssetsHandler) renderIndexFile(w http.ResponseWriter) error {
	// Note: Replace the default delimiter ("{{") with a custom one
	// since the bundler may escape the '{' character when it compiles the index.html file.
	tmpl, err := template.New(h.indexFileName).Delims("/[[", "]]").ParseFS(h.contents, h.indexFilePath())
	if err != nil {
		return err
	}
	data := struct {
		RootPath       string
		PrometheusAddr string
		ReadOnly       bool
	}{
		RootPath:       h.rootPath,
		PrometheusAddr: h.prometheusAddr,
		ReadOnly:       h.readOnly,
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The index file embeds runtime flags, so it must never be cached.
	w.Header().Set("Cache-Control", "no-cache")
	return tmpl.Execute(w, data)
}

// serveFile writes file requested at path and returns http status code and error if any.
// If requested path is root, it serves the index file.
// Otherwise, it looks for file requested in the static content filesystem
// and serves if a file is found.
// If a requested file is not found in the filesystem, it serves the index file to
// make sure when user refreshes the page in SPA things still work.
func (h *uiAssetsHandler) serveFile(w http.ResponseWriter, r *http.Request, p string) (code int, err error) {
	if p == "/" || p == "" {
		if err := h.renderIndexFile(w); err != nil {
			return http.StatusInternalServerError, err
		}
		return http.StatusOK, nil
	}
	fullPath := path.Join(h.staticDirPath, p)
	bytes, err := fs.ReadFile(h.contents, fullPath)
	if err != nil {
		// If path is error (e.g. file not exist, path is a directory), serve index file.
		var pathErr *fs.PathError
		if errors.As(err, &pathErr) {
			if err := h.renderIndexFile(w); err != nil {
				return http.StatusInternalServerError, err
			}
			return http.StatusOK, nil
		}
		return http.StatusInternalServerError, err
	}
	contentType := contentTypeFor(fullPath, bytes)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if isFingerprintedAsset(p) {
		// Bundled assets have a content hash in their names, so they can be cached forever.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}

	if isCompressible(contentType) && len(bytes) > 1024 {
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r) {
			if gz, err := h.gzipped(fullPath, bytes); err == nil {
				w.Header().Set("Content-Encoding", "gzip")
				bytes = gz
			}
		}
	}

	if _, err := w.Write(bytes); err != nil {
		return http.StatusInternalServerError, err
	}
	return http.StatusOK, nil
}

// contentTypeFor returns the MIME type for the file at the given path.
// The file extension is used first, since content sniffing reports text/plain
// for stylesheets, scripts, SVGs and fonts, which browsers reject when strict
// MIME type checking is enabled.
func contentTypeFor(p string, data []byte) string {
	switch path.Ext(p) {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json", ".map":
		return "application/json; charset=utf-8"
	case ".webmanifest":
		return "application/manifest+json"
	case ".svg":
		return "image/svg+xml"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".ico":
		return "image/x-icon"
	}
	if ct := mime.TypeByExtension(path.Ext(p)); ct != "" {
		return ct
	}
	return http.DetectContentType(data)
}

// isFingerprintedAsset reports whether the file at the given path is a bundled asset
// whose name includes a content hash.
func isFingerprintedAsset(p string) bool {
	return strings.HasPrefix(p, "/assets/")
}

// isCompressible reports whether responses of the given content type benefit from gzip.
func isCompressible(contentType string) bool {
	return strings.HasPrefix(contentType, "text/") ||
		strings.HasPrefix(contentType, "application/json") ||
		strings.HasPrefix(contentType, "application/manifest+json") ||
		strings.HasPrefix(contentType, "image/svg+xml")
}

func acceptsGzip(r *http.Request) bool {
	for _, enc := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		if strings.TrimSpace(strings.SplitN(enc, ";", 2)[0]) == "gzip" {
			return true
		}
	}
	return false
}

// gzipped returns the gzip-compressed content of the file at the given path.
// Embedded files never change, so the compressed copy is computed once and cached.
func (h *uiAssetsHandler) gzipped(p string, data []byte) ([]byte, error) {
	if v, ok := h.gzipCache.Load(p); ok {
		return v.([]byte), nil
	}
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := zw.Write(data); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	h.gzipCache.Store(p, buf.Bytes())
	return buf.Bytes(), nil
}
