{ pkgs, lib, config, inputs, ... }:

let
  # First lines of every script that needs the Android SDK, which is opt-in (see `android` below).
  requireAndroid = ''
    if [ -z "''${ANDROID_HOME:-}" ]; then
      echo "!! This needs the Android SDK, which is off by default. To enable it, create" >&2
      echo "   devenv.local.nix (gitignored) in the repo root containing:" >&2
      echo "     { android.enable = true; }" >&2
      echo "   then re-enter the shell. The first entry downloads the SDK (several GB)." >&2
      exit 1
    fi
  '';

  # The sync server lives in the core repository (atlastodo/atlas) and must offer Atlas Vault
  # (ATLAS_APPS=todo,vault). The scripts that need one talk to EXPO_PUBLIC_API_URL (default
  # http://localhost:8080) and only check that it answers.
  requireServer = ''
    api_url="''${EXPO_PUBLIC_API_URL:-http://localhost:8080}"
    if ! curl -sf "$api_url/health" >/dev/null 2>&1 && ! curl -sf "$api_url/api/health" >/dev/null 2>&1; then
      echo "!! No Atlas server answers at $api_url. The server is in the core repository" >&2
      echo "   (https://github.com/atlastodo/atlas): run it there with ATLAS_APPS=todo,vault" >&2
      echo "   (devenv up, then cargo run -p atlas-server), or its image, or point" >&2
      echo "   EXPO_PUBLIC_API_URL at another server. Continuing: the app starts anyway and" >&2
      echo "   shows the sign-in screen's server field." >&2
    fi
  '';
