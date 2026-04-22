#!/bin/bash
set -e

cd "$(dirname "$0")"
SCRIPTS_DIR="$(pwd)"
ROOT="$(cd .. && pwd)"
WORKSPACE_ROOT="$(cd "$ROOT/../../.." && pwd)"
SHARED_WEB="$ROOT/shared/web"
EXTRACTED_ANDROID="$WORKSPACE_ROOT/extracted/android/AgendaAndroid"
EXTRACTED_MAC_RES="$WORKSPACE_ROOT/extracted/mac/AgendaApp.app/Contents/Resources"
EXTRACTED_MAC_INFO="$WORKSPACE_ROOT/extracted/mac/AgendaApp.app/Contents"
EXTRACTED_MAC_INSTALLER="$WORKSPACE_ROOT/extracted/mac/Installer.command"
EXTRACTED_ANDROID_INSTALLER="$WORKSPACE_ROOT/extracted/android/AgendaAndroid/Installer_Android.command"
EXTRACTED_ANDROID_HEADERS="$WORKSPACE_ROOT/extracted/android/AgendaAndroid/_headers"

echo "Sync shared -> extracted platforms..."

cp "$SHARED_WEB/index.html" "$EXTRACTED_ANDROID/index.html"
cp "$SHARED_WEB/manifest.json" "$EXTRACTED_ANDROID/manifest.json"
cp "$SHARED_WEB/sw.js" "$EXTRACTED_ANDROID/sw.js"
cp "$SHARED_WEB/icon-192.png" "$EXTRACTED_ANDROID/icon-192.png"
cp "$SHARED_WEB/icon-512.png" "$EXTRACTED_ANDROID/icon-512.png"

cp "$SHARED_WEB/index.html" "$EXTRACTED_MAC_RES/index.html"
cp "$SHARED_WEB/manifest.json" "$EXTRACTED_MAC_RES/manifest.json"
cp "$SHARED_WEB/sw.js" "$EXTRACTED_MAC_RES/sw.js"
cp "$SHARED_WEB/icon-192.png" "$EXTRACTED_MAC_RES/icon-192.png"
cp "$SHARED_WEB/icon-512.png" "$EXTRACTED_MAC_RES/icon-512.png"

cp "$ROOT/platforms/mac/AppMain.swift" "$EXTRACTED_MAC_RES/AppMain.swift"
cp "$ROOT/platforms/mac/AppIcon.icns" "$EXTRACTED_MAC_RES/AppIcon.icns"
cp "$ROOT/platforms/mac/Info.plist" "$EXTRACTED_MAC_INFO/Info.plist"
cp "$ROOT/platforms/mac/Installer.command" "$EXTRACTED_MAC_INSTALLER"

cp "$ROOT/platforms/android/Installer_Android.command" "$EXTRACTED_ANDROID_INSTALLER"
cp "$ROOT/platforms/android/_headers" "$EXTRACTED_ANDROID_HEADERS"

if [ "${SYNC_INSTALLED_MAC_APP:-0}" = "1" ] && [ -d "/Applications/AgendaApp.app" ]; then
  echo "Sync extracted Mac -> /Applications/AgendaApp.app..."
  cp "$SHARED_WEB/index.html" "/Applications/AgendaApp.app/Contents/Resources/index.html"
  cp "$SHARED_WEB/manifest.json" "/Applications/AgendaApp.app/Contents/Resources/manifest.json"
  cp "$SHARED_WEB/sw.js" "/Applications/AgendaApp.app/Contents/Resources/sw.js"
  cp "$SHARED_WEB/icon-192.png" "/Applications/AgendaApp.app/Contents/Resources/icon-192.png"
  cp "$SHARED_WEB/icon-512.png" "/Applications/AgendaApp.app/Contents/Resources/icon-512.png"
  cp "$ROOT/platforms/mac/AppMain.swift" "/Applications/AgendaApp.app/Contents/Resources/AppMain.swift"
  cp "$ROOT/platforms/mac/AppIcon.icns" "/Applications/AgendaApp.app/Contents/Resources/AppIcon.icns"
  cp "$ROOT/platforms/mac/Info.plist" "/Applications/AgendaApp.app/Contents/Info.plist"
fi

if [ "${AUTO_DEPLOY_FIREBASE:-0}" = "1" ]; then
  echo "Auto deploy Firebase..."
  "$SCRIPTS_DIR/deploy_firebase.command"
fi

echo "Sync OK"
