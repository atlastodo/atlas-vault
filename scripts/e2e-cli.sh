#!/usr/bin/env bash
#
# Atlas Vault against the `atlas` CLI on a real server (packages/vault-core/e2e): a throwaway
# Postgres database, the core repository's atlas-server offering the vault
# (ATLAS_APPS=todo,vault) on a free port, and its atlas CLI binary. An item the CLI adds must
# show up in the app's store and the reverse (edits, secret history, the trash), the CLI must
# read the exact password the app stored, and the server must refuse writes on a read-only token.
#
# Environment:
#   ATLAS_CORE_DIR     a checkout of github.com/atlastodo/atlas (default ../atlas); its
#                      binaries are built there with `cargo build` (in its devenv) unless
#   ATLAS_SERVER_BIN   and
#   ATLAS_CLI          point at prebuilt atlas-server and atlas binaries.
#   E2E_DATABASE_URL   an admin URL of a Postgres to create the throwaway database on (default
#                      postgres://atlas:atlas@localhost:5432/postgres). The database is dropped
#                      afterwards.
#   E2E_WEB=1          also export the web app, serve it from the server (STATIC_DIR) and drive it
#                      in headless Chromium (scripts/e2e-web.mjs) beside the CLI. CHROMIUM names
#                      the browser (default: nixpkgs#chromium); SCREENSHOT_DIR keeps screenshots.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${ATLAS_CORE_DIR:-$ROOT/../atlas}"
ADMIN_URL="${E2E_DATABASE_URL:-postgres://atlas:atlas@localhost:5432/postgres}"

if [ -z "${ATLAS_SERVER_BIN:-}" ] || [ -z "${ATLAS_CLI:-}" ]; then
  [ -d "$CORE/crates/atlas-server" ] || { echo "!! No core checkout at $CORE (set ATLAS_CORE_DIR)" >&2; exit 1; }
  echo ">> Building atlas-server and atlas in $CORE"
  (cd "$CORE" && devenv shell -- cargo build -q -p atlas-server -p atlas-cli)
  target="$(cd "$CORE" && devenv shell -- cargo metadata --format-version 1 --no-deps 2>/dev/null | grep "^{" | jq -r .target_directory)"
  ATLAS_SERVER_BIN="${ATLAS_SERVER_BIN:-$target/debug/atlas-server}"
  ATLAS_CLI="${ATLAS_CLI:-$target/debug/atlas}"
fi

db="atlas_vault_e2e_$$"
base="${ADMIN_URL%/*}"
command -v psql >/dev/null || { echo "!! psql is needed to create the throwaway database" >&2; exit 1; }
psql_admin() { psql "$ADMIN_URL" -qc "$1"; }
psql_admin "CREATE DATABASE $db"

web_dir=""
if [ "${E2E_WEB:-}" = 1 ]; then
  web_dir="$(mktemp -d)"
  echo ">> Exporting the web app"
  (cd "$ROOT/apps/vault" && CI=1 EXPO_NO_TELEMETRY=1 bunx expo export --platform web --output-dir "$web_dir" >/dev/null)
  CHROMIUM="${CHROMIUM:-$(nix build --no-link --print-out-paths nixpkgs#chromium)/bin/chromium}"
fi

port="$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')"
log="$(mktemp)"
server_pid=""
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null && wait "$server_pid" 2>/dev/null || true
  psql_admin "DROP DATABASE IF EXISTS $db WITH (FORCE)" || true
  rm -f "$log"
  [ -n "$web_dir" ] && rm -rf "$web_dir"
  return 0
}
trap cleanup EXIT

# Every CLI run signs in with its token: lift the per-IP limits for this one-client server.
echo ">> Starting atlas-server on :$port (ATLAS_APPS=todo,vault)"
DATABASE_URL="$base/$db" JWT_SECRET="$(head -c 48 /dev/urandom | base64)" PORT="$port" \
  ATLAS_APPS=todo,vault ATTACHMENTS_ENABLED=false RUST_LOG=warn STATIC_DIR="$web_dir" \
  AUTH_RATE_LIMIT_MAX=100000 SYNC_RATE_LIMIT_MAX=100000 SYNC_READ_RATE_LIMIT_MAX=100000 \
  "$ATLAS_SERVER_BIN" >"$log" 2>&1 &
server_pid=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$port/health" >/dev/null && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$log" >&2; exit 1; }
  sleep 0.5
done
curl -sf "http://127.0.0.1:$port/discovery" | jq -c '{version, apps: [.apps[].id], capabilities}'

(
  cd "$ROOT/packages/vault-core"
  ATLAS_E2E_URL="http://127.0.0.1:$port" ATLAS_CLI="$ATLAS_CLI" bunx --bun vitest run --config vitest.e2e.config.ts "$@"
)
if [ -n "$web_dir" ]; then
  echo ">> The web app in Chromium"
  # devenv's LD_LIBRARY_PATH points Chromium at libraries from another glibc.
  env -u LD_LIBRARY_PATH BASE_URL="http://127.0.0.1:$port" CHROMIUM="$CHROMIUM" ATLAS_CLI="$ATLAS_CLI" \
    node "$ROOT/scripts/e2e-web.mjs"
fi
