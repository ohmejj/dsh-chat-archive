#!/usr/bin/env bash
# Remove @ohmejj/dsh-chat-archive from a dsh profile (opposite of enable-in-profile.sh).
# Usage: bash scripts/disable-from-profile.sh [profile]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-web}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
NM_DIR="$PROFILE_DIR/node_modules/@ohmejj"
PATCH="$PROFILE_DIR/cordis.patch.yml"

rm -rf "$NM_DIR"
if [ -f "$PATCH" ] && grep -q "@ohmejj/dsh-chat-archive" "$PATCH"; then
  echo "  resetting $PATCH (it contained the plugin row)."
  cat > "$PATCH" <<'YML'
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
[]
YML
fi
echo "Removed. Restart the Web GUI to unload the plugin (host + browser halves)."
