import type { TokenStore } from "@atlastodo/client-core";
import type { VaultSession } from "@atlastodo/vault-core";
import { openSessionKeys, sealSessionKeys, type SealedKeys } from "./webKeyStore";

/**
 * Web session persistence in localStorage (expo-secure-store has no browser backend); Metro
 * resolves this file in place of `sessionStore.ts` on the web.
 *
 * Tokens in localStorage are readable by any script on the origin, an accepted tradeoff shared
 * with Atlas Todo: refresh-token reuse detection, a CSP and the 15-minute access TTL contain it.
 * The vault keys are stored only wrapped (`webKeyStore.ts`), and only while the vault is
 * unlocked: locking (on demand or by auto-lock) rewrites the session without them, and a stored
 * session past its `lockAt` opens locked. Without WebCrypto they are not stored at all (the
 * session then asks for the password after a reload).
 */

const KEY = "atlas-vault.session";
const REFRESH_LOCK = "atlas-vault.session.refresh";

type StoredSession = Omit<VaultSession, "vaultKey" | "vaultPrivateKey"> & {
  sealedKeys?: SealedKeys;
};

function readRaw(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredSession | null {
  try {
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

async function toStored(session: VaultSession): Promise<StoredSession> {
  const { vaultKey, vaultPrivateKey, ...rest } = session;
  if (!vaultKey || !vaultPrivateKey) return rest;
  const sealed = await sealSessionKeys({ vaultKey, vaultPrivateKey }, session.user.id);
  return sealed ? { ...rest, sealedKeys: sealed } : rest;
}

async function fromStored(stored: StoredSession): Promise<VaultSession> {
  const { sealedKeys, ...rest } = stored;
  if (!sealedKeys) return rest;
  const keys = await openSessionKeys(sealedKeys, stored.user.id);
  return keys ? { ...rest, ...keys } : rest;
}

/** Writes land in call order (each waits for its wrap). */
let writes: Promise<unknown> = Promise.resolve();
function enqueue(write: () => Promise<void>): Promise<void> {
  const next = writes.then(write);
  writes = next.catch(() => {});
  return next;
}

export async function readSession(): Promise<VaultSession | null> {
  const stored = parse(readRaw());
  if (!stored) return null;
  try {
    return await fromStored(stored);
  } catch {
    return null;
  }
}

export function writeSession(session: VaultSession): Promise<void> {
  return enqueue(async () => {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(await toStored(session)));
  });
}

export function dropSession(): Promise<void> {
  return enqueue(async () => {
    globalThis.localStorage?.removeItem(KEY);
  });
}

function webLocks(): LockManager | null {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
  return typeof locks?.request === "function" ? locks : null;
}

/**
 * Tabs share the session but a refresh token is single-use, so a rotation runs under an
 * origin-wide lock: one tab rotates, the others adopt the stored pair (see `TokenStore`).
 */
export const withRefreshLock: TokenStore["withRefreshLock"] = <T>(fn: () => Promise<T>) => {
  const locks = webLocks();
  return locks ? (locks.request(REFRESH_LOCK, () => fn()) as Promise<T>) : fn();
};

/** Without Web Locks tabs rotate unserialized: ask the server for its short reuse grace. */
export function refreshGrace(): boolean {
  return webLocks() === null;
}

/** Follow the session other tabs write (a rotation, a sign-in, a sign-out). Returns the unsubscribe. */
export function subscribeSession(onChange: (session: VaultSession | null) => void): () => void {
  const target = globalThis as Partial<Pick<Window, "addEventListener" | "removeEventListener">>;
  if (typeof target.addEventListener !== "function") return () => {};
  let active = true;
  let deliveries: Promise<void> = Promise.resolve();
  const handler = (event: Event) => {
    const { key, newValue } = event as StorageEvent;
    if (key !== null && key !== KEY) return;
    const stored = parse(key === null ? readRaw() : newValue);
    deliveries = deliveries.then(async () => {
      const session = stored ? await fromStored(stored).catch(() => null) : null;
      if (active) onChange(session);
    });
  };
  target.addEventListener("storage", handler);
  return () => {
    active = false;
    target.removeEventListener?.("storage", handler);
  };
}

/** The lock deadline another tab last stored (auto-lock follows activity in any tab). */
export function readStoredLockAt(): number | null {
  const stored = parse(readRaw());
  return typeof stored?.lockAt === "number" && stored.sealedKeys ? stored.lockAt : null;
}
