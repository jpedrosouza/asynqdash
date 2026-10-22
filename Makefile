.PHONY: api assets build docker ui-dev test

# Build the UI assets into ui/build (embedded into the Go binary).
assets:
	@if [ ! -d "ui/node_modules" ]; then cd ./ui && npm ci; fi
	cd ./ui && npm run build

# This target skips the overhead of building UI assets.
# Intended to be used during development.
api:
	go build -o api ./cmd/asynqdash

# Start the UI dev server on http://localhost:3000.
# It proxies API requests to an asynqdash server on http://localhost:8080 (see `make api`).
ui-dev:
	cd ./ui && npm run dev

test:
	go test ./...
	cd ./ui && npm run typecheck

# Build a release binary.
build: assets
	go build -o asynqdash ./cmd/asynqdash

# Build image and run Asynqdash server (with default settings).
docker:
	docker build -t asynqdash .
	docker run --rm \
		--name asynqdash \
		-p 8080:8080 \
		asynqdash --redis-addr=host.docker.internal:6379
