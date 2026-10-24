#
# First stage:
# Building the frontend.
#

# The assets do not depend on the target platform: build them once, natively.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend

WORKDIR /static

# Install dependencies first to take advantage of the layer cache.
COPY ui/package.json ui/package-lock.json ./
RUN npm ci

# Copy the rest of the ./ui folder and build the static assets into /static/build.
COPY ui .
RUN npm run build

#
# Second stage:
# Building the backend.
#

# Go cross-compiles for the target platform, so this stage also runs natively.
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS backend

# Set by buildx for each platform of a multi-platform build (e.g. linux/arm64).
ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /build

# Copy and download dependencies.
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code to the container.
COPY . .

# Replace the committed UI build with the one built in the first stage.
RUN rm -rf ui/build
COPY --from=frontend ["/static/build", "ui/build"]

# Run go build (with ldflags to reduce binary size).
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o asynqdash ./cmd/asynqdash

#
# Third stage:
# Creating and running a new scratch container with the backend binary.
#

FROM scratch

# Copy binary from /build to the root folder of the scratch container.
COPY --from=backend ["/build/asynqdash", "/"]

# Command to run when starting the container.
ENTRYPOINT ["/asynqdash"]
