#!/bin/sh
# Builds Herdr Notify.app, the macOS notifier for the agent-notify mod, with the Herdr icon.
# Does nothing when the app is current. macOS only. Needs swiftc (xcode-select --install).
#
# Based on herdr/notifier/build.sh from cockpit (https://github.com/quaresc/cockpit),
# MIT License, Copyright (c) 2026 quaresc. See LICENSE in this folder.
# Changed in this dotfiles repo: app name, bundle id and folder, and the icon comes from Herdr.app.
set -e
SRC=$(cd "$(dirname "$0")" && pwd -P)
APP="$HOME/.local/share/herdr-notify/Herdr Notify.app"
ICNS="/Applications/Herdr.app/Contents/Resources/Herdr.icns"
[ -f "$ICNS" ] || { echo "herdr-notify: $ICNS not found (install Herdr first)" >&2; exit 1; }
STAMP=$(cat "$SRC/main.swift" "$SRC/build.sh" "$ICNS" | shasum | cut -c1-16)
[ "$(cat "$APP/Contents/Resources/stamp" 2>/dev/null)" = "$STAMP" ] && exit 0
command -v swiftc >/dev/null || { echo "herdr-notify: swiftc not found (xcode-select --install)" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/Herdr Notify.app/Contents/MacOS" "$tmp/Herdr Notify.app/Contents/Resources"
swiftc -O -o "$tmp/Herdr Notify.app/Contents/MacOS/herdr-notify" "$SRC/main.swift" -framework Cocoa -framework UserNotifications
cp "$ICNS" "$tmp/Herdr Notify.app/Contents/Resources/AppIcon.icns"
cat > "$tmp/Herdr Notify.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.adibfirman.herdr-notify</string>
  <key>CFBundleName</key><string>Herdr Notify</string>
  <key>CFBundleDisplayName</key><string>Herdr Notify</string>
  <key>CFBundleExecutable</key><string>herdr-notify</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
echo "$STAMP" > "$tmp/Herdr Notify.app/Contents/Resources/stamp"
codesign --force --sign - "$tmp/Herdr Notify.app" >/dev/null 2>&1
mkdir -p "$(dirname "$APP")" && rm -rf "$APP" && mv "$tmp/Herdr Notify.app" "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
