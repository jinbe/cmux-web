#!/bin/bash
# Fetch xterm.js and addons for local serving
set -euo pipefail

DEST="$(dirname "$0")/../public"

echo "Fetching xterm.js..."
curl -sL "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js" -o "$DEST/js/xterm.js"
curl -sL "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css" -o "$DEST/css/xterm.css"

echo "Fetching xterm addons..."
curl -sL "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js" -o "$DEST/js/addon-fit.js"
curl -sL "https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.js" -o "$DEST/js/addon-web-links.js"

echo "Done! Files saved to $DEST"
