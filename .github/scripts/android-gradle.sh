#!/usr/bin/env bash
# The Android release build, shared by release.yml (signed: extra -P signing flags) and
# android-cache.yml (unsigned, to fill the caches). Both must run the same tasks with the same
# flags, or the Gradle build cache and ccache saved on main would not match the tag's build.
# arm64-v8a only. Run from apps/mobile/android.
set -euo pipefail
./gradlew assembleRelease bundleRelease --no-daemon --build-cache \
  -Dorg.gradle.jvmargs="-Xmx6g -XX:MaxMetaspaceSize=2g" \
  -x lint -x lintVitalRelease -x lintVitalAnalyzeRelease \
  -PreactNativeArchitectures=arm64-v8a \
  "$@"
ccache --show-stats || true
