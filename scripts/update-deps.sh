#!/usr/bin/env bash
# Refreshes every dependency Dependabot can't reach, so nothing sits on an old version:
#   devenv.lock (nixpkgs: Node, Bun, …) and flake.lock(s); the Bun pins in the workflows, the
#   Dockerfile and the docs, which follow the Bun the devenv nixpkgs ships; the whole bun.lock,
#   transitive dependencies and overrides included; each Expo app's SDK-managed packages
#   (`expo install --fix`); Cargo.lock; and nix/bun.nix. Steps for files a repo doesn't have are
#   skipped. Run by `.github/workflows/deps-refresh.yml` weekly, or locally as `deps:update`.
#
# npm releases must be at least DEPS_MIN_AGE seconds old (default 3 days), a buffer against
# hijacked releases; `[install] minimumReleaseAgeExcludes` in bunfig.toml lists our own packages.
# Nix inputs and crates have no such check.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

age="${DEPS_MIN_AGE:-259200}"
step() { printf '\n==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
devenv() { if have devenv; then command devenv "$@"; else nix run nixpkgs#devenv -- "$@"; fi; }

if [[ -f devenv.lock ]]; then
  step "devenv.lock"
  devenv update
fi

if [[ -f flake.lock ]]; then
  step "flake.lock"
  nix flake update
fi

# The nixpkgs pin shipped inside the desktop tarball's flake (as `desktop:flake-update`).
if [[ -f nix/flake.desktop.lock ]]; then
  step "nix/flake.desktop.lock"
  tmp="$(mktemp -d)"
  cp nix/flake.desktop.nix "$tmp/flake.nix"
  cp nix/flake.desktop.lock "$tmp/flake.lock"
  nix flake update --flake "path:$tmp"
  cp "$tmp/flake.lock" nix/flake.desktop.lock
  rm -rf "$tmp"
fi

# Bun is pinned in lockstep: devenv gets it from its nixpkgs, CI and the image from BUN_VERSION.
# Move every pin to the version that nixpkgs now ships.
if [[ -f devenv.lock ]]; then
  step "Bun version"
  ref="$(bun -e 'const l = (await Bun.file("devenv.lock").json()).nodes.nixpkgs.locked;
    console.log(`github:${l.owner}/${l.repo}/${l.rev}`)')"
  new="$(nix eval --raw "$ref#bun.version")"
  old="$(sed -nE 's/^ *BUN_VERSION: "([0-9.]+)".*/\1/p' .github/workflows/ci.yml | head -1)"
  if [[ -n "$old" && "$old" != "$new" ]]; then
    echo "Bun $old -> $new"
    mapfile -t files < <(git ls-files '.github/workflows/*.yml' '.github/actions/*/action.yml' \
      'docker/Dockerfile' devenv.yaml devenv.nix AGENTS.md CONTRIBUTING.md README.md 'docs/*.md')
    # Only lines that talk about Bun, so an unrelated "1.4.2" elsewhere stays put.
    sed -i -E "/[Bb][Uu][Nn]/s/(^|[^0-9.])${old//./\\.}([^0-9]|$)/\1${new}\2/g" "${files[@]}"
  else
    echo "Bun stays at ${old:-?}"
  fi
fi

# The core release this app builds on is pinned at one exact version across the manifests, CI's
# server image and CLI, devenv and the docs, so it moves here, everywhere at once, rather than
# through Dependabot. It follows the newest core release, rc or stable.
core_old="$(git grep -hoE '"@atlastodo/client-core": "[0-9][^"]*"' -- '*package.json' | head -1 | cut -d'"' -f4)" || true
if [[ -n "$core_old" ]]; then
  step "Atlas core"
  core_new="$(npm view @atlastodo/client-core dist-tags --json | bun -e '
    const t = Object.values(JSON.parse(await Bun.stdin.text()));
    console.log(t.sort(Bun.semver.order).at(-1))')"
  if [[ "$core_new" != "$core_old" ]]; then
    echo "core $core_old -> $core_new"
    mapfile -t files < <(git grep -lF "$core_old" -- ':!bun.lock' ':!nix/bun.nix' ':!RELEASE_NOTES.md')
    sed -i -E "/atlastodo|atlas:|CORE_VERSION|[Cc]ore/s/(^|[^0-9.])${core_old//./\\.}([^0-9A-Za-z.-]|$)/\1${core_new}\2/g" "${files[@]}"
    # Fixtures copied from core (`vectors:sync`) follow the release they come from.
    if [[ -f scripts/sync-vectors.mjs ]]; then
      tmp="$(mktemp -d)"
      git clone -q --depth 1 --branch "v$core_new" https://github.com/atlastodo/atlas.git "$tmp"
      node scripts/sync-vectors.mjs "$tmp" HEAD
      rm -rf "$tmp"
    fi
  else
    echo "core stays at $core_old"
  fi
fi

if [[ -f bun.lock ]]; then
  step "bun.lock"
  bun install >/dev/null
  bun update --minimum-release-age "$age"
fi

# The Expo SDK decides the versions of its native modules (react, react-native, expo-*, …), which
# Dependabot therefore leaves alone. First move to the SDK's newest patch release, as Expo's API
# names it; then, offline, align the native modules with whichever `expo` is installed (which also
# undoes anything `bun update` moved past the SDK). A new SDK major is a migration, done by hand.
# `expo install` runs `bun add`, so the release age is set in bunfig.toml for the duration: when
# the release Expo asks for is younger, the first pass is skipped and waits for the next run.
for app in apps/*/; do
  [[ -f "${app}app.json" ]] && grep -q '"expo":' "${app}package.json" || continue
  step "Expo SDK packages in $app"
  bak="$(mktemp -d)"
  cp bunfig.toml "$bak/"
  sed -i "s/^\[install\]$/&\nminimumReleaseAge = $age/" bunfig.toml
  cp bun.lock "${app}package.json" "$bak/"
  if ! (cd "$app" && CI=1 bunx expo install --fix); then
    echo "::warning::expo install --fix in $app needs a release younger than the cooldown; next run"
    cp "$bak/bun.lock" bun.lock
    cp "$bak/package.json" "${app}package.json"
  fi
  (cd "$app" && CI=1 EXPO_OFFLINE=1 bunx expo install --fix)
  cp "$bak/bunfig.toml" bunfig.toml
  rm -rf "$bak"
done

if [[ -f Cargo.lock ]]; then
  step "Cargo.lock"
  cargo update
fi

# nix/bun.nix is generated from bun.lock (as `nix:bun-lock`), with the bun2nix the flake locks.
if [[ -f nix/bun.nix ]]; then
  step "nix/bun.nix"
  nix run --inputs-from . bun2nix -- -c ../ -o nix/bun.nix
fi

step "Changed"
git status --short
