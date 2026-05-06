#!/usr/bin/env bash
set -euo pipefail

# Start API in background for local Nginx proxying
uvicorn api.main:app --host 127.0.0.1 --port 8000 &
API_PID="$!"

cleanup() {
  if kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID"
    wait "$API_PID" || true
  fi
}

trap cleanup EXIT INT TERM

# Keep container alive with Nginx in foreground
nginx -g "daemon off;"
