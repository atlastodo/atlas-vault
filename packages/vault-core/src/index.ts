/**
 * `@atlastodo/vault-core`: Atlas Vault without a UI. The vault items and folders in a client-core
 * store (core's shared item rules, at parity with the `atlas vault` CLI), the list's query, the
 * password generator, TOTP codes, auto-lock timing, signing in and opening the vault app key,
 * vault API tokens and the sync engine. The app (apps/vault) and the end-to-end tests use it; it
 * imports nothing platform-specific.
 */

export * from "./items";
export * from "./query";
export * from "./generator";
export * from "./totp";
export * from "./autoLock";
export * from "./account";
export * from "./apiTokens";
export * from "./engine";
export {
  VAULT_FIELD_KINDS,
  VAULT_HISTORY_PER_FIELD,
  VAULT_ITEM_TYPES,
  VaultError,
  type VaultField,
  type VaultFieldInput,
  type VaultHistoryEntry,
  type VaultItem,
  type VaultItemInput,
  type VaultItemPatch,
  type VaultItemType,
} from "@atlastodo/shared";
