#!/bin/bash
# Publishes a release APK to GitHub Releases with full version history.
#
# Usage:  bash publish-apk.sh
#
# Every run creates an immutable release tagged app-v<versionCode> containing
# the APK (e.g. EBISU-TA-v1.3.0-vc11.apk) plus a fixed-name EBISU-TA.apk.
# Employees always install from:
#   https://github.com/jedebisu/selfie-attendance/releases/latest/download/EBISU-TA.apk
# Rollback = grab the APK from any older app-v<N> release page.

set -euo pipefail

REPO="jedebisu/selfie-attendance"
VC=$(node -p "require('./app.json').expo.android.versionCode")
VER=$(node -p "require('./app.json').expo.version")

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=$HOME/Library/Android/sdk

echo "==> Building EBISU T&A $VER (versionCode $VC)"
cd android
./gradlew assembleRelease
cd ..

APK="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "ERROR: $APK not found" && exit 1
fi

TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2-)
if [ -z "$TOKEN" ]; then
  echo "ERROR: no GitHub credentials in keychain" && exit 1
fi

TAG="app-v$VC"
RELEASE=$(curl -s -m 30 -H "Authorization: token $TOKEN" "https://api.github.com/repos/$REPO/releases/tags/$TAG")
REL_ID=$(echo "$RELEASE" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')

if [ -z "$REL_ID" ]; then
  echo "==> Creating release $TAG"
  REL_ID=$(curl -s -m 30 -X POST \
    -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/$REPO/releases" \
    -d "{\"tag_name\":\"$TAG\",\"target_commitish\":\"main\",\"name\":\"EBISU T&A $VER (build $VC)\",\"body\":\"Versioned APK build $VC. See commit history for changes.\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
else
  echo "==> Release $TAG already exists, uploading into it"
fi

upload_asset() {
  local name="$1"
  local existing_id
  existing_id=$(curl -s -m 30 "https://api.github.com/repos/$REPO/releases/$REL_ID/assets" \
    | python3 -c "import sys,json;print(next((a['id'] for a in json.load(sys.stdin) if a['name']=='$name'),''))")
  if [ -n "$existing_id" ]; then
    echo "    replacing existing asset $name"
    curl -s -m 30 -X DELETE -H "Authorization: token $TOKEN" \
      "https://api.github.com/repos/$REPO/releases/assets/$existing_id" -o /dev/null
  fi
  echo "    uploading $name"
  curl -s -m 600 -X POST \
    -H "Authorization: token $TOKEN" \
    -H "Content-Type: application/vnd.android.package-archive" \
    --data-binary @"$APK" \
    "https://uploads.github.com/repos/$REPO/releases/$REL_ID/assets?name=$name" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print("    state:",d.get("state",d.get("message")))'
}

upload_asset "EBISU-TA-$VER-vc$VC.apk"
upload_asset "EBISU-TA.apk"

echo ""
echo "==> Done. Versioned download:"
echo "    https://github.com/$REPO/releases/download/$TAG/EBISU-TA-$VER-vc$VC.apk"
echo "    Always-latest download:"
echo "    https://github.com/$REPO/releases/latest/download/EBISU-TA.apk"
