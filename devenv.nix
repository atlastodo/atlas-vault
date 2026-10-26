{ pkgs, ... }:

let
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
  # Atlas Vault development environment: a test harness for Atlas core, not a product.
  #
  #   - Node + Bun (apps/vault: the Expo web app, for manual testing;
  #     packages/vault-core: the platform-free vault logic and its tests)
  #
  # The sync server (Rust + PostgreSQL), the `atlas` CLI and the core packages are in the core
  # repository, https://github.com/atlastodo/atlas; this app installs the core packages from npm.
  # ---------------------------------------------------------------------------

  languages.javascript = {
    enable = true;
    # Node 26, matching `engines` and CI. Node is the runtime; Bun is the package manager. Bun is
    # pinned to 1.4.2 through this lock's nixpkgs, in lockstep with .bun-version (CI).
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

  # --- Scripts (developer entry points) --------------------------------------
  # `web:dev`: the web app on the Expo web dev server, pointed at EXPO_PUBLIC_API_URL.
  scripts."web:dev".exec = requireServer + ''
    set -euo pipefail
    cd "$DEVENV_ROOT/apps/vault"
    # EXPO_UNSTABLE_HEADLESS keeps the React Native DevTools shell (which cannot load on NixOS)
    # from starting; the web app is debugged in the browser's own devtools.
    EXPO_PUBLIC_API_URL="$api_url" EXPO_UNSTABLE_HEADLESS=1 bun run web "$@"
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
  # Typecheck every workspace, oxlint (`.oxlintrc.json`), `prettier --check` and the shipped licences.
  scripts.lint.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
    (cd packages/vault-core && bun run typecheck)
    (cd apps/vault && bun run typecheck)
    bunx oxlint .
    bunx prettier --check .
    node scripts/third-party-licenses.mjs --check
    # devenv.yaml follows the flake's nixpkgs; devenv.lock holds a copy of it.
    node scripts/check-devenv-lock.mjs
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
  # Refresh everything Dependabot cannot update (devenv/flake locks, the Bun pins, the whole
  # bun.lock, the Expo SDK packages, the core pin, nix/bun.nix): scripts/update-deps.sh, which
  # .github/workflows/deps-refresh.yml runs weekly.
  scripts."deps:update".exec = ''bash "$DEVENV_ROOT/scripts/update-deps.sh" "$@"'';

  enterShell = ''
    if [ -n "''${DEVENV_PROFILE:-}" ]; then
      export PATH="$DEVENV_PROFILE/bin:$PATH"
    fi
    echo "Atlas Vault dev shell -- node $(node --version), bun $(bun --version)"
    echo "Atlas Vault is a test harness for Atlas core. Scripts: test:all, e2e:cli, lint, fmt, deps:update, web:dev, web:export"
  '';

  enterTest = ''
    test:all
  '';
}
