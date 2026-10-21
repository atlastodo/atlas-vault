import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { ApiClient, SyncStatus } from "@atlastodo/client-core";
import { VaultEngine, type VaultItems, type VaultKeys } from "@atlastodo/vault-core";
import { newId } from "../lib/ids";
import { createPersistence } from "./persistence";
import { describeError } from "../ui/errors";

/** The short poll; the long one while the realtime socket is live and nothing waits to push. */
const SYNC_INTERVAL_MS = 5_000;
const LIVE_SYNC_INTERVAL_MS = 30_000;
/** How long a lock waits for unsent changes to reach the server. */
const FLUSH_TIMEOUT_MS = 4_000;

export interface VaultValue {
  items: VaultItems;
  /** Bumps on every change to the store: a memo key for derived lists. */
  version: number;
  status: SyncStatus;
  /** Changes not on the server yet. */
  pending: number;
  /** Whether the vault is complete: a local copy that synced before, or a first pull done. */
  loaded: boolean;
  /** Set when this device's copy did not open under the vault key and was pulled again. */
  notice: string | null;
  lastError: string | null;
  lastSyncAt: number | null;
  /** Sync now (after a local write, or from the settings). */
  kick: () => void;
  /** Push what waits (before a lock), giving up after a few seconds; resolves what is left. */
  flush: () => Promise<number>;
}

/** Exported so tests can provide a store without a server. */
export const VaultContext = createContext<VaultValue | null>(null);

export function useVault(): VaultValue {
  const value = useContext(VaultContext);
  if (!value) throw new Error("useVault outside VaultProvider");
  return value;
}

/**
 * Owns the vault engine of the unlocked session. The device keeps the vault's op log on disk
 * (IndexedDB, SQLite), sealed by the engine under a key derived from the vault key, so an unlock
 * opens it without the network and offline edits wait there to sync; a locked vault's database
 * holds only ciphertext. Sync runs on a poll, on the realtime socket, when the app returns to the
 * foreground and after each local write. Unmounting (lock, sign-out) stops the engine, which
 * closes the database and wipes the local key.
 */
export function VaultProvider({
  api,
  userId,
  deviceId,
  keys,
  children,
  fallback,
}: {
  api: ApiClient;
  userId: string;
  deviceId: string;
  keys: VaultKeys;
  children: ReactNode;
  /** Shown while the engine starts. */
  fallback: ReactNode;
}) {
  const [engine, setEngine] = useState<VaultEngine | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let made: VaultEngine | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    let appState: { remove: () => void } | undefined;

    void (async () => {
      const persistence = await createPersistence(userId);
      if (cancelled) {
        await persistence.close?.();
        return;
      }
      const eng = new VaultEngine({
        api,
        persistence,
        userId,
        deviceId,
        keys,
        newId,
        realtime: true,
        onStatus: (s) => !cancelled && setStatus(s),
        onSynced: () => {
          if (cancelled) return;
          setLastSyncAt(Date.now());
          setLastError(null);
        },
        onError: (err) => {
          console.warn("[atlas-vault] sync failed:", err);
          if (!cancelled) setLastError(describeError(err));
        },
        onStoreReset: (err) => {
          console.warn("[atlas-vault] the local copy did not open; pulling it again:", err);
          if (!cancelled) {
            setNotice(
              "This device's copy of the vault did not open with your key, so it was downloaded again.",
            );
          }
        },
        onQuarantine: (op, err) =>
          console.warn("[atlas-vault] the server refused a change for good:", op.id, err),
      });
      made = eng;
      await eng.start();
      if (cancelled) {
        await eng.stop();
        return;
      }
      unsubscribe = eng.store.onChange(() => setVersion((v) => v + 1));
      setResumed(eng.hadLocalCopy());
      setEngine(eng);

      const run = () => {
        void eng.syncNow().catch(() => {
          // Reported through onError; the next poll retries.
        });
      };
      const schedule = () => {
        if (cancelled) return;
        if (timer) clearTimeout(timer);
        const delay =
          eng.isRealtimeLive() && eng.pendingCount() === 0
            ? LIVE_SYNC_INTERVAL_MS
            : SYNC_INTERVAL_MS;
        timer = setTimeout(() => {
          run();
          schedule();
        }, delay);
      };
      kickRef.current = () => {
        run();
        schedule();
      };
      run();
      schedule();
      appState = AppState.addEventListener("change", (next) => {
        if (next === "active") kickRef.current();
      });
    })().catch((err: unknown) => {
      console.warn("[atlas-vault] could not open the vault:", err);
      if (!cancelled) setLastError(describeError(err));
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      appState?.remove();
      kickRef.current = () => {};
      void made?.stop().catch(() => {});
      setEngine(null);
    };
  }, [api, userId, deviceId, keys]);

  const value = useMemo<VaultValue | null>(
    () =>
      engine
        ? {
            items: engine.items,
            version,
            status,
            pending: engine.pendingCount(),
            loaded: resumed || lastSyncAt !== null,
            notice,
            lastError,
            lastSyncAt,
            kick: () => kickRef.current(),
            flush: async () => {
              if (engine.pendingCount() === 0) return 0;
              await Promise.race([
                engine.syncNow().catch(() => {}),
                new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
              ]);
              return engine.pendingCount();
            },
          }
        : null,
    // `version` changes with every store write, which is what `pending` follows.
    [engine, version, status, lastError, lastSyncAt, resumed, notice],
  );

  if (!value) return <>{fallback}</>;
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
