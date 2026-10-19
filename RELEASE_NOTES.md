## v0.1.0-rc.1

The first preview of Atlas Vault, an end-to-end encrypted password manager on your Atlas account. Sign in with your Atlas Todo account, or create one. It needs an Atlas server with the vault app enabled (`ATLAS_APPS=todo,vault`, core v0.1.11-rc.9 or later); serve the web build attached here as static files. It includes a password generator, TOTP codes and auto-lock, and works offline: the vault is kept on the device, encrypted at rest. Settings makes CI tokens, which are vault-only, read-only unless you allow writes, and expire within a year; use them with `atlas vault` or the SecretSpec provider. Android builds come once signing is set up. This is a preview: keep another copy of anything you can't lose.

### Features
- An offline vault on the sealed on-disk store
- Keep the vault on disk, sealed at rest
- Atlas Vault for the web and Android
- Open the vault app key, vault API tokens and the sync engine
- Auto-lock timing
- Password generator and TOTP codes
- Vault items and folders over core's shared item rules

### Documentation
- Offline use and the sealed local store
- README and agent guide

### Maintenance
- 1 dependency update, 5 maintenance commits (CI, build, tests)
