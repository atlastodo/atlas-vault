# Atlas Vault

**Atlas Vault is a test app for Atlas core: it checks that core's client libraries (including the
sealed local store), the server's vault token policies and the CLI work for an app other than
todo. It is not a product, has no releases, and must not be used to store real secrets.**

It is a password-manager-shaped client of an Atlas server (the core repository,
[atlastodo/atlas](https://github.com/atlastodo/atlas)), built only from core's published packages
([`@atlastodo/client-core`](https://www.npmjs.com/package/@atlastodo/client-core) and
[`@atlastodo/shared`](https://www.npmjs.com/package/@atlastodo/shared)) at an exact core version.
Moving that pin here exercises a core change from the outside:

- `packages/vault-core`: vault items and folders over core's shared item rules (replaying core's
  `vault_item_vectors.json`), the sealed on-disk store (`sealPersistence`: ciphertext on disk,
  reopening offline, the wrong key, offline edits across a restart), the password generator, TOTP
  (the RFC 6238 vectors), auto-lock timing, opening the vault app key and vault API tokens.
- `packages/vault-core/e2e` and `scripts/e2e-web.mjs`: the vault and the `atlas` CLI against a
  real core server (`ATLAS_APPS=todo,vault`), both ways, including the server's token policies
  (read-only tokens refused writes, typed policy errors).
- `apps/vault`: an Expo web app over the same code, for manual testing and the browser checks.

## Run the tests

Everything runs in the devenv shell (`devenv shell`, or `devenv shell -- <script>`); see
[AGENTS.md](AGENTS.md) for the details.

```sh
bun install
test:all         # vault-core (vitest) and the app (jest-expo)
lint             # typecheck, ESLint, Prettier, licences, nix/bun.nix
e2e:cli          # vault-core and the atlas CLI against a real server (E2E_WEB=1: also a browser)
```

`e2e:cli` builds the server and the CLI from a core checkout (`ATLAS_CORE_DIR`, default
`../atlas`) and needs a Postgres (`E2E_DATABASE_URL`, default the devenv one on localhost:5432).

## Run the web app locally

Start a core server that offers the vault: in the core checkout, `devenv up`, then
`ATLAS_APPS=todo,vault cargo run -p atlas-server`. Then, here:

```sh
web:dev          # the web app on http://localhost:8081, against EXPO_PUBLIC_API_URL
web:export       # the static export in apps/vault/dist
```

`EXPO_PUBLIC_API_URL` defaults to `http://localhost:8080`; the sign-in screen can name another
server.

## Licence

[GNU Affero General Public License v3.0 only](LICENSE), like the rest of Atlas.
