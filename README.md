# Atlas Vault

**The Atlas Vault web app is a test app for Atlas core: it checks that core's client libraries
(including the sealed local store) and the server's vault token policies work for an app other
than todo. It is not a product, has no releases, and must not be used to store real secrets.**
What is released here is the vault's command line for CI: the [`atlas-vault` CLI](#the-atlas-vault-cli)
and the [SecretSpec provider](#secretspec).

It is a password-manager-shaped client of an Atlas server (the core repository,
[atlastodo/atlas](https://github.com/atlastodo/atlas)), built only from core's published packages
([`@atlastodo/client-core`](https://www.npmjs.com/package/@atlastodo/client-core) and
[`@atlastodo/sdk`](https://www.npmjs.com/package/@atlastodo/sdk)) and core's `atlas-client` crate,
at an exact core version. Moving that pin here exercises a core change from the outside:

- `packages/vault-core`: the vault's item rules (`test-vectors/vault_item_vectors.json`, shared with
  the Rust rules), items and folders over them, the sealed on-disk store (`sealPersistence`: ciphertext on disk,
  reopening offline, the wrong key, offline edits across a restart), the password generator, TOTP
  (the RFC 6238 vectors), auto-lock timing, opening the vault app key and vault API tokens.
  The headless `VaultClient` for integrations is `@atlastodo/vault-core/client`.
- `crates/`: the same item rules in Rust on core's `atlas-client` (`atlas-vault-rules`), the
  `atlas-vault` CLI and `secretspec-provider-atlas` over them.
- `packages/vault-core/e2e`, `crates/*/tests/e2e.rs` and `scripts/e2e-web.mjs`: the vault, the CLI
  and the provider against a real core server (`ATLAS_APPS=todo,vault`), both ways, including the
  server's token policies (read-only tokens refused writes, typed policy errors).
- `apps/vault`: an Expo web app over the same code, for manual testing and the browser checks.

## Run the tests

Everything runs in the devenv shell (`devenv shell`, or `devenv shell -- <script>`); see
[AGENTS.md](AGENTS.md) for the details.

```sh
bun install
test:all         # the crates (nextest), vault-core (vitest) and the app (jest-expo)
lint             # rustfmt, clippy, typecheck, oxlint, Prettier, licences, nix/bun.nix
e2e:cli          # the CLI, the provider and vault-core against a real server (E2E_WEB=1: also a browser)
```

`e2e:cli` builds the server from a core checkout (`ATLAS_CORE_DIR`, default `../atlas`) and the
CLI and the provider here, drives the provider with the real `secretspec` (devenv ships it), and
needs a Postgres (`E2E_DATABASE_URL`, default the devenv one on localhost:5432).

## Run the web app locally

Start a core server that offers the vault: in the core checkout, `devenv up`, then
`ATLAS_APPS=todo,vault cargo run -p atlas-server`. Then, here:

```sh
web:dev          # the web app on http://localhost:8081, against EXPO_PUBLIC_API_URL
web:export       # the static export in apps/vault/dist
```

`EXPO_PUBLIC_API_URL` defaults to `http://localhost:8080`; the sign-in screen can name another
server.

## The `atlas-vault` CLI

`atlas-vault` reads and writes vault items for CI jobs and scripts that need a secret, end to end
encrypted: it signs in with an API token that includes Atlas Vault (see [Vault tokens for CI](https://github.com/atlastodo/atlas/blob/main/docs/integrations.md#vault-tokens-for-ci) in core's
integrations guide: such a token expires, and reads only unless made with writes), decrypts the
vault on the machine it runs on and prints JSON. It needs a server that offers Atlas Vault
(`ATLAS_APPS=todo,vault`). These were the `atlas vault …` commands of core's `atlas` CLI, which
they replace: `atlas-vault vault list` still works, and the output is the same.

It is one static binary per platform, attached to each release as `atlas-vault-X.Y.Z-<target>`
(`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` for any Linux, Alpine included;
`aarch64-apple-darwin`, `x86_64-apple-darwin`; `x86_64-pc-windows-msvc.exe`):

```sh
VERSION=X.Y.Z
TARGET=x86_64-unknown-linux-musl
BASE=https://github.com/atlastodo/atlas-vault/releases/download/v$VERSION
curl -fLO "$BASE/atlas-vault-$VERSION-$TARGET"
curl -fLO "$BASE/SHA256SUMS.txt"
sha256sum --check --ignore-missing SHA256SUMS.txt
install -m 755 "atlas-vault-$VERSION-$TARGET" /usr/local/bin/atlas-vault
```

Each file carries a build provenance attestation
(`gh attestation verify atlas-vault-$VERSION-$TARGET --repo atlastodo/atlas-vault`). The
environment configures it (`ATLAS_URL`, or `--url`; `ATLAS_TOKEN`, never a flag;
`ATLAS_STATE_DIR`, optional). Every command prints JSON (but `get --field`); a failure prints
`{"error": …, "code": …}` on stderr and exits 1 (2 for a usage error).

```sh
atlas-vault list [--folder F] [--type T] [--tag T] [--search TEXT]   # no secret values
atlas-vault get "Deploy key"                     # the item, secrets included
atlas-vault get "Deploy key" --field token       # one value, as plain text
DEPLOY_TOKEN="$(atlas-vault get 'Deploy key' --field token)"
atlas-vault add --name "Deploy key" --type api_key --hidden token=… --folder CI --tag prod
atlas-vault add --json - < item.json             # the object from stdin: no secret in argv
atlas-vault update "Deploy key" --hidden token=… --remove-field old --favorite true
atlas-vault delete "Deploy key"                  # to the trash
atlas-vault folders list
atlas-vault folders add CI
```

`ITEM` and `F` are names (case-insensitive, outside the trash) or ids; a name two items share is
refused with `ambiguous_vault_item`, so use the id. `list` and every write print items without
their field values, notes or history, so a CI log does not end up holding a secret; `get` prints
everything, and `get ITEM --field NAME` prints only that field's value (case-insensitive name)
followed by a newline. A flag on the command line is visible in the process list: pass secrets
with `--json -` on stdin. Field flags add or replace one field (`--username`, `--password` and
`--totp` name theirs; `--text` and `--hidden` take `NAME=VALUE`), and on `update` leave the item's
other fields alone; `--json` takes the keys below, and on `update` also `set_fields` (fields to
add or replace) and `remove_fields` (names) in place of a whole `fields` list. `--folder none`
clears the folder.

An item (`vault.item`) is printed, and stored, with these fields:

| Field        | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `id`         | the item's id (a UUID)                                                                           |
| `type`       | `login` (the default), `note`, `card`, `identity`, `ssh_key` or `api_key` (any other secret)     |
| `name`       | text, required                                                                                   |
| `fields`     | `[{name, kind, value}]`, names unique (case-insensitive)                                         |
| `urls`       | a list of URLs, trimmed, without repeats                                                         |
| `notes`      | text                                                                                             |
| `tags`       | a list of strings, trimmed, without repeats (case-insensitive)                                   |
| `folder`     | a folder's id, or `null`; `folder_name` is printed next to it                                    |
| `favorite`   | `true` or `false`                                                                                |
| `history`    | earlier values of secret fields, `{field, value, changed_at}`, newest first, 5 per field at most |
| `created_at` | unix milliseconds                                                                                |
| `updated_at` | unix milliseconds of the last change                                                             |
| `deleted_at` | unix milliseconds once in the trash, else `null`                                                 |

A field's `kind` is `text` (the default), `hidden` (a secret), `totp` (a TOTP seed: an
`otpauth://` URI, or a base32 secret stored upper-case without spaces), `email`, `url` or `phone`.
Changing or removing a `hidden` or `totp` field keeps its old value in `history`. A folder
(`vault.folder`) has a `name` and the same timestamps. Every field of both is end-to-end
encrypted: core's `manifests/vault.json` lists no plaintext field, so the server sees only ids and
ciphertext, not even an item's type or name. The rules are this repository's, in Rust
(`crates/atlas-vault-rules`) and TypeScript (`packages/vault-core/src/itemRules.ts`, and the
headless `VaultClient` in `@atlastodo/vault-core/client`), held together by
`test-vectors/vault_item_vectors.json`.

Each run signs in, downloads and decrypts the account, then exits. That takes about a second for
a typical account, and longer for a very large one. With `ATLAS_STATE_DIR` set, a run keeps the
account there and the next one downloads only what changed. The file is encrypted under a key
derived from the token, so only the token opens it, but it holds your vault: keep the directory as
private as the token. Token sign-ins share the per-IP `/auth/*`
rate limit (`AUTH_RATE_LIMIT_MAX`, 30 a minute by default), so space out bursts of CLI calls from
one machine, or raise the limit on your own server.

## SecretSpec

[SecretSpec](https://secretspec.dev) (0.21 or newer) declares the secrets a project needs in
`secretspec.toml` and resolves them from a provider. `secretspec-provider-atlas` is a provider for
Atlas Vault, an external one in SecretSpec's terms (its Secret Provider Protocol): SecretSpec runs
it for every provider URI with the `atlas` scheme, and it signs in with a vault token, decrypts the
vault on the machine it runs on and answers SecretSpec over a private pipe
(`crates/atlas-secretspec`). Every release here attaches it next to the CLI, as
`secretspec-provider-atlas-X.Y.Z-<target>` (until core v0.1.15 it was released from the core
repository). Put it somewhere only you can
write and register it once per user (or, with `--system`, per machine):

```sh
install -m 755 secretspec-provider-atlas-X.Y.Z-x86_64-unknown-linux-musl ~/.local/bin/secretspec-provider-atlas
secretspec-provider-atlas register    # writes ~/.config/secretspec/providers.d/atlas.secretspec.json
```

The registration names the binary and the environment SecretSpec passes it (`ATLAS_URL`,
`ATLAS_TOKEN`, `ATLAS_STATE_DIR`; SecretSpec gives an external provider nothing else of the
caller's environment). SecretSpec refuses a registration or binary that others can write, and it
does not look for providers on `PATH`. `register --print` prints the registration instead.

### Where secrets live

A provider URI is `atlas://` (the server in `ATLAS_URL`) or `atlas://HOST[:PORT][/PATH]` (HTTPS;
HTTP for `localhost`). It carries no token. SecretSpec's names map onto the vault like this:

| SecretSpec                            | Atlas Vault                                                |
| ------------------------------------- | ---------------------------------------------------------- |
| project (`[project] name`)            | a folder of that name                                      |
| profile (`development`, `production`) | an item of that name in the folder                         |
| secret (`DATABASE_URL`)               | a field of that name in the item (`hidden` when set by it) |
| `ref = { item, field }`               | the item of that name (or id) anywhere in the vault, field |
| `ref = { vault, item, field }`        | the item of that name in the folder `vault`, field         |

So the secrets of project `payments` are the folder **payments**, with an item per profile
(**production**, **staging**) holding one field per secret, and you can keep them in the app or
with the CLI:

```sh
atlas-vault folders add payments
atlas-vault add --json - <<'EOF'
{"name": "production", "type": "api_key", "folder": "payments",
 "fields": [{"name": "DATABASE_URL", "kind": "hidden", "value": "postgres://…"}]}
EOF
```

Names match case-insensitively and must be unique: two items of one name in a folder (or, for a
`ref` without `vault`, in the vault) fail with `conflict` rather than picking one. A missing
folder, item or field is a missing secret, which `secretspec check` reports as such. A `ref` needs
a `field`; `section` and `version` are refused. `secretspec set` (with a token that may write)
replaces the field's value, keeping the old one in the item's history as any change of a hidden
field does, or adds the field, creating the folder and the item (an `api_key` item tagged
`secretspec`) when they are missing.

### Tokens

Make a vault token as for any CI job (see [Vault tokens for CI](https://github.com/atlastodo/atlas/blob/main/docs/integrations.md#vault-tokens-for-ci)): it
expires (within a year) and reads only unless made with writes. The provider takes it from
`ATLAS_TOKEN`, or, when that is not set, asks SecretSpec for its credential `token`, which
`secretspec config provider login` stores in the system keyring or an alias's `credentials`
table names. A read-only token resolves secrets and is refused `secretspec set` with
`permission_denied` before you are asked for the value; keep a token with writes for whoever
stores the secrets. `ATLAS_STATE_DIR` caches the vault between runs, as for the CLI.

SecretSpec shows an external provider's errors by kind only, so `secretspec-provider-atlas status
[URI]` signs in as SecretSpec would and says what is wrong in words (and, when nothing is, the
server, whether the token may write and when it expires):

| SecretSpec says        | Meaning                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `interaction required` | no token, or it expired, was revoked or is not an Atlas API token: make one |
| `permission denied`    | a write with a read-only token, or a token that is not for Atlas Vault      |
| `conflict`             | two folders or items share the name the secret maps to                      |
| `invalid params`       | a bad URI (a token in it, no server) or a `ref` without `field`             |
| `unavailable`          | the server did not answer, or rate-limited the sign-in (retried)            |
| `operation failed`     | anything else, e.g. a server without Atlas Vault: run `status`              |

### Examples

```toml
# secretspec.toml
[project]
name = "payments"
revision = "1.0"

[providers]
atlas_vault = "atlas://app.atlastodo.dev"

[defaults]
providers = ["atlas_vault"]

[profiles.default]
DATABASE_URL = { description = "Postgres", required = true }
DEPLOY_TOKEN = { description = "Deploy key", required = true, ref = { item = "Deploy key", field = "token" } }

[profiles.production]
DATABASE_URL = { required = true }
```

```sh
secretspec check --profile production
secretspec run --profile production -- ./deploy.sh
```

In CI, give the job a read-only vault token as a secret variable, install and register the
provider, and run the same commands:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: |
    curl -fsSLo /usr/local/bin/secretspec-provider-atlas \
      https://github.com/atlastodo/atlas-vault/releases/download/vX.Y.Z/secretspec-provider-atlas-X.Y.Z-x86_64-unknown-linux-musl
    chmod 755 /usr/local/bin/secretspec-provider-atlas
    secretspec-provider-atlas register
    secretspec run --profile production -- ./deploy.sh
  env:
    ATLAS_TOKEN: ${{ secrets.ATLAS_VAULT_TOKEN }}
```

With [devenv](https://devenv.sh), whose SecretSpec integration loads the declared secrets into the
shell, select the provider and profile in `devenv.yaml` (devenv 2.4 embeds SecretSpec 0.21, the
first to run external providers; register the provider as above):

```yaml
# devenv.yaml
secretspec:
  enable: true
  provider: atlas://app.atlastodo.dev
  profile: development
```

```nix
# devenv.nix
{ config, ... }:
{
  env.DATABASE_URL = config.secretspec.secrets.DATABASE_URL or "";
}
```

## Licence

[GNU Affero General Public License v3.0 only](LICENSE), like the rest of Atlas.
