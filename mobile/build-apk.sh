#!/bin/bash

# Build Optimized APK Script
# Run this after Java is installed

echo "🚀 Building Optimized APK for Selfie Attendance"
echo "================================================"
echo ""

# Set Android SDK
export ANDROID_HOME=~/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin

# Set Java Home
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH=$JAVA_HOME/bin:$PATH

echo "✅ ANDROID_HOME: $ANDROID_HOME"
echo "✅ JAVA_HOME: $JAVA_HOME"
echo ""

# Navigate to mobile directory
cd "$(dirname "$0")"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
cd android
./gradlew clean
cd ..

echo ""
echo "🔨 Building release APK..."
echo "This will take 5-10 minutes..."
echo ""

# Build the release APK
cd android
./gradlew assembleRelease

# Check if build succeeded
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ BUILD SUCCESSFUL!"
    echo "================================================"
    echo ""

    # Find and show APK location
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
    if [ -f "$APK_PATH" ]; then
        APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
        echo "📦 APK Location: android/$APK_PATH"
        echo "📊 APK Size: $APK_SIZE"
        echo ""

        # Copy to mobile root for easy access
        cp "$APK_PATH" "../selfie-attendance-optimized.apk"
        echo "📋 Copied to: mobile/selfie-attendance-optimized.apk"
        echo ""
        echo "🎉 Ready to install on devices!"
    else
        echo "⚠️  APK file not found at expected location"
    fi
else
    echo ""
    echo "❌ BUILD FAILED"
    echo "Check the error messages above"
    exit 1
fi
