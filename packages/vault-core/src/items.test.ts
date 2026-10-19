import { LocalStore, MemoryPersistence } from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { VAULT_ITEM, VaultItems } from "./items";
import { itemSubtitle } from "./query";

function vault(start = 1_790_000_000_000) {
  let t = start;
  let n = 0;
  const store = new LocalStore("device", {
    persistence: new MemoryPersistence(),
    now: () => t,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  return {
    store,
    items: new VaultItems(store, { now: () => t }),
    tick: (ms = 1000) => (t += ms),
  };
}

describe("VaultItems", () => {
  it("creates every item type with the shared defaults", () => {
    const { items } = vault();
    for (const type of ["login", "note", "card", "identity", "ssh_key", "api_key"]) {
      const made = items.create({ type, name: ` ${type} item ` });
      expect(made).toMatchObject({ type, name: `${type} item`, fields: [], locked: false });
    }
    expect(() => items.create({ type: "bogus", name: "x" })).toThrow("type must be one of");
    expect(() => items.create({ name: "  " })).toThrow("needs a name");
  });

  it("keeps a secret's old value in the history when it changes or goes", () => {
    const { items, tick } = vault();
    const made = items.create({
      name: "GitHub",
      fields: [
        { name: "username", value: "octo" },
        { name: "password", kind: "hidden", value: "first" },
        { name: "totp", kind: "totp", value: "jbsw y3dp ehpk 3pxp" },
      ],
    });
    expect(made.fields[2]!.value).toBe("JBSWY3DPEHPK3PXP");
    tick();
    items.update(made.id, { set_fields: [{ name: "password", value: "second" }] });
    tick();
    items.update(made.id, { set_fields: [{ name: "username", value: "octocat" }] });
    tick();
    const after = items.update(made.id, { remove_fields: ["totp"] });
    expect(after.history.map((h) => [h.field, h.value])).toEqual([
      ["totp", "JBSWY3DPEHPK3PXP"],
      ["password", "first"],
    ]);
    expect(after.fields.map((f) => f.name)).toEqual(["username", "password"]);
  });

  it("writes nothing for an unchanged edit", () => {
    const { items, store } = vault();
    const made = items.create({ name: "Router", notes: "admin" });
    const before = store.unsyncedOps().length;
    items.update(made.id, { name: "Router", notes: "admin" });
    expect(store.unsyncedOps().length).toBe(before);
  });

  it("trashes, restores and deletes for good", () => {
    const { items, store } = vault();
    const made = items.create({ name: "Old" });
    items.trash(made.id);
    expect(items.list()).toEqual([]);
    expect(items.trashed().map((i) => i.id)).toEqual([made.id]);
    items.restore(made.id);
    expect(items.list().map((i) => i.id)).toEqual([made.id]);
    expect(() => items.purge(made.id)).toThrow("trash before");
    items.trash(made.id);
    items.purge(made.id);
    expect(items.get(made.id)).toBeNull();
    expect(store.unsyncedOps().at(-1)).toMatchObject({ entity: VAULT_ITEM, op: "delete" });
  });

  it("files items in folders, and empties a folder it deletes", () => {
    const { items } = vault();
    const ci = items.createFolder(" CI ");
    expect(() => items.createFolder("ci")).toThrow("already a vault folder");
    const a = items.create({ name: "Deploy key", type: "api_key", folder: ci.id });
    items.create({ name: "Loose" });
    expect(items.list({ folder: ci.id }).map((i) => i.name)).toEqual(["Deploy key"]);
    expect(items.list({ folder: "none" }).map((i) => i.name)).toEqual(["Loose"]);
    expect(() => items.create({ name: "x", folder: "nope" })).toThrow("no vault folder");
    items.renameFolder(ci.id, "Pipelines");
    expect(items.folderName(ci.id)).toBe("Pipelines");
    items.deleteFolder(ci.id);
    expect(items.folders()).toEqual([]);
    expect(items.get(a.id)?.folder).toBeNull();
  });

  it("filters by favorite, tag, type and search, by name", () => {
    const { items } = vault();
    items.create({
      name: "beta mail",
      favorite: true,
      tags: ["Work"],
      fields: [
        { name: "email", kind: "email", value: "me@example.com" },
        { name: "password", kind: "hidden", value: "hunter2" },
      ],
      urls: ["https://mail.example.com"],
    });
    items.create({ name: "Alpha bank", type: "card", tags: ["money"] });
    items.create({ name: "gamma", type: "note", notes: "hunter2 in the notes" });
    const names = (q: Parameters<VaultItems["list"]>[0]) => items.list(q).map((i) => i.name);
    expect(names({})).toEqual(["Alpha bank", "beta mail", "gamma"]);
    expect(names({ favorites: true })).toEqual(["beta mail"]);
    expect(names({ tag: "work" })).toEqual(["beta mail"]);
    expect(names({ type: "card" })).toEqual(["Alpha bank"]);
    expect(names({ search: "example mail" })).toEqual(["beta mail"]);
    // Secret values and notes are never searched.
    expect(names({ search: "hunter2" })).toEqual([]);
    expect(items.tags()).toEqual(["money", "Work"]);
  });

  it("shows the account of an item under its name", () => {
    const { items } = vault();
    const login = items.create({ name: "x", fields: [{ name: "Username", value: "octo" }] });
    expect(itemSubtitle(login)).toBe("octo");
    const site = items.create({ name: "y", urls: ["https://a.example"] });
    expect(itemSubtitle(site)).toBe("https://a.example");
  });
});
