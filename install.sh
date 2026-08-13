#!/usr/bin/env bash
# Install Hermes Token Meter into the active Hermes home (default ~/.hermes).
# Works on Linux/macOS and Git-Bash on Windows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"

DESKTOP_SRC="$ROOT/desktop-plugins/token-meter"
AGENT_SRC="$ROOT/plugins/token-meter"
DESKTOP_DST="$HERMES_HOME/desktop-plugins/token-meter"
AGENT_DST="$HERMES_HOME/plugins/token-meter"

if [[ ! -f "$DESKTOP_SRC/plugin.js" ]]; then
  echo "error: missing $DESKTOP_SRC/plugin.js" >&2
  exit 1
fi
if [[ ! -f "$AGENT_SRC/dashboard/plugin_api.py" ]]; then
  echo "error: missing $AGENT_SRC/dashboard/plugin_api.py" >&2
  exit 1
fi

mkdir -p "$HERMES_HOME/desktop-plugins" "$HERMES_HOME/plugins"
rm -rf "$DESKTOP_DST" "$AGENT_DST"
mkdir -p "$DESKTOP_DST" "$AGENT_DST"
cp -R "$DESKTOP_SRC/." "$DESKTOP_DST/"
cp -R "$AGENT_SRC/." "$AGENT_DST/"
# never ship bytecode
find "$AGENT_DST" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$AGENT_DST" -type f -name '*.pyc' -delete 2>/dev/null || true

echo "Installed desktop plugin → $DESKTOP_DST"
echo "Installed agent/backend  → $AGENT_DST"

if command -v hermes >/dev/null 2>&1; then
  if hermes plugins enable token-meter 2>/dev/null; then
    echo "Enabled token-meter in plugins.enabled"
  else
    echo "note: run: hermes plugins enable token-meter"
    echo "      (or add 'token-meter' under plugins.enabled in config.yaml)"
  fi
else
  echo "note: hermes CLI not on PATH — enable manually:"
  echo "      plugins.enabled: [..., token-meter]"
fi

cat <<EOF

Next:
  1. Restart the Hermes desktop app so /api/plugins/token-meter mounts
     (⌘K → "Reload desktop plugins" alone does NOT remount the Python backend)
  2. Look for the "Tokens" chip bottom-right in the status bar

Verify:
  node "$HERMES_HOME/desktop-plugins/token-meter/plugin.test.mjs"
EOF
