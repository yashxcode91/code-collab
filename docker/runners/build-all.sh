#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building CodeCollab non-root sandbox runner images..."
docker build -t codecollab-runner-node:v1 -f "$SCRIPT_DIR/node.Dockerfile" "$SCRIPT_DIR"
docker build -t codecollab-runner-ts:v1 -f "$SCRIPT_DIR/typescript.Dockerfile" "$SCRIPT_DIR"
docker build -t codecollab-runner-python:v1 -f "$SCRIPT_DIR/python.Dockerfile" "$SCRIPT_DIR"
docker build -t codecollab-runner-cpp:v1 -f "$SCRIPT_DIR/cpp.Dockerfile" "$SCRIPT_DIR"
docker build -t codecollab-runner-java:v1 -f "$SCRIPT_DIR/java.Dockerfile" "$SCRIPT_DIR"
echo "All 5 CodeCollab runner images built successfully."
