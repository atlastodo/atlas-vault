import { base64ToBytes, bytesToBase64 } from "@atlastodo/client-core";

/**
 * Storage for the vault keys a web session keeps across reloads (used only by
 * `sessionStore.ts`).
 *
 * The keys are AES-GCM-wrapped under a non-extractable WebCrypto key kept in IndexedDB, bound to
 * the user id as associated data. That keeps the plain keys out of localStorage, but it is not
 * protection at rest: the browser profile holds the wrapping key too. Without WebCrypto or
 * IndexedDB `seal` answers null and the keys stay in memory only (a reload asks for the password).
 */

export interface SealedKeys {
  v: 1;
  iv: string;
  ct: string;
}

export interface SessionKeys {
  vaultKey: string;
  vaultPrivateKey: string;
}

/** A store of its own, apart from the vault's database, so either can be reset alone. */
const DB_NAME = "atlas-vault-keystore";
const STORE = "keys";
const WRAP_KEY_ID = "session-wrap-v1";

interface Env {
  subtle: SubtleCrypto;
  idb: IDBFactory;
}

function currentEnv(): Env | null {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (typeof subtle?.encrypt !== "function" || !idb) return null;
  return { subtle, idb };
}

let cached: { env: Env; key: Promise<CryptoKey | null> } | null = null;

function wrappingKey(): { env: Env; key: Promise<CryptoKey | null> } | null {
  const env = currentEnv();
  if (!env) return null;
  if (!cached || cached.env.subtle !== env.subtle || cached.env.idb !== env.idb) {
    cached = {
      env,
      key: loadOrCreateKey(env).catch((err: unknown) => {
        console.warn("[atlas-vault] no key store; session keys stay in memory:", err);
        return null;
      }),
    };
  }
  return cached;
}

function openKeyStore(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("the key store is blocked"));
  });
}

/**
 * The origin's wrapping key, created on first use in one readwrite transaction (which IndexedDB
 * serializes across tabs, so two tabs starting at once end up with the same key).
 */
async function loadOrCreateKey({ subtle, idb }: Env): Promise<CryptoKey> {
  const db = await openKeyStore(idb);
  try {
    const candidate = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    return await new Promise<CryptoKey>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      let key = candidate;
      const existing = store.get(WRAP_KEY_ID);
      existing.onsuccess = () => {
        if (existing.result) key = existing.result as CryptoKey;
        else store.put(candidate, WRAP_KEY_ID);
      };
      tx.oncomplete = () => resolve(key);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("the key store transaction aborted"));
    });
  } finally {
    db.close();
  }
}

const encoder = new TextEncoder();

/** Wrap `keys` for `userId`, or null when this browser cannot (keep them in memory). */
export async function sealSessionKeys(
  keys: SessionKeys,
  userId: string,
): Promise<SealedKeys | null> {
  const wrapping = wrappingKey();
  const key = await wrapping?.key;
  if (!wrapping || !key) return null;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await wrapping.env.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(userId) },
    key,
    encoder.encode(JSON.stringify(keys)),
  );
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

/** Unwrap keys sealed for `userId`, or null when they cannot be opened here (reads as locked). */
export async function openSessionKeys(
  sealed: SealedKeys,
  userId: string,
): Promise<SessionKeys | null> {
  const wrapping = wrappingKey();
  const key = await wrapping?.key;
  if (!wrapping || !key || sealed.v !== 1) return null;
  try {
    const plain = await wrapping.env.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(sealed.iv) as BufferSource,
        additionalData: encoder.encode(userId),
      },
      key,
      base64ToBytes(sealed.ct) as BufferSource,
    );
    const keys = JSON.parse(new TextDecoder().decode(plain)) as Partial<SessionKeys>;
    if (typeof keys.vaultKey !== "string" || typeof keys.vaultPrivateKey !== "string") {
      return null;
    }
    return { vaultKey: keys.vaultKey, vaultPrivateKey: keys.vaultPrivateKey };
  } catch {
    return null;
  }
}
