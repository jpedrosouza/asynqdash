import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The built index.html is rendered by the Go server as an html/template with
// "/[[" and "]]" delimiters (see static.go). Assets are built with a relative
// base so that CSS and JS reference each other relative to their own URL, and
// only the entry tags in index.html are rewritten to the RootPath placeholder,
// which the Go server fills in at runtime. This keeps the UI working when
// asynqmon is mounted under any sub-path.
const ROOT_PATH_PLACEHOLDER = "/[[.RootPath]]";

function goTemplateRootPath(): Plugin {
  return {
    name: "asynqmon-go-template-root-path",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/(src|href)="\.\/(assets\/[^"]+)"/g, `$1="${ROOT_PATH_PLACEHOLDER}/$2"`);
      },
    },
  };
}

// API server used during development (`npm run dev`).
const API_TARGET = process.env.ASYNQMON_API ?? "http://localhost:8080";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react(), tailwindcss(), goTemplateRootPath()],
  build: {
    outDir: "build",
    emptyOutDir: true,
    sourcemap: false,
    // Minification strips license comments, so the licenses of bundled packages
    // are collected into a file shipped with the build (and the Go binary).
    license: { fileName: "THIRD_PARTY_LICENSES.md" },
    // Dynamic imports would bake the placeholder base into JS files, which are
    // not templated by the server, so preload helpers are disabled.
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 3000,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
}));
