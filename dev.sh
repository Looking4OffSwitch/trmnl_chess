#!/bin/bash

# PID file to track our server processes
PID_FILE=".dev_pids"
# Backup file for production settings
SETTINGS_BACKUP="trmnl_chess/src/settings.yml.backup"
SETTINGS_FILE="trmnl_chess/src/settings.yml"

# Parse command line arguments
RESET_GAME=false
OPEN_BROWSER=false
ALREADY_CLEANED=false

for arg in "$@"; do
    case $arg in
        --reset)
            RESET_GAME=true
            ;;
        --open)
            OPEN_BROWSER=true
            ;;
    esac
done

# Function to reset game state
reset_game() {
    echo "Resetting game state..."
    # Remove current game ID file
    rm -f trmnl_chess/CURRENT_GAME.id
    # Note: We could also flush Redis here if we had the keys, but since games
    # are created with random IDs, we'll just let Redis naturally expire old games
    echo "✓ Game state reset complete"
}

# Function to clean up background processes
cleanup() {
    if [ "$ALREADY_CLEANED" = true ]; then
        return
    fi
    ALREADY_CLEANED=true
    trap - EXIT
    echo "Shutting down servers..."
    # Kill only OUR processes using saved PIDs
    if [ -f "$PID_FILE" ]; then
        while read pid; do
            kill -9 "$pid" 2>/dev/null || true
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi

    # Restore production settings.yml from backup
    if [ -f "$SETTINGS_BACKUP" ]; then
        echo "Restoring production settings.yml..."
        mv "$SETTINGS_BACKUP" "$SETTINGS_FILE"
        echo "✓ Production settings restored"
    fi

    echo "All servers stopped."
    exit
}

# Trap exits and signals to ensure cleanup always runs
trap cleanup EXIT INT TERM

# If --reset flag is set, reset before starting servers
if [ "$RESET_GAME" = true ]; then
    reset_game
fi

# --- Generate QR Code for Local Development ---
# Auto-detect local IP address for phone testing; prefer Wi‑Fi (en0) on macOS.
# Explicit override: export TRMNL_HOST=<ip-or-hostname>
DEV_HOST="$TRMNL_HOST"
if [ -z "$DEV_HOST" ]; then
    # Try Wi‑Fi first
    if command -v ipconfig >/dev/null 2>&1; then
        WIFI_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
    fi
    # Fallback: first non‑loopback IPv4
    FALLBACK_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    DEV_HOST="${WIFI_IP:-$FALLBACK_IP}"
fi

# Last resort
DEV_HOST="${DEV_HOST:-localhost}"

echo "Using hostname (for phones): ${DEV_HOST}"
POLL_HOST="${TRMNL_POLL_HOST:-localhost}"
echo "Polling host (TRMNL): ${POLL_HOST}"
QR_DATA="http://${DEV_HOST}:8000"
QR_CODE_FILE="trmnl_chess/src/qr_code.png"

echo "Generating QR code for URL: ${QR_DATA}"
curl -s -L "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${QR_DATA}" -o "${QR_CODE_FILE}"

if [ ! -s "${QR_CODE_FILE}" ]; then
    echo "ERROR: Failed to generate QR code. The file is missing or empty."
    echo "Please check your internet connection and that the QR code API is available."
    exit 1
fi

echo "✓ QR code generated successfully."
# ---

# Kill any existing processes on the ports we need - ONLY listening processes
echo "Killing existing processes on ports 4567, 3000, 8000..."

# Kill ONLY processes that are LISTENING on these ports (not browsers with open tabs)
lsof -ti:4567 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:3000 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:8000 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true

# Wait for processes to die
sleep 2

# Verify ports are actually free
if lsof -i:4567 -sTCP:LISTEN -i:3000 -sTCP:LISTEN -i:8000 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "ERROR: Ports are still in use after cleanup:"
    lsof -i:4567 -sTCP:LISTEN -i:3000 -sTCP:LISTEN -i:8000 -sTCP:LISTEN 2>/dev/null | grep LISTEN
    echo ""
    echo "Please manually kill these processes and try again"
    exit 1
fi

echo "✓ All ports are free"

# Update .trmnlp.yml with the current IP address for development
cat > trmnl_chess/.trmnlp.yml <<EOF
# TRMNLP configuration
---
watch:
  - .trmnlp.yml
  - src

polling_url: http://${POLL_HOST}:3000/api/trmnl-state

custom_fields: {}

variables:
  trmnl: {}
  backend_url: http://${DEV_HOST}:3000
EOF

echo "✓ Updated .trmnlp.yml with backend URL: http://${DEV_HOST}:3000 (polling via ${POLL_HOST})"

# config.js now auto-detects environment; no regeneration needed for dev
echo "✓ Using dynamic config.js (auto-selects backend based on host); override via ?api= or window.API_BASE_URL_OVERRIDE if needed"

# --- Backup and modify settings.yml for local development ---
# This allows the TRMNL plugin to poll the local backend instead of production Vercel
if [ -f "$SETTINGS_FILE" ]; then
    # Create backup if it doesn't exist (preserve production settings)
    if [ ! -f "$SETTINGS_BACKUP" ]; then
        cp "$SETTINGS_FILE" "$SETTINGS_BACKUP"
        echo "✓ Backed up production settings.yml"
    fi

    # Update settings.yml with local development URLs
    # Use sed to replace production URLs with local ones
    sed -i.tmp "s|https://trmnl-chess.vercel.app|http://${DEV_HOST}:3000|g" "$SETTINGS_FILE"
    rm -f "${SETTINGS_FILE}.tmp"
    echo "✓ Updated settings.yml with local backend URL: http://${HOSTNAME}:3000"
    echo "  (Production settings backed up and will be restored on exit)"
else
    echo "⚠ Warning: settings.yml not found at $SETTINGS_FILE"
fi
# ---

# Save current directory
PROJECT_ROOT=$(pwd)

# Clear old PID file
rm -f "$PID_FILE"

# Start the trmnl server using the local trmnlp command
(cd trmnl_chess && trmnlp serve) &
TRMNLP_PID=$!
echo "$TRMNLP_PID" >> "$PID_FILE"
echo "trmnlp server started with PID $TRMNLP_PID"

# Start the backend server with a frontend URL reachable on the LAN
FRONTEND_URL="http://${DEV_HOST}:8000" node "${PROJECT_ROOT}/website/backend/server.js" &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PID_FILE"
echo "Backend server started with PID $BACKEND_PID"

# Start the site server
python3 -m http.server 8000 --directory "${PROJECT_ROOT}/website/site" &
SITE_PID=$!
echo "$SITE_PID" >> "$PID_FILE"
echo "Site server started with PID $SITE_PID"

# Open browser windows if --open flag was specified
if [ "$OPEN_BROWSER" = true ]; then
    echo "Waiting for servers to be ready..."
    sleep 3
    echo "Opening browser windows..."
    open "http://localhost:4567"
    open "http://localhost:8000"
    echo "✓ Browser windows opened"
fi

# Wait for any of the background processes to exit
wait
