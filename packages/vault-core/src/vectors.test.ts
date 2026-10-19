/**
 * Core's fixtures, read from the pinned npm packages (so a core bump that changes a rule shows
 * up here): `vault_item_vectors.json` (the item rules the `atlas vault` CLI and the SDK share)
 * replayed through this package's store-backed {@link VaultItems}, so what the app writes is
 * what the CLI would; and `field_policy_vectors.json` for the vault's kinds and token policy.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  LocalStore,
  shouldEncryptKindField,
  tokenPolicyFor,
  type Operation,
} from "@atlastodo/client-core";
import { VaultError } from "@atlastodo/shared";
import { describe, expect, it } from "vitest";
import { VAULT_TOKEN_POLICY } from "./apiTokens";
import { VAULT_FOLDER, VAULT_ITEM, VaultItems } from "./items";

const require = createRequire(import.meta.url);
const read = (spec: string) => JSON.parse(readFileSync(require.resolve(spec), "utf8"));

type Fields = Record<string, unknown>;
interface Failure {
  code: string;
  message: string;
}
interface ItemVectors {
  now: number;
  create: { name: string; input: unknown; fields?: Fields; error?: Failure }[];
  update: { name: string; item: Fields; patch: unknown; changes?: Fields; error?: Failure }[];
}
interface PolicyVectors {
  fields: { entity: string; field: string; encrypted: boolean }[];
  token_policies: { apps: string[]; policy: unknown }[];
}

const items: ItemVectors = read("@atlastodo/shared/test-vectors/vault_item_vectors.json");
const policies: PolicyVectors = read(
  "@atlastodo/client-core/test-vectors/field_policy_vectors.json",
);

/** Every UUID-looking string a vector names as a folder: made as folders first. */
function folderIds(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      for (const [k, val] of Object.entries(x)) {
        if (k === "folder" && typeof val === "string") out.push(val.trim());
        else walk(val);
      }
    }
  };
  walk(v);
  return out;
}

function vault(seedFolders: string[]) {
  const store = new LocalStore("vectors", { now: () => items.now });
  for (const id of seedFolders) store.set(VAULT_FOLDER, id, "name", `folder ${id}`);
  return { store, vault: new VaultItems(store, { now: () => items.now }) };
}

function outcome<T>(run: () => T): { ok: T } | { error: Failure } {
  try {
    return { ok: run() };
  } catch (e) {
    if (!(e instanceof VaultError)) throw e;
    return { error: { code: e.code, message: e.message } };
  }
}

const itemOps = (ops: Operation[]) => ops.filter((o) => o.entity === VAULT_ITEM);

describe("vault item vectors through the store", () => {
  it.each(items.create.map((c) => [c.name, c] as const))("create: %s", (_, c) => {
    const { store, vault: v } = vault(folderIds(c.input));
    const got = outcome(() => {
      const made = v.create(c.input as never);
      return store.get(VAULT_ITEM, made.id);
    });
    expect(got).toEqual(c.error ? { error: c.error } : { ok: c.fields });
    if (c.error) expect(itemOps(store.unsyncedOps())).toEqual([]);
  });

  it.each(items.update.map((c) => [c.name, c] as const))("update: %s", (_, c) => {
    const { store, vault: v } = vault(folderIds([c.item, c.patch]));
    const id = "0192f000-0000-7000-8000-0000000000aa";
    for (const [field, value] of Object.entries(c.item)) store.set(VAULT_ITEM, id, field, value);
    const before = itemOps(store.unsyncedOps()).length;
    const got = outcome(() => {
      v.update(id, c.patch as never);
      const written: Fields = {};
      for (const op of itemOps(store.unsyncedOps()).slice(before)) {
        if (op.op === "set") written[op.field] = op.value;
      }
      return written;
    });
    expect(got).toEqual(c.error ? { error: c.error } : { ok: c.changes });
  });
});

describe("field policy vectors (vault)", () => {
  it.each(policies.fields.filter((f) => f.entity.startsWith("vault.")))(
    "$entity.$field encrypted: $encrypted",
    (f) => {
      expect(shouldEncryptKindField(f.entity, f.field)).toBe(f.encrypted);
    },
  );

  it("bundles the vault's token policy", () => {
    for (const p of policies.token_policies) expect(tokenPolicyFor(p.apps)).toEqual(p.policy);
    const vaultOnly = policies.token_policies.find((p) => p.apps.join() === "vault");
    expect(VAULT_TOKEN_POLICY).toEqual(vaultOnly!.policy);
    expect(VAULT_TOKEN_POLICY).toEqual({
      expiry_required: true,
      max_lifetime_days: 365,
      write_by_default: false,
      exclusive: true,
    });
  });
});
