# Atlas Vault

A password manager, end-to-end encrypted, on your own server. Atlas Vault is an app of the
[Atlas](https://github.com/atlastodo/atlas) suite: it signs in with the same account as
[Atlas Todo](https://github.com/atlastodo/atlas-todo) and Atlas Journal, keeps its items under a
key of its own, and the server only ever stores ciphertext: not even an item's name, type, site
or folder.

- **Items of every kind**: logins, secure notes, cards, identities, SSH keys and API keys, each
  with typed fields (text, hidden, TOTP, email, URL, phone), websites, notes, tags, a folder and
  a favorite flag.
- **Find them**: search names, websites, usernames and tags (never a secret value); filter by
  folder, favorites, type and tag.
- **Copy, don't show**: hidden fields stay masked until revealed. A copied secret is marked
  sensitive on Android and cleared from the clipboard after a timeout (10 s to 2 min) and on lock.
- **TOTP codes** from a TOTP field (an `otpauth://` link or a base32 secret), counting down.
- **A password generator**: passwords (length, character classes, look-alikes left out) or
  passphrases (BIP39 words), from the platform's secure random generator.
- **Secret history**: changing or removing a hidden or TOTP field keeps its earlier values (five
  per field).
- **Trash**: deleting moves an item to the trash, to restore or delete for good.
- **Auto-lock** after inactivity (1 min to 4 h, per device) and on demand. Locking forgets the
  vault's keys and every decrypted item on the device; the account password opens it again.
- **API tokens for CI**: make a vault token in Settings (read-only unless you allow writes, and
  it always expires, within a year) and read secrets in a pipeline with
  `atlas vault get "Deploy key" --field token`.
- **Web first**, the same app on Android (Expo + React Native, the web through
  react-native-web).

Not in this version: a browser extension or autofill, sharing items with other accounts, and
offline use (see [How it works](#how-it-works)).

## How it works

Atlas Vault is a client of an Atlas server (the core repository,
[atlastodo/atlas](https://github.com/atlastodo/atlas)); it has no server of its own. The server
must offer the vault: `ATLAS_APPS=todo,vault` (core 0.1.11-rc.8 or later).

- **One account, separate keys.** The account password opens the account root key; the root key
  opens one key per app. On the first sign-in, Atlas Vault creates the vault's key and identity
  under the root and enables the vault for the account (client-core's `enableApp`). It never
  keeps Atlas Todo's key, and the other apps never see the vault's.
- **End-to-end encrypted.** Every field of an item and a folder is encrypted on the device under
  the vault key before it is sent; core's `manifests/vault.json` keeps no field in plaintext.
- **Its own sync scope.** The vault syncs only its own ops (`x-atlas-sync-apps: vault`).
- **The CLI's rules.** Items are written by core's shared rules (`@atlastodo/shared`), the same
  the `atlas vault` CLI and the SDK's `VaultClient` use, and an end-to-end test runs the app's
  code and the CLI against a real server, both ways.
- **Nothing decrypted at rest.** The vault's store is in memory only: each unlock pulls the vault
  from the server, and locking or closing the app drops it. (Core's durable local store keeps
  values in plaintext, which a locked password manager must not leave on disk; offline use waits
  for an encrypted one.) The session's keys are kept only while unlocked: in the OS keychain on
  Android, sealed under a non-extractable WebCrypto key in a browser.

The cryptography, store and sync come from the core packages
([`@atlastodo/client-core`](https://www.npmjs.com/package/@atlastodo/client-core) and
[`@atlastodo/shared`](https://www.npmjs.com/package/@atlastodo/shared) on npm); this repository
adds no crypto of its own beyond TOTP (HMAC from `@noble/hashes`).

## Use it

- **On the web**: serve the release's `atlas-vault-web-X.Y.Z.tar.gz` from any static host. If
  the Atlas server serves it (its `STATIC_DIR`, or `services.atlas.staticDir` in NixOS) the app
  finds the server on its own origin; anywhere else, type the server's address on the sign-in
  screen. The flake builds the same directory: `nix build github:atlastodo/atlas-vault#web-dist`.
- **On Android**: the release's APK.
- **In CI**: Settings → API tokens for CI → Create token, store it as a CI secret, then
  `ATLAS_URL=https://your.server ATLAS_TOKEN=atlas_pat_… atlas vault get "Deploy key" --field token`
  (see core's
  [integrations guide](https://github.com/atlastodo/atlas/blob/main/docs/integrations.md)).

Account management (password, recovery phrase, passkeys, devices, deleting the account) lives in
Atlas Todo for now; the vault shows the recovery phrase of an account it creates.

## Develop

Everything runs in the devenv shell (`devenv shell`, or `direnv allow`); see [AGENTS.md](AGENTS.md)
for the details.

```sh
devenv shell
bun install
web:dev          # the web app on http://localhost:8081, against EXPO_PUBLIC_API_URL
test:all         # vault-core (vitest) and the app (jest-expo)
lint             # typecheck, ESLint, Prettier, licences, nix/bun.nix
e2e:cli          # the app's code and the atlas CLI against a real server (E2E_WEB=1: also a browser)
```

The server is in the core repository: run it there with `ATLAS_APPS=todo,vault`
(`devenv up`, then `cargo run -p atlas-server`), or its image.

## Layout

- `apps/vault`: the Expo app (Android and the web).
- `packages/vault-core`: the vault without a UI: items and folders over core's shared rules,
  the list's query, the generator, TOTP, auto-lock timing, opening the vault key, vault API
  tokens and the sync engine; also its end-to-end tests.
- `scripts/`: release tooling and the end-to-end runners.

## Licence

[GNU Affero General Public License v3.0 only](LICENSE), like the rest of Atlas.
