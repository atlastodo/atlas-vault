/**
 * The vault's items and folders in a client-core {@link LocalStore}. Every rule an item obeys is
 * core's (`@atlastodo/shared`'s `vault.ts`, held to the `atlas vault` CLI and the SDK by
 * `vault_item_vectors.json`): {@link newVaultItemFields} for a new item, {@link vaultItemChanges}
 * for an edit (it also keeps the history of changed secret fields), {@link toVaultItem} to read
 * one. This module only maps them onto the store's field writes, which the sync client pushes.
 * Nothing here talks to the network.
 */

import { isEncryptedEnvelope, type EntityKind, type LocalStore } from "@atlastodo/client-core";
import {
  VaultError,
  newVaultItemFields,
  toVaultItem,
  vaultItemChanges,
  type VaultItem,
  type VaultItemInput,
  type VaultItemPatch,
} from "@atlastodo/shared";
import { queryItems, type VaultQuery } from "./query";

/** The Atlas Vault app id: the `x-atlas-sync-apps` scope and the app key's name. */
export const VAULT_APP = "vault";
export const VAULT_ITEM: EntityKind = "vault.item";
export const VAULT_FOLDER: EntityKind = "vault.folder";

/** An item, and whether any of its fields is ciphertext this device cannot open. */
export interface ItemView extends VaultItem {
  locked: boolean;
}

export interface FolderView {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  locked: boolean;
}

