#!/bin/bash

# Build Versioned APK Script
# Usage: ./build-apk.sh v1.1
# - bumps app version + Android versionCode
# - builds the release APK
# - archives it as apk/selfie-attendance-v1.1.apk (previous versions are kept)

set -e

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    echo "Usage: ./build-apk.sh v1.1"
    exit 1
fi

VERSION_NAME="${VERSION/v/}"  # v1.1 -> 1.1
VERSION_FULL="${VERSION_NAME}.0"  # 1.1 -> 1.1.0

echo "Building version $VERSION (app version $VERSION_FULL)"

export ANDROID_HOME=~/Library/Android/sdk
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

cd "$(dirname "$0")"

# Bump version + versionCode in app.json
node -e "
const fs = require('fs');
const p = 'app.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
const currentCode = (cfg.expo.android && cfg.expo.android.versionCode) || 1;
cfg.expo.version = '$VERSION_FULL';
cfg.expo.android = cfg.expo.android || {};
cfg.expo.android.versionCode = currentCode + 1;
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
console.log('Bumped to version ' + cfg.expo.version + ' (versionCode ' + cfg.expo.android.versionCode + ')');
"

# Regenerate native project so versionCode/versionName take effect
npx expo prebuild -p android

# Build
cd android
./gradlew assembleRelease

# Archive
APK_PATH="app/build/outputs/apk/release/app-release.apk"
cp "$APK_PATH" "../apk/selfie-attendance-$VERSION.apk"
cp "$APK_PATH" "../selfie-attendance-latest.apk"

echo ""
echo "Build complete:"
echo "  apk/selfie-attendance-$VERSION.apk"
echo "  selfie-attendance-latest.apk"