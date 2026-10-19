/**
 * Filtering and ordering the vault's items for the list: folders, favorites, tags, types and a
 * search, over decrypted items in memory. Like the CLI's `list`, items in the trash are left out
 * and the rest come by name. The search never looks at secret values (hidden and TOTP fields) or
 * the history.
 */

import { VAULT_FIELD_KINDS, VAULT_SECRET_KINDS, type VaultItem } from "@atlastodo/shared";

export interface VaultQuery {
  /** A folder id, or `"none"` for items in no folder; all folders when left out. */
  folder?: string;
  /** Only favorites. */
  favorites?: boolean;
  /** A tag, case-insensitive. */
  tag?: string;
  /** An item type (`login`, `card`, …). */
  type?: string;
  /** Case-insensitive words, each found in the name, a URL, a tag or a non-secret field value. */
  search?: string;
}

/** Whether a field's value is a secret (a kind this client does not know counts as one). */
export function isSecretKind(kind: string): boolean {
  return (
    (VAULT_SECRET_KINDS as readonly string[]).includes(kind) ||
    !(VAULT_FIELD_KINDS as readonly string[]).includes(kind)
  );
}

function haystack(item: VaultItem): string {
  return [
    item.name,
    ...item.urls,
    ...item.tags,
    ...item.fields.filter((f) => !isSecretKind(f.kind)).map((f) => f.value),
  ]
    .join("\n")
    .toLowerCase();
}

function byNameThenId(a: VaultItem, b: VaultItem): number {
  const [an, bn] = [a.name.toLowerCase(), b.name.toLowerCase()];
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function queryItems<T extends VaultItem>(items: readonly T[], query: VaultQuery = {}): T[] {
  const tag = query.tag?.trim().toLowerCase();
  const words = (query.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter((i) => i.deleted_at === null)
    .filter((i) =>
      query.folder === undefined
        ? true
        : query.folder === "none"
          ? i.folder === null
          : i.folder === query.folder,
    )
    .filter((i) => !query.favorites || i.favorite)
    .filter((i) => !query.type || i.type === query.type)
    .filter((i) => !tag || i.tags.some((t) => t.toLowerCase() === tag))
    .filter((i) => {
      if (words.length === 0) return true;
      const text = haystack(i);
      return words.every((w) => text.includes(w));
    })
    .sort(byNameThenId);
}

/** The first non-secret field that reads as the item's account (a username or an email). */
export function itemSubtitle(item: VaultItem): string {
  const named = item.fields.find(
    (f) => !isSecretKind(f.kind) && /^(user(name)?|login|email|account)$/i.test(f.name.trim()),
  );
  const email = item.fields.find((f) => f.kind === "email");
  const field = named ?? email;
  if (field?.value) return field.value;
  if (item.urls[0]) return item.urls[0];
  return "";
}
