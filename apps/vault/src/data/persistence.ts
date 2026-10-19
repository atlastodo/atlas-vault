import { IndexedDbPersistence, MemoryPersistence, type Persistence } from "@atlastodo/client-core";

/**
 * The vault's durable op log in a browser: client-core's IndexedDB persistence, one database per
 * account, named apart from Atlas Todo's (`atlas-<user>`) so the two apps on one origin never
 * share one. The engine seals it: values are stored encrypted under a key derived from the vault
 * key. In-memory where IndexedDB is missing (a hardened private window): the vault then
 * works for the tab's life and syncs, but keeps nothing offline.
 */
export async function createPersistence(userId: string): Promise<Persistence> {
  if (typeof indexedDB === "undefined") return new MemoryPersistence();
  return new IndexedDbPersistence(dbName(userId), indexedDB);
}

export async function deleteDatabase(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName(userId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Another tab still has it open; it is deleted once that tab lets go.
    req.onblocked = () => resolve();
  });
}

function dbName(userId: string): string {
  return `atlas-vault-${userId}`;
}