/** Whether some field still holds ciphertext no key on this device opens (never edit such an item). */
export function isLocked(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some((v) => isEncryptedEnvelope(v));
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

function toFolder(id: string, f: Record<string, unknown>): FolderView {
  return {
    id,
    name: typeof f.name === "string" ? f.name : "",
    created_at: num(f.created_at) ?? 0,
    updated_at: num(f.updated_at) ?? 0,
    deleted_at: num(f.deleted_at),
    locked: isLocked(f),
  };
}

/** By lower-cased name, then id: the CLI's and the SDK's order. */
export function byNameThenId(
  a: { name: string; id: string },
  b: { name: string; id: string },
): number {
  const [an, bn] = [a.name.toLowerCase(), b.name.toLowerCase()];
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface VaultItemsOptions {
  /** Unix ms; `Date.now` by default. */
  now?: () => number;
}

export class VaultItems {
  private readonly now: () => number;

  constructor(
    private readonly store: LocalStore,
    opts: VaultItemsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Changes whenever an item or folder does; a memo key for derived lists. */
  revision(): number {
    return this.store.revision(VAULT_ITEM) + this.store.revision(VAULT_FOLDER);
  }

  /** Every item, trashed ones included, unordered. */
  all(): ItemView[] {
    return this.store
      .list(VAULT_ITEM)
      .map((e) => ({ ...toVaultItem(e.id, e.fields), locked: isLocked(e.fields) }));
  }

  /** Items outside the trash matching `query`, by name (the CLI's `list`). */
  list(query: VaultQuery = {}): ItemView[] {
    return queryItems(this.all(), query);
  }

  /** Items in the trash, most recently trashed first. */
  trashed(): ItemView[] {
    return this.all()
      .filter((i) => i.deleted_at !== null)
      .sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
  }

  /** One item by id, trashed or not; null when there is none. */
  get(id: string): ItemView | null {
    const fields = this.store.get(VAULT_ITEM, id);
    return fields ? { ...toVaultItem(id, fields), locked: isLocked(fields) } : null;
  }

  private require(id: string): ItemView {
    const item = this.get(id);
    if (!item) throw new VaultError("unknown_vault_item", `no vault item "${id}"`);
    return item;
  }

  private requireOpen(id: string): ItemView {
    const item = this.require(id);
    if (item.locked) throw new VaultError("bad_input", "this item cannot be opened on this device");
    return item;
  }

  private write(entity: EntityKind, id: string, fields: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(fields)) this.store.set(entity, id, field, value);
  }

  private checkFolder(folder: string | null | undefined): void {
    if (folder == null) return;
    if (!this.folders().some((f) => f.id === folder)) {
      throw new VaultError("unknown_vault_folder", `no vault folder "${folder}"`);
    }
  }

  /** Write a new item. Throws {@link VaultError} on input the shared rules refuse. */
  create(input: VaultItemInput): ItemView {
    const fields = newVaultItemFields(input, this.now());
    this.checkFolder(fields.folder as string | null);
    const id = this.store.newEntityId();
    this.write(VAULT_ITEM, id, fields);
    return this.require(id);
  }

  /**
   * Change an item; unchanged values write nothing. A changed or removed secret field leaves its
   * old value in the item's history (the shared rules decide).
   */
  update(id: string, patch: VaultItemPatch): ItemView {
    this.requireOpen(id);
    const current = this.store.get(VAULT_ITEM, id) ?? {};
    const changes = vaultItemChanges(current, patch, this.now());
    if ("folder" in changes) this.checkFolder(changes.folder as string | null);
    if (Object.keys(changes).length > 0) this.write(VAULT_ITEM, id, changes);
    return this.require(id);
  }

  /** Move an item to the trash (`deleted_at`); a no-op when it already is. */
  trash(id: string): void {
    const item = this.require(id);
    if (item.deleted_at !== null) return;
    const now = this.now();
    this.write(VAULT_ITEM, id, { deleted_at: now, updated_at: now });
  }

  /** Take an item out of the trash; a no-op when it is not in it. */
  restore(id: string): void {
    const item = this.require(id);
    if (item.deleted_at === null) return;
    this.write(VAULT_ITEM, id, { deleted_at: null, updated_at: this.now() });
  }

  /** Delete a trashed item for good (a delete op: every field, its history included, is dropped). */
  purge(id: string): void {
    const item = this.require(id);
    if (item.deleted_at === null) {
      throw new VaultError("bad_input", "move the item to the trash before deleting it for good");
    }
    this.store.remove(VAULT_ITEM, id);
  }

  /** Folders outside the trash, by name. */
  folders(): FolderView[] {
    return this.store
      .list(VAULT_FOLDER)
      .map((e) => toFolder(e.id, e.fields))
      .filter((f) => f.deleted_at === null)
      .sort(byNameThenId);
  }

  /** A folder's name, or null for no folder or one that is gone. */
  folderName(id: string | null): string | null {
    if (!id) return null;
    return this.folders().find((f) => f.id === id)?.name ?? null;
  }

  private checkFolderName(name: string, except?: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new VaultError("bad_input", "a vault folder needs a name");
    if (this.folders().some((f) => f.id !== except && sameName(f.name, trimmed))) {
      throw new VaultError("vault_folder_exists", `there is already a vault folder "${trimmed}"`);
    }
    return trimmed;
  }

  /** A new folder (names are unique, case-insensitively, like the CLI's `folders add`). */
  createFolder(name: string): FolderView {
    const trimmed = this.checkFolderName(name);
    const now = this.now();
    const id = this.store.newEntityId();
    this.write(VAULT_FOLDER, id, { name: trimmed, created_at: now, updated_at: now });
    return this.folders().find((f) => f.id === id)!;
  }

  renameFolder(id: string, name: string): void {
    const folder = this.folders().find((f) => f.id === id);
    if (!folder) throw new VaultError("unknown_vault_folder", `no vault folder "${id}"`);
    const trimmed = this.checkFolderName(name, id);
    if (trimmed !== folder.name)
      this.write(VAULT_FOLDER, id, { name: trimmed, updated_at: this.now() });
  }

  /**
   * Trash a folder. Its items, trashed ones too, move out of it first (a folder id pointing at
   * nothing would read as "no folder" here but stays an id to the CLI).
   */
  deleteFolder(id: string): void {
    if (!this.folders().some((f) => f.id === id)) {
      throw new VaultError("unknown_vault_folder", `no vault folder "${id}"`);
    }
    const now = this.now();
    for (const item of this.all()) {
      if (item.folder === id && !item.locked) {
        this.write(VAULT_ITEM, item.id, { folder: null, updated_at: now });
      }
    }
    this.write(VAULT_FOLDER, id, { deleted_at: now, updated_at: now });
  }

  /** Every tag on an item outside the trash, once (case-insensitively), sorted. */
  tags(): string[] {
    const seen = new Map<string, string>();
    for (const item of this.all()) {
      if (item.deleted_at !== null) continue;
      for (const t of item.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    }
    return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }
}