in
{
  # ---------------------------------------------------------------------------
  # Atlas Vault development environment.
  #
  #   - Node + Bun (apps/vault: the React Native + Expo app and its web export;
  #     packages/vault-core: the platform-free vault logic)
  #   - the Android SDK, opt-in (native Android builds)
  #
  # The sync server (Rust + PostgreSQL), the `atlas` CLI and the core packages are in the core
  # repository, https://github.com/atlastodo/atlas; this app installs the core packages from npm.
  # ---------------------------------------------------------------------------

  # --- Android SDK & Emulator ------------------------------------------------
  # Opt-in: several GB that only native Android work needs (Expo Go and EAS cloud builds don't).
  android = {
    enable = lib.mkDefault false;
    platforms.version = [ "34" "35" "36" "37" ];
    systemImageTypes = [ "google_apis_playstore" ];
    abis = [ "x86_64" ];
    buildTools.version = [ "34.0.0" "35.0.0" "36.0.0" "37.0.0" ];
    ndk.version = [ "27.0.12077973" "27.1.12297006" ];
    cmake.version = [ "3.22.1" ];
    emulator.enable = true;
    systemImages.enable = true;
    reactNative.enable = true;
  };

  languages.javascript = {
    enable = true;
    # Node 26, matching `engines` and CI. Node is the runtime; Bun is the package manager. Bun is
    # pinned to 1.4.2 through this lock's nixpkgs, in lockstep with BUN_VERSION in the workflows.
    package = pkgs.nodejs_26;
    bun.enable = true;
  };

  packages = with pkgs; [
    git
    curl
    jq
    # psql, for the throwaway database of scripts/e2e-cli.sh.
    postgresql
  ];

  env = lib.optionalAttrs config.android.enable {
    # Gradle/JVM heap for native Android builds; mkForce replaces the android module's GRADLE_OPTS.
    GRADLE_OPTS = lib.mkForce "-Dorg.gradle.jvmargs=\"-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError\" -XX:MaxMetaspaceSize=1024m -Xmx4096m";
    JAVA_TOOL_OPTIONS = "-XX:MaxMetaspaceSize=1024m -Xmx4096m";
    _JAVA_OPTIONS = "-XX:MaxMetaspaceSize=1024m -Xmx4096m";
  };

  # --- Scripts (developer entry points) --------------------------------------
  # `web:dev`: the web app on the Expo web dev server, pointed at EXPO_PUBLIC_API_URL.
  scripts."web:dev".exec = requireServer + ''
    set -euo pipefail
    cd "$DEVENV_ROOT/apps/vault"
    # EXPO_UNSTABLE_HEADLESS keeps the React Native DevTools shell (which cannot load on NixOS)
    # from starting; the web app is debugged in the browser's own devtools.
    EXPO_PUBLIC_API_URL="$api_url" EXPO_UNSTABLE_HEADLESS=1 bun run web "$@"
  '';
  # `mobile:dev`: Metro for Expo Go; scan the QR with the phone.
  scripts."mobile:dev".exec = ''
    export EXPO_PUBLIC_API_URL="''${EXPO_PUBLIC_API_URL:-http://localhost:8080}"
    cd "$DEVENV_ROOT/apps/vault" && bun run start "$@"
  '';
  # The web export in apps/vault/dist (EXPO_PUBLIC_API_URL baked in when set).
  scripts."web:export".exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT/apps/vault" && bun run export:web "$@"
  '';

  # Named test:all -- a script called "test" collides with the shell builtin.
  scripts."test:all".exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
    # `--bun` runs vitest under Bun's runtime, matching CI.
    (cd packages/vault-core && bunx --bun vitest run)
    # jest-expo must run under real Node (`bun run` only starts it).
    (cd apps/vault && bun run test)
  '';
  # The app and the atlas CLI against a real server: items written by either show up in the
  # other, and a read-only vault token is refused writes. Needs a core checkout (ATLAS_CORE_DIR,
  # default ../atlas) and a Postgres; see scripts/e2e-cli.sh.
  scripts."e2e:cli".exec = ''bash "$DEVENV_ROOT/scripts/e2e-cli.sh" "$@"'';
  # Typecheck every workspace, ESLint, `prettier --check` and the shipped licences.
  scripts.lint.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
    (cd packages/vault-core && bun run typecheck)
    (cd apps/vault && bun run typecheck)
    bunx eslint .
    bunx prettier --check .
    node scripts/third-party-licenses.mjs --check
    # nix/bun.nix must match bun.lock, or the flake's web-dist build fails offline.
    if command -v nix >/dev/null; then
      fresh="$(mktemp)"
      nix run --inputs-from . bun2nix -- -c ../ -o "$fresh"
      cmp -s "$fresh" nix/bun.nix || { rm -f "$fresh"; echo "nix/bun.nix is stale: run nix:bun-lock" >&2; exit 1; }
      rm -f "$fresh"
    fi
  '';
  scripts.fmt.exec = ''
    cd "$DEVENV_ROOT"
    bunx prettier --write .
  '';
  # Regenerate nix/bun.nix (the flake's npm dependency set) from bun.lock. Run after every
  # bun.lock change; `lint` checks it.
  scripts."nix:bun-lock".exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
    nix run --inputs-from . bun2nix -- -c ../ -o nix/bun.nix
  '';

  scripts."build:android".exec = "cd \"$DEVENV_ROOT/apps/vault\" && bunx eas-cli build --profile preview --platform android \"$@\"";
  # The --local builds and Gradle run on this machine, so they need the (opt-in) Android SDK.
  scripts."build:android:local".exec = requireAndroid + ''
    cd "$DEVENV_ROOT/apps/vault" && bunx eas-cli build --profile preview --platform android --local "$@"
  '';
  # The release APK + AAB as CI builds them (prebuild, then Gradle), unsigned (debug key).
  scripts."build:android:release".exec = requireAndroid + ''
    set -euo pipefail
    cd "$DEVENV_ROOT/apps/vault"
    bunx expo prebuild --platform android --clean
    cd android && "$DEVENV_ROOT/.github/scripts/android-gradle.sh" "$@"
  '';
  # The last release build's permissions against docs/android-permissions.md (release.yml runs it too).
  scripts."android:permissions".exec = ''node "$DEVENV_ROOT/apps/vault/scripts/check-android-permissions.mjs" "$@"'';
  # The native Android dev build on a device or emulator, against EXPO_PUBLIC_API_URL.
  scripts."mobile:android".exec = requireAndroid + requireServer + ''
    set -euo pipefail
    adb reverse tcp:8081 tcp:8081 2>/dev/null || true
    adb reverse tcp:8080 tcp:8080 2>/dev/null || true
    cd "$DEVENV_ROOT/apps/vault"
    EXPO_PUBLIC_API_URL="$api_url" EXPO_UNSTABLE_HEADLESS=1 bun run android "$@"
  '';

  enterShell = ''
    if [ -n "''${DEVENV_PROFILE:-}" ]; then
      export PATH="$DEVENV_PROFILE/bin:$PATH"
    fi
    echo "Atlas Vault dev shell -- node $(node --version), bun $(bun --version)"
    echo "Scripts: web:dev, mobile:dev, test:all, e2e:cli, lint, fmt (the server is in atlastodo/atlas)"
    if [ -z "''${ANDROID_HOME:-}" ]; then
      echo "Android SDK off -- enable it with a devenv.local.nix containing { android.enable = true; }"
    fi
  '';

  enterTest = ''
    test:all
  '';
}
