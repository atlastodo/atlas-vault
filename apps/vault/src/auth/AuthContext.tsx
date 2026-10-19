import "../lib/polyfillCrypto";
import "../lib/argon2id";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  mergeRotatedTokens,
  reconcileStoredSession,
  type ApiClient,
  type AuthResponse,
  type TokenStore,
} from "@atlastodo/client-core";
import {
  MINUTE_MS,
  createVaultApiClient,
  keysFromHex,
  lockedSession,
  signIn as signInFlow,
  signUp as signUpFlow,
  unlock as unlockFlow,
  type VaultKeys,
  type VaultSession,
} from "@atlastodo/vault-core";
import { clearCopiedSecret } from "../lib/clipboard";
import { detectDeviceName } from "../lib/deviceName";
import { getInstallKey } from "../lib/installKey";
import { loadPrefs } from "../lib/prefs";
import { loadServerUrl, setServerUrlOverride } from "./serverUrl";
import {
  dropSession,
  readSession,
  refreshGrace,
  subscribeSession,
  withRefreshLock,
  writeSession,
} from "./sessionStore";

/**
 * The signed-in account, its lock, and a token-bound, vault-scoped `ApiClient`.
 *
 * - The session is restored before anything renders (`restored`). A session without its vault
 *   keys is locked: the app asks for the password (`unlock`) before anything decrypts or syncs.
 *   A stored session past its auto-lock deadline (`lockAt`) is locked on restore, and stored so.
 * - `lock` drops the vault keys from memory and from the stored session (the vault's decrypted
 *   items live only in memory, so they go with the provider that held them) and clears a copied
 *   secret from the clipboard. A lock in one browser tab locks the others.
 * - Rotated tokens are merged into the session as it is now and persisted (the vault keys are
 *   never in an auth response, so the merge keeps them).
 * - Signing out ends the device session on the server and forgets it here.
 */
export interface AuthValue {
  restored: boolean;
  serverUrl: string;
  api: ApiClient;
  session: VaultSession | null;
  /** The unlocked vault keys, or null (signed out or locked). */
  keys: VaultKeys | null;
  /** Set right after sign-up until the user confirms they saved it. */
  recoveryPhrase: string | null;
  dismissRecoveryPhrase: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  /** Resolves false for a wrong password. */
  unlock: (password: string) => Promise<boolean>;
  /** Lock now: the keys are dropped, the password opens the vault again. */
  lock: () => Promise<void>;
  /** Store a later auto-lock deadline (activity), so a reload or another tab honours it. */
  extendLock: (lockAt: number) => void;
  signOut: () => Promise<void>;
  /** Point the (signed-out) app at another server. */
  changeServerUrl: (url: string) => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}

