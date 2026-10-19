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
import { MemoryPersistence, type ApiClient, type SyncStatus } from "@atlastodo/client-core";
import { VaultEngine, type VaultItems, type VaultKeys } from "@atlastodo/vault-core";
import { newId } from "../lib/ids";
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
  /** Whether the first pull from the server has finished (the vault is complete). */
  loaded: boolean;
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
 * Owns the vault engine of the unlocked session. The store is in memory only: the decrypted vault
 * never touches the disk (client-core's durable persistence keeps op values in plaintext, which
 * would leave every secret readable while the vault is locked). Each unlock pulls the vault from
 * the server; sync then runs on a poll, on the realtime socket, when the app returns to the
 * foreground and after each local write. Unmounting (lock, sign-out) drops the store and keys.
 */
export function VaultProvider({
  api,
  deviceId,
  keys,
  children,
  fallback,
}: {
  api: ApiClient;
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
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let made: VaultEngine | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    let appState: { remove: () => void } | undefined;

    void (async () => {
      const eng = new VaultEngine({
        api,
        persistence: new MemoryPersistence(),
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
  }, [api, deviceId, keys]);

  const value = useMemo<VaultValue | null>(
    () =>
      engine
        ? {
            items: engine.items,
            version,
            status,
            pending: engine.pendingCount(),
            loaded: lastSyncAt !== null,
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
    [engine, version, status, lastError, lastSyncAt],
  );

  if (!value) return <>{fallback}</>;
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
