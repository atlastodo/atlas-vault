# AGENTS.md

## Working with the user (standing instruction)

- Before planning work on a bug, ask questions until the bug is properly understood (symptoms, reproduction, expected vs actual).
- Also ask questions about the proposed solution before implementing — don't assume intent.

## What this is

Atlas Vault, the password manager of the Atlas suite. A client only: the server, the `atlas` CLI and the core packages are in the core repository, [atlastodo/atlas](https://github.com/atlastodo/atlas) (a checkout is expected at `../atlas` by the scripts). Its tooling follows Atlas Journal ([atlastodo/atlas-journal](https://github.com/atlastodo/atlas-journal)), itself modelled on [atlastodo/atlas-todo](https://github.com/atlastodo/atlas-todo).

## Dev environment

- All dev commands (`web:dev`, `mobile:dev`, `web:export`, `test:all`, `e2e:cli`, `lint`, `fmt`, `nix:bun-lock`, `version:bump`, `build:android:release`, `android:permissions`, …) are devenv scripts in `devenv.nix` — run them inside `devenv shell`. The root `package.json` has **no** scripts. (The full suite is `test:all`, not `test`, which collides with the shell builtin.)
- Bun is the package manager (`bun.lock` committed, lockfile version 1 — bun2nix reads no other; CI installs with `--frozen-lockfile`); Node 26 is the runtime. Bun is pinned to **1.4.2** in devenv (the nixpkgs of `devenv.lock`) and `BUN_VERSION` in `.github/workflows/*.yml` — bump them together.
- The root `typescript` devDependency is 5.9 on purpose: typescript-eslint supports TypeScript < 6.1, and ESLint runs from the root. The workspaces typecheck with their own TypeScript 7.
- The core packages come from npm at an exact version (now `0.1.11-rc.8`): `@atlastodo/client-core` and `@atlastodo/shared` (the vault item rules). Move them by hand with a core release, together with `CORE_VERSION`/`ATLAS_SERVER_IMAGE` in `ci.yml` (the e2e job's server image and CLI binary). The core fixtures the tests replay (`vault_item_vectors.json`, `field_policy_vectors.json`) are read from those packages, so a bump picks them up.
- A server for development: in the core checkout, `devenv up` and `ATLAS_APPS=todo,vault cargo run -p atlas-server`; `EXPO_PUBLIC_API_URL` defaults to `http://localhost:8080`.
- The Android SDK is opt-in: a gitignored `devenv.local.nix` with `{ android.enable = true; }`. Only `build:android:*`, `mobile:android` and `android:permissions` need it.

## Verification

- `test:all` = vitest in `packages/vault-core` (under Bun: `bunx --bun vitest run`) → jest-expo in `apps/vault` (must run under real Node: `bun run test`).
- `lint` = `tsc --noEmit` for both workspaces + `eslint .` + `prettier --check .` + `scripts/third-party-licenses.mjs --check` + a stale-`nix/bun.nix` check.
- `e2e:cli` (`scripts/e2e-cli.sh`) = a throwaway database, core's `atlas-server` with `ATLAS_APPS=todo,vault`, and the `atlas` CLI: `packages/vault-core/e2e` proves an item the CLI adds shows up in the app's store field for field and the reverse (edits, secret history, trash), that `atlas vault get X --field password` prints exactly what the app stored, that a read-only token made as the app makes it is refused writes by the server (a raw push: 403 `api_token_read_only`), that the server's token-policy errors come back typed, and that an Atlas Todo account gets its vault key on its first vault sign-in. `E2E_WEB=1` also exports the web app, serves it from that server and drives it in headless Chromium (`scripts/e2e-web.mjs`: sign-up, a login with its password masked, search, read-only and writing tokens made in Settings, the CLI both ways, lock/unlock, a session past its auto-lock deadline opening locked). Binaries are built from `ATLAS_CORE_DIR` (default `../atlas`) or given as `ATLAS_SERVER_BIN`/`ATLAS_CLI`; Postgres from `E2E_DATABASE_URL` (default the devenv one on 5432). CI's `End to end` job runs the same suites against the pinned core release's image and CLI binary.
- The web app is the primary target: `web:export` (or CI's export step) must pass.

## Layout and rules

- `packages/vault-core` — platform-free: `items.ts` (items and folders in a client-core `LocalStore`; every item rule is `@atlastodo/shared`'s `vault.ts` — `newVaultItemFields`, `vaultItemChanges` (secret history), `toVaultItem` — never reimplemented here; `vectors.test.ts` replays core's `vault_item_vectors.json` through the store), `query.ts` (list filters; search never reads secret values), `generator.ts` (CSPRNG only, rejection sampling, no `Math.random` fallback), `totp.ts` (RFC 6238, tested on the RFC's vectors), `autoLock.ts`, `account.ts` (sign-in/up/unlock, opening the vault app key), `apiTokens.ts` (vault tokens), `engine.ts` (store + `SyncClient`).
- **No new crypto.** Keys and envelopes are client-core's: the password opens the root (`openAccountKeys`, `ensureRootKey` for an account without one), the root opens the vault app key (`enableApp`/`openAppKey`, app `vault`). The vault key plays the DEK's role in the keyring (envelope kid `"dek"`, scope personal). The todo key is never stored. If core lacks something, change core (a branch in the core repository), don't work around it here.
- Every sync request is vault-scoped: build clients with `createVaultApiClient` (`x-atlas-sync-apps: vault`). A vault session has no legacy plaintext: `setLegacyMigrated(true)`. The server must offer `api_token_policies` (checked at sign-in, `VAULT_SERVER_REQUIREMENTS`).
- Vault API tokens are vault-only (`apps: ["vault"]`), always carry `expires_at` (≤ the policy's `max_lifetime_days`, from client-core's `tokenPolicyFor`) and send `write` explicitly (false unless the user opts in).
- **Nothing decrypted at rest.** The app's store is `MemoryPersistence`: client-core's durable persistence (IndexedDB/SQLite) keeps op values in plaintext, which would leave every secret readable while locked. Switch to a durable store only once core offers one encrypted at rest.
- **Locking** (`AuthContext.lock`, `AutoLockGate`) drops the vault keys from memory and from the stored session, unmounts the vault (its store and every revealed secret) and clears a copied secret. The session stores `lockAt`; a session restored past it opens locked. Browser tabs follow each other's lock and activity through the stored session. Auto-lock timeout and clipboard timeout are per-device prefs (`lib/prefs.ts`), not synced.
- Clipboard (`lib/clipboard.ts`): secrets are copied with Android's `isSensitive` and cleared after the timeout only if still ours (phones); the web cannot read the clipboard without a prompt, so it overwrites, and only while focused.
- `apps/vault` — Expo Router app; screens take navigation callbacks as props (the `app/` route files wire them) so tests render them without a router. Platform files: `*.web.ts` for the browser (`sessionStore`, `argon2id`, `installKey`). The web session keeps the vault keys only sealed under a non-extractable WebCrypto key (`webKeyStore.ts`); phones keep the session in the OS keychain.
- `docs/android-permissions.md` is the allowlist the release checks the merged manifest against (`apps/vault/scripts/check-android-permissions.mjs`); block unused permissions in `app.json`.
- The flake builds `web-dist` from source with bun2nix over `nix/bun.nix`: run `nix:bun-lock` after every `bun.lock` change.

## CI & release

- Conventional Commits; a fix closing an issue carries `Fixes #N` in the commit body. Work lands on `dev`; `main` is stable-only and takes only the release PR from `dev` (`pr-base.yml`). Never add AI attribution to commits.
- `ci.yml`: `Lint`, `Test (vault-core)`, `Test (app)` (jest + the web export), `End to end (server + CLI)`, `Audit (JS)` (continue-on-error), chosen by changed paths; a tag or manual run runs everything.
- The two known unfixable `bun audit` advisories are `braces` and `node-forge` (no patched release reachable from the Expo toolchain); fixable ones go in the root `overrides`, never an ignore list.
- Versioning is lockstep: `version:bump [--no-notes] <x.y.z|x.y.z-rc.N|patch|minor|major>` updates every manifest, `app.json` (and the derived Android `versionCode`, `scripts/version-code.mjs`), `bun.lock`, `nix/bun.nix` and `RELEASE_NOTES.md`; commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`.
- `release.yml` on a `v*` tag: CI → Prepare (tag = manifests, notes present) → the web tarball (`atlas-vault-web-X.Y.Z.tar.gz`, built with `EXPO_PUBLIC_API_URL=/api`), the signed APK + AAB (only when the four `ANDROID_*` keystore secrets are set), the third-party notices → GitHub Release. The Play upload is off until there is a listing: repository variable `PLAY_UPLOAD=true` plus the `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret (`PLAY_STORE_TRACK`, `PLAY_STORE_PRERELEASE_TRACK` as in the todo app). `ATLAS_APP_ID` and `ATLAS_EAS_PROJECT_ID` override the app id and turn on EAS (`app.config.ts`).
- The Android build caches are written on `main` only (`android-cache.yml`) and read by the tag build: keep the flags in `.github/scripts/android-gradle.sh` shared.
