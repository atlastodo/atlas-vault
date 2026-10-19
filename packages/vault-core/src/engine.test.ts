/**
 * Two devices of one account syncing vault items through a fake server that, like the real
 * one, only stores and replays ops: what reaches it is ciphertext under the vault key, in a
 * vault-scoped session, and the other device opens it.
 */
import { MemoryPersistence } from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { createVaultApiClient, type VaultKeys } from "./account";
import { VaultEngine } from "./engine";
import { fakeServer, vaultKeys } from "./fakeServer.testutil";

function device(server: ReturnType<typeof fakeServer>, keys: VaultKeys, id: string) {
  const api = createVaultApiClient({
    baseUrl: "http://atlas.test",
    token: "access",
    fetch: server.fetch,
  });
  return new VaultEngine({
    api,
    persistence: new MemoryPersistence(),
    userId: "user",
    deviceId: id,
    keys,
  });
}

describe("VaultEngine", () => {
  it("syncs encrypted items between two devices in a vault-scoped session", async () => {
    const server = fakeServer();
    const keys = vaultKeys();
    const a = device(server, keys, "device-a");
    const b = device(server, keys, "device-b");
    await a.start();
    await b.start();

    const folder = a.items.createFolder("Pipelines folder");
    const made = a.items.create({
      type: "api_key",
      name: "Harbour deploy key",
      fields: [{ name: "token", kind: "hidden", value: "sk_live_harbour" }],
      urls: ["https://harbour.example"],
      tags: ["production-tag"],
      folder: folder.id,
    });
    expect(a.pendingCount()).toBeGreaterThan(0);
    await a.syncNow();
    expect(a.pendingCount()).toBe(0);

    // The server holds only ciphertext under the vault key ("dek" is its role, not todo's DEK):
    // not the type, name, folder, URL, timestamps or secret.
    const sets = server.log.filter((o) => o.entity === "vault.item");
    expect(sets.length).toBe(11);
    for (const op of [...sets, ...server.log.filter((o) => o.entity === "vault.folder")]) {
      expect(op.value).toMatchObject({ __enc: 2, kid: "dek" });
      const wire = JSON.stringify(op.value);
      for (const plain of [
        "Harbour",
        "sk_live",
        "harbour.example",
        "api_key",
        "production",
        "Pipelines",
      ]) {
        expect(wire).not.toContain(plain);
      }
    }
    // Every request named the vault as its scope.
    expect(server.headers.every((h) => h["x-atlas-sync-apps"] === "vault")).toBe(true);

    await b.syncNow();
    expect(b.items.get(made.id)).toEqual(made);
    expect(b.items.folderName(made.folder)).toBe("Pipelines folder");

    // An edit and a trash on b reach a, with the old secret in the history.
    b.items.update(made.id, { set_fields: [{ name: "token", value: "sk_live_rotated" }] });
    b.items.trash(made.id);
    await b.syncNow();
    await a.syncNow();
    const got = a.items.get(made.id)!;
    expect(got.fields[0]!.value).toBe("sk_live_rotated");
    expect(got.history.map((h) => h.value)).toEqual(["sk_live_harbour"]);
    expect(got.deleted_at).not.toBeNull();
    expect(a.items.list()).toEqual([]);
    await a.stop();
    await b.stop();
  });

  it("keeps items it cannot open locked, never as content", async () => {
    const server = fakeServer();
    const a = device(server, vaultKeys(), "device-a");
    const other = device(server, vaultKeys(), "device-x");
    await a.start();
    await other.start();
    const made = a.items.create({ name: "Private" });
    await a.syncNow();
    await other.syncNow();
    expect(other.items.get(made.id)).toMatchObject({ name: "", locked: true });
    expect(() => other.items.update(made.id, { name: "Mine" })).toThrow("cannot be opened");
    await a.stop();
    await other.stop();
  });

  it("keeps offline edits in its log across a restart", async () => {
    const server = fakeServer();
    const keys = vaultKeys();
    const persistence = new MemoryPersistence();
    const api = createVaultApiClient({ baseUrl: "http://atlas.test", fetch: server.fetch });
    const first = new VaultEngine({ api, persistence, userId: "user", deviceId: "d", keys });
    await first.start();
    const made = first.items.create({ name: "Written offline", type: "note" });
    await first.store.flush();
    // A second engine on the same log (the app relaunched) sees the edit before any sync.
    const again = new VaultEngine({ api, persistence, userId: "user", deviceId: "d", keys });
    await again.start();
    expect(again.items.get(made.id)?.name).toBe("Written offline");
    expect(again.pendingCount()).toBeGreaterThan(0);
  });
});
