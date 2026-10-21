/**
 * The vault's on-disk log, over IndexedDB (fake-indexeddb, the browser's backend): sealed at rest
 * under a key derived from the vault key, reopened after a lock without the network, refused and
 * reset under another key, and offline edits that survive a restart and sync later.
 */
import { IDBFactory } from "fake-indexeddb";
import {
  IndexedDbPersistence,
  LOCAL_STORE_KEY_ID,
  SealedStoreError,
  deriveLocalStoreKey,
  sealPersistence,
} from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { createVaultApiClient, type VaultKeys } from "./account";
import { VaultEngine } from "./engine";
import { fakeServer, vaultKeys } from "./fakeServer.testutil";

const USER = "0192f000-0000-7000-8000-0000000000u1";

/** One browser profile's IndexedDB: each `open()` is a fresh connection, like a reload. */
function disk() {
  const factory = new IDBFactory();
  return { factory, open: () => new IndexedDbPersistence(`atlas-vault-${USER}`, factory) };
}

function engine(
  d: ReturnType<typeof disk>,
  server: ReturnType<typeof fakeServer>,
  keys: VaultKeys,
  extra: { onStoreReset?: (err: SealedStoreError) => void; userId?: string } = {},
) {
  const api = createVaultApiClient({
    baseUrl: "http://atlas.test",
    token: "t",
    fetch: server.fetch,
  });
  return new VaultEngine({
    api,
    persistence: d.open(),
    userId: extra.userId ?? USER,
    deviceId: "device-1",
    keys,
    onStoreReset: extra.onStoreReset,
  });
}

const SECRET = "sk_live_on_disk_secret";

describe("the sealed on-disk store", () => {
  it("keeps only ciphertext on disk", async () => {
    const d = disk();
    const server = fakeServer();
    const keys = vaultKeys();
    const e = engine(d, server, keys);
    await e.start();
    e.items.createFolder("Pipelines folder");
    e.items.create({
      name: "Harbour deploy key",
      type: "api_key",
      fields: [{ name: "token", kind: "hidden", value: SECRET }],
      urls: ["https://harbour.example"],
    });
    await e.syncNow();
    await e.stop();

    const raw = await d.open().load();
    expect(raw.length).toBeGreaterThan(10);
    const text = JSON.stringify(raw);
    for (const plain of [SECRET, "Harbour", "harbour.example", "api_key", "Pipelines"]) {
      expect(text).not.toContain(plain);
    }
    for (const p of raw) {
      if (p.op.op === "set")
        expect(p.op.value).toMatchObject({ __enc: 2, kid: LOCAL_STORE_KEY_ID });
    }
    // The key is the vault key's derivative for this account, not the vault key itself.
    await expect(sealPersistence(d.open(), keys.appKey).load()).rejects.toThrow(SealedStoreError);
    const opened = await sealPersistence(d.open(), deriveLocalStoreKey(keys.appKey, USER)).load();
    expect(JSON.stringify(opened)).toContain(SECRET);
  });

  it("reopens after a lock with the right key, without the network", async () => {
    const d = disk();
    const server = fakeServer();
    const keys = vaultKeys();
    const first = engine(d, server, keys);
    await first.start();
    const made = first.items.create({
      name: "Mail",
      fields: [{ name: "password", kind: "hidden", value: SECRET }],
    });
    await first.syncNow();
    await first.stop();
    // The stopped engine's database is closed: nothing more is written.
    expect(() => first.items.create({ name: "after lock" })).not.toThrow();

    server.state.online = false;
    const again = engine(d, server, keys);
    await again.start();
    expect(again.hadLocalCopy()).toBe(true);
    expect(again.items.get(made.id)?.fields[0]?.value).toBe(SECRET);
    expect(again.items.list().map((i) => i.name)).toEqual(["Mail"]);
    expect(again.pendingCount()).toBe(0);
    await again.stop();
  });

  it("refuses the log under another key, clears it and pulls again", async () => {
    const d = disk();
    const server = fakeServer();
    const mine = vaultKeys();
    const first = engine(d, server, mine);
    await first.start();
    first.items.create({ name: "Mine", fields: [{ name: "p", kind: "hidden", value: SECRET }] });
    await first.stop();

    const resets: SealedStoreError[] = [];
    const other = engine(d, server, vaultKeys(), { onStoreReset: (e) => resets.push(e) });
    await other.start();
    expect(resets).toHaveLength(1);
    expect(resets[0]).toBeInstanceOf(SealedStoreError);
    expect(other.items.all()).toEqual([]);
    expect(other.hadLocalCopy()).toBe(false);
    await other.stop();
    // Nothing of the old log is left to decrypt.
    expect(await d.open().load()).toEqual([]);
    expect(await d.open().getCursor()).toBe(0);
  });

  it("keeps an offline edit across a restart and syncs it later", async () => {
    const d = disk();
    const server = fakeServer();
    const keys = vaultKeys();
    server.state.online = false;
    const offline = engine(d, server, keys);
    await offline.start();
    const made = offline.items.create({
      name: "Written offline",
      fields: [{ name: "password", kind: "hidden", value: SECRET }],
    });
    await expect(offline.syncNow()).rejects.toThrow();
    expect(offline.pendingCount()).toBeGreaterThan(0);
    await offline.stop();

    const relaunched = engine(d, server, keys);
    await relaunched.start();
    expect(relaunched.items.get(made.id)?.name).toBe("Written offline");
    const pending = relaunched.pendingCount();
    expect(pending).toBeGreaterThan(0);

    server.state.online = true;
    await relaunched.syncNow();
    expect(relaunched.pendingCount()).toBe(0);
    expect(server.log.filter((o) => o.entity_id === made.id)).toHaveLength(pending);
    await relaunched.stop();

    // Another device sees it.
    const other = engine(disk(), server, keys);
    await other.start();
    await other.syncNow();
    expect(other.items.get(made.id)?.fields[0]?.value).toBe(SECRET);
    await other.stop();
  });
});