/** `session` as it may be used at `now`: locked once past its deadline (or without one). */
export function restoredSession(session: VaultSession | null, now: number): VaultSession | null {
  if (!session?.vaultKey) return session;
  if (typeof session.lockAt !== "number" || session.lockAt <= now) return lockedSession(session);
  return session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [api, setApi] = useState<ApiClient | null>(null);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const sessionRef = useRef<VaultSession | null>(null);
  const apiRef = useRef<ApiClient | null>(null);
  // Read by the auth flows, which may run right after `changeServerUrl` in one handler.
  const serverUrlRef = useRef("");

  const commit = useCallback((next: VaultSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const clearLocal = useCallback(() => {
    apiRef.current?.setTokens(undefined, undefined);
    apiRef.current?.setKeyring(null);
    commit(null);
    setRecoveryPhrase(null);
  }, [commit]);

  const persist = useCallback(
    async (next: VaultSession) => {
      commit(next);
      try {
        await writeSession(next);
      } catch (err) {
        console.warn("[atlas-vault] could not persist the session:", err);
      }
    },
    [commit],
  );

  const tokenStore = useMemo<TokenStore>(
    () => ({
      read: async () => {
        const stored = await readSession();
        return stored && { accessToken: stored.accessToken, refreshToken: stored.refreshToken };
      },
      write: async (auth: AuthResponse) => {
        const prev = sessionRef.current;
        if (!prev) return; // signed out while the rotation was in flight
        await persist(mergeRotatedTokens(prev, auth) as VaultSession);
      },
      withRefreshLock,
      refreshGrace,
    }),
    [persist],
  );

  const endSession = useCallback(() => {
    void dropSession().catch(() => {});
    void clearCopiedSecret();
    clearLocal();
  }, [clearLocal]);

  const buildClient = useCallback(
    (baseUrl: string, stored: VaultSession | null) => {
      serverUrlRef.current = baseUrl;
      setServerUrl(baseUrl);
      const client = createVaultApiClient({
        baseUrl,
        token: stored?.accessToken,
        refreshToken: stored?.refreshToken,
        tokenStore,
        onAuthExpired: endSession,
      });
      apiRef.current = client;
      setApi(client);
      return client;
    },
    [tokenStore, endSession],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [url, stored] = await Promise.all([loadServerUrl(), readSession()]);
      if (cancelled) return;
      const usable = restoredSession(stored, Date.now());
      buildClient(url, usable);
      commit(usable);
      if (usable && usable !== stored) await writeSession(usable).catch(() => {});
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [buildClient, commit]);

  // Another tab signed in, rotated, locked, unlocked or signed out (web only).
  useEffect(
    () =>
      subscribeSession((stored) => {
        const current = sessionRef.current;
        const next = reconcileStoredSession(current, stored) as VaultSession | null;
        if (next === current) return;
        if (!next) {
          clearLocal();
          return;
        }
        apiRef.current?.setTokens(next.accessToken, next.refreshToken);
        // A write without the keys is a lock (or a tab that cannot keep them): this tab locks
        // too, rather than keep a vault open that the user locked elsewhere.
        commit(restoredSession(next, Date.now()));
      }),
    [clearLocal, commit],
  );

  const requireClient = useCallback(() => {
    const client = apiRef.current;
    if (!client) throw new Error("the app is still starting");
    if (!serverUrlRef.current) throw new Error("Enter your Atlas server's address first.");
    return client;
  }, []);

  /** A fresh deadline from the device's auto-lock setting. */
  const firstLockAt = useCallback(async () => {
    const prefs = await loadPrefs();
    return Date.now() + prefs.autoLockMinutes * MINUTE_MS;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const client = requireClient();
      const installKey = await getInstallKey();
      const signed = await signInFlow(client, email, password, {
        deviceName: detectDeviceName(),
        installKey,
      });
      const next = { ...signed.session, lockAt: await firstLockAt() };
      await writeSession(next);
      commit(next);
    },
    [requireClient, commit, firstLockAt],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const client = requireClient();
      const installKey = await getInstallKey();
      const signed = await signUpFlow(
        client,
        { email, password, displayName },
        { deviceName: detectDeviceName(), installKey },
      );
      const next = { ...signed.session, lockAt: await firstLockAt() };
      await writeSession(next);
      setRecoveryPhrase(signed.recoveryPhrase);
      commit(next);
    },
    [requireClient, commit, firstLockAt],
  );

  const unlock = useCallback(
    async (password: string) => {
      const client = apiRef.current;
      const current = sessionRef.current;
      if (!client || !current) return false;
      try {
        const opened = await unlockFlow(client, current, password);
        await persist({ ...opened.session, lockAt: await firstLockAt() });
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "WrongPasswordError") return false;
        throw err;
      }
    },
    [persist, firstLockAt],
  );

  const lock = useCallback(async () => {
    const current = sessionRef.current;
    apiRef.current?.setKeyring(null);
    await clearCopiedSecret();
    if (current?.vaultKey) await persist(lockedSession(current));
  }, [persist]);

  const extendLock = useCallback(
    (lockAt: number) => {
      const current = sessionRef.current;
      if (!current?.vaultKey) return;
      void persist({ ...current, lockAt });
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    await apiRef.current?.logout().catch(() => {});
    await dropSession().catch(() => {});
    await clearCopiedSecret();
    clearLocal();
  }, [clearLocal]);

  const changeServerUrl = useCallback(
    async (url: string) => {
      await setServerUrlOverride(url);
      buildClient(await loadServerUrl(), null);
    },
    [buildClient],
  );

  // Keyed on the key strings, not the session: a token rotation must not restart the vault.
  const vaultKey = session?.vaultKey;
  const vaultPrivateKey = session?.vaultPrivateKey;
  const keys = useMemo(
    () => (vaultKey && vaultPrivateKey ? keysFromHex(vaultKey, vaultPrivateKey) : null),
    [vaultKey, vaultPrivateKey],
  );

  const value = useMemo<AuthValue | null>(
    () =>
      api
        ? {
            restored,
            serverUrl,
            api,
            session,
            keys,
            recoveryPhrase,
            dismissRecoveryPhrase: () => setRecoveryPhrase(null),
            signIn,
            signUp,
            unlock,
            lock,
            extendLock,
            signOut,
            changeServerUrl,
          }
        : null,
    [
      api,
      restored,
      serverUrl,
      session,
      keys,
      recoveryPhrase,
      signIn,
      signUp,
      unlock,
      lock,
      extendLock,
      signOut,
      changeServerUrl,
    ],
  );

  if (!value) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
