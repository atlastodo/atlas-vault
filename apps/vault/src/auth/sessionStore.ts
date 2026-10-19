import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "@atlastodo/client-core";
import type { VaultSession } from "@atlastodo/vault-core";

/**
 * Session persistence on a phone: the whole session, vault keys included, in the OS keychain
 * (Android Keystore, iOS Keychain) through expo-secure-store, and only while unlocked: locking
 * rewrites it without them. No plaintext fallback: a failed read
 * is "signed out", a failed write fails the sign-in. The web build resolves `sessionStore.web.ts`.
 */

const KEY = "atlas-vault.session";

export async function readSession(): Promise<VaultSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as VaultSession) : null;
  } catch {
    return null;
  }
}

export async function writeSession(session: VaultSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function dropSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** One client per process: nothing to lock against. */
export const withRefreshLock: TokenStore["withRefreshLock"] = undefined;

export function refreshGrace(): boolean {
  return false;
}

/** A phone has no sibling tabs writing the session. */
export function subscribeSession(_onChange: (session: VaultSession | null) => void): () => void {
  return () => {};
}

/** One process, one auto-lock: no other writer's deadline to follow. */
export function readStoredLockAt(): number | null {
  return null;
}
