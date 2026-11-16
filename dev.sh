#!/bin/bash

python3 -m http.server 8000 &
SERVER_PID=$!

trap 'kill "$SERVER_PID" 2>/dev/null' EXIT

TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve localhost:8000