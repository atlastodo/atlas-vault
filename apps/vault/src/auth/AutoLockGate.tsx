import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { AutoLock, MINUTE_MS } from "@atlastodo/vault-core";
import { usePrefs } from "../data/PrefsProvider";
import { useVault } from "../data/VaultProvider";
import { flushClipboard } from "../lib/clipboard";
import { useAuth } from "./AuthContext";
import { readStoredLockAt } from "./sessionStore";

/** A later deadline is stored once it is this far past the stored one (writes stay rare). */
const PERSIST_STEP_MS = 15_000;

export interface LockValue {
  /** Lock now (unsent changes get a few seconds to reach the server first). */
  lockNow: () => Promise<void>;
}

const LockContext = createContext<LockValue>({ lockNow: async () => {} });

export function useLock(): LockValue {
  return useContext(LockContext);
}

/**
 * Auto-lock for the unlocked vault: any touch, key or pointer activity moves the deadline
 * (`AutoLock`, this device's timeout from the settings); past it the vault locks. Timers do not
 * run while a phone has the app in the background, so returning to it checks the deadline first.
 * The deadline is stored with the session (rarely: every {@link PERSIST_STEP_MS} of movement), so
 * a reload honours it and browser tabs follow each other's activity.
 */
export function AutoLockGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const vault = useVault();
  const { prefs } = usePrefs();
  const timeoutMs = prefs.autoLockMinutes * MINUTE_MS;
  const lockRef = useRef<AutoLock | null>(null);
  const persistedRef = useRef(auth.session?.lockAt ?? 0);
  const flushRef = useRef(vault.flush);
  useEffect(() => {
    flushRef.current = vault.flush;
  }, [vault.flush]);
  const { lock, extendLock } = auth;

  const lockNow = useCallback(async () => {
    lockRef.current?.stop();
    await flushRef.current().catch(() => 0);
    await lock();
  }, [lock]);

  useEffect(() => {
    const stored = persistedRef.current;
    const now = Date.now();
    const auto = new AutoLock({
      timeoutMs,
      // A shorter timeout chosen now applies from now; a restored deadline is kept otherwise.
      lockAt: stored > now ? Math.min(stored, now + timeoutMs) : now + timeoutMs,
      onLock: () => void lockNow(),
      externalDeadline: readStoredLockAt,
    });
    lockRef.current = auto;
    return () => auto.stop();
  }, [timeoutMs, lockNow]);

  const touch = useCallback(() => {
    const auto = lockRef.current;
    if (!auto) return;
    auto.touch();
    const at = auto.lockAt();
    if (at - persistedRef.current >= PERSIST_STEP_MS) {
      persistedRef.current = at;
      extendLock(at);
    }
  }, [extendLock]);

  // Coming back: lock if the deadline passed meanwhile, and run a clipboard clear that came due.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      flushClipboard();
      lockRef.current?.check();
    });
    return () => sub.remove();
  }, []);

  // The web: keys, pointers, wheel and focus are activity too.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onActivity = () => touch();
    const onFocus = () => {
      flushClipboard();
      if (!lockRef.current?.check()) touch();
    };
    const events = ["keydown", "pointerdown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    window.addEventListener("focus", onFocus);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      window.removeEventListener("focus", onFocus);
    };
  }, [touch]);

  const value = useMemo(() => ({ lockNow }), [lockNow]);
  return (
    <LockContext.Provider value={value}>
      <View style={local.fill} onTouchStart={Platform.OS === "web" ? undefined : touch}>
        {children}
      </View>
    </LockContext.Provider>
  );
}

const local = StyleSheet.create({ fill: { flex: 1 } });
