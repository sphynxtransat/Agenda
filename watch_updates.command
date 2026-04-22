#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Watching shared project for changes..."
echo "AUTO_DEPLOY_FIREBASE=${AUTO_DEPLOY_FIREBASE:-0}"
echo "SYNC_INSTALLED_MAC_APP=${SYNC_INSTALLED_MAC_APP:-0}"
echo "Stop with Ctrl+C"

snapshot() {
  find shared platforms -type f ! -path "*/.firebase/*" | LC_ALL=C sort | while IFS= read -r file; do
    shasum "$file"
  done
}

LAST_HASH="$(snapshot | shasum | awk '{print $1}')"
"$(pwd)/sync_shared.command"

while true; do
  sleep 2
  CURRENT_HASH="$(snapshot | shasum | awk '{print $1}')"
  if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
    echo ""
    echo "Change detected at $(date '+%H:%M:%S')"
    LAST_HASH="$CURRENT_HASH"
    "$(pwd)/sync_shared.command"
  fi
done
