#
# First stage:
# Building the frontend.
#

FROM node:22-alpine AS frontend

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

FROM golang:1.23-alpine AS backend

WORKDIR /build

# Copy and download dependencies.
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code to the container.
COPY . .

# Replace the committed UI build with the one built in the first stage.
RUN rm -rf ui/build
COPY --from=frontend ["/static/build", "ui/build"]

# Set necessary environment variables needed for the image and build the server.
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64

# Run go build (with ldflags to reduce binary size).
RUN go build -ldflags="-s -w" -o asynqmon ./cmd/asynqmon

#
# Third stage:
# Creating and running a new scratch container with the backend binary.
#

FROM scratch

# Copy binary from /build to the root folder of the scratch container.
COPY --from=backend ["/build/asynqmon", "/"]

# Command to run when starting the container.
ENTRYPOINT ["/asynqmon"]
