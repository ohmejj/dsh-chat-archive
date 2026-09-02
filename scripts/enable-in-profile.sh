#!/usr/bin/env bash
# Enable dsh-chat-archive in a dsh Web profile (this machine).
#
#   bash scripts/enable-in-profile.sh [profile]
#
# Steps: (1) build the plugin, (2) npm-link-style symlink into
# <DSH_HOME>/profiles/<profile>/node_modules, (3) add the loader row to
# the profile cordis.patch.yml (idempotent), (4) print the restart step.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-web}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
NM_DIR="$PROFILE_DIR/node_modules/@ohmejj"

echo "[1/4] building the plugin…"
(cd "$ROOT" && npm run build)

echo "[2/4] linking dsh-chat-archive into $PROFILE_DIR/node_modules…"
mkdir -p "$NM_DIR"
ln -sfn "$ROOT" "$NM_DIR/dsh-chat-archive"

echo "[3/4] adding the loader row to $PROFILE_DIR/cordis.patch.yml…"
PATCH="$PROFILE_DIR/cordis.patch.yml"
ROW=$(printf '%s\n' "- insert:" "    - id: chat-archive" "      name: '@ohmejj/dsh-chat-archive'")
if [ ! -f "$PATCH" ]; then
  printf '%s\n' "$ROW" > "$PATCH"
elif grep -q "@ohmejj/dsh-chat-archive" "$PATCH"; then
  echo "  already enabled — leaving $PATCH untouched"
elif ! grep -Eq '^[[:space:]]*- ' "$PATCH"; then
  # Stock/empty patch (comment header + "[]"): replace it with the loader row.
  printf '%s\n' "$ROW" > "$PATCH"
  echo "  wrote the loader row into $PATCH"
else
  # The patch already carries other loader entries; add ours manually.
  echo "  $PATCH has other entries and no @ohmejj/dsh-chat-archive row."
  echo "  Add this entry to it manually, then re-run:"
  echo "$ROW"
fi
# final verification
if ! grep -q "@ohmejj/dsh-chat-archive" "$PATCH"; then
  echo "  ERROR: loader row is still missing from $PATCH — aborting." >&2
  exit 1
fi

echo "[4/4] done. Next steps (run outside this shell):"
echo "  1. Restart the Web GUI so the browser half ships:"
echo "     kill \$(cat "$DSH_HOME/dsh-web.pid" 2>/dev/null || true)   # ignore stale pids"
echo "     dsh --profile $PROFILE"
echo "  2. Open 设置 (Settings) — its left navigation now lists 对话自动归档 (Auto-archive conversations)."
echo "     Open it to edit the configuration."
echo "  3. Toggle it on, pick a threshold and unit, set the scan interval,"
echo "     then press 保存 (Save). Values persist in $DSH_HOME/settings.yaml."