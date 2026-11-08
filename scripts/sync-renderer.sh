#!/bin/sh
# Copy the chart renderer from the freeflowchart web app into renderer/.
# Usage: scripts/sync-renderer.sh [path-to-freeflowchart]   (default: ../freeflowchart)
set -e
SRC="${1:-$(dirname "$0")/../../freeflowchart}"
DST="$(dirname "$0")/../renderer"
cp "$SRC/chart.js" "$SRC/connect.js" "$DST/"
# Drop the Google Fonts @import so rendering never touches the network.
grep -v "fonts.googleapis.com" "$SRC/style.css" > "$DST/style.css"
( cd "$SRC" && git rev-parse --short HEAD 2>/dev/null ) > "$DST/SOURCE_COMMIT" || true
echo "Synced renderer from $SRC ($(cat "$DST/SOURCE_COMMIT"))"
