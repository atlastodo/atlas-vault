/**
 * Signing in to an Atlas account from Atlas Vault, and opening the vault's own key.
 *
 * The account is the suite's one account (the same email and password as Atlas Todo). Its keys
 * form a tree (`docs/architecture.md`, Account root key, in the core repository): the password
 * opens the account root key, and the root key opens each app's key. Vault uses only the
 * vault app key and identity (`account_app_keys`, app `vault`); it never keeps the todo key.
 * Every step here is client-core's: {@link openAccountKeys} for the root, {@link ensureRootKey} to
 * migrate an account from before root keys, {@link enableApp} to create (once, race-safe) and
 * open the vault key and enable the app for the account. No new crypto lives in this package.
 */

import {
  ApiClient,
  RootKeyRequiredError,
  assertServerCompatible,
  buildSignupRoot,
  bytesToHex,
  deriveAuthAndMekAsync,
  deriveRecoveryKeys,
  enableApp,
  ensureRootKey,
  generateDek,
  generateRecoveryPhrase,
  generateSalt,
  generateSigningKeypair,
  generateUserKeypair,
  getPublicKey,
  hexToBytes,
  kdfForNewCredential,
  kdfFromWire,
  Keyring,
  LEGACY_KDF,
  openAccountKeys,
  openAppKey,
  sessionFromAuth,
  unwrapRootKey,
  wrapKey,
  wrapSigningKey,
  type ApiClientOptions,
  type AppKeys,
  type AuthResponse,
  type PasswordKdf,
  type RootKeyState,
  type ServerRequirements,
  type Session,
} from "@atlastodo/client-core";
import { VAULT_APP } from "./items";

/**
 * What Atlas Vault needs from a server, checked against `GET /discovery` before signing in:
 * root keys and per-account apps (the vault key lives under the root), app-scoped sync (the
 * vault syncs only its own ops), app-scoped API tokens held to the vault's token policy (a server
 * without `api_token_policies` would make a vault token that writes and never expires) and the
 * vault app offered (`ATLAS_APPS=todo,vault`).
 */
export const VAULT_SERVER_REQUIREMENTS: ServerRequirements = {
  minProtocol: 1,
  capabilities: [
    "root_key",
    "account_apps",
    "app_scoped_sync",
    "app_scoped_api_tokens",
    "api_token_policies",
  ],
  apps: [VAULT_APP],
};

/** Throws client-core's `ServerIncompatibleError` when the server cannot serve the vault. */
export async function ensureVaultServer(api: ApiClient): Promise<void> {
  assertServerCompatible(await api.getDiscovery(), VAULT_SERVER_REQUIREMENTS);
}

/** An `ApiClient` whose sync requests are scoped to the vault (`x-atlas-sync-apps: vault`). */
export function createVaultApiClient(opts: Omit<ApiClientOptions, "apps">): ApiClient {
  return new ApiClient({ ...opts, apps: [VAULT_APP] });
}

/** The vault app key and identity, unwrapped. Kept in memory; persisted only sealed. */
export interface VaultKeys {
  appKey: Uint8Array;
  privateKey: Uint8Array;
  /** The identity's public key (hex). */
  publicKey: string;
}

/**
 * The persisted session: client-core's {@link Session} (tokens, user, the wrapped root key and
 * app key rows) with the vault's keys in place of the todo DEK, which this app never stores
 * (`dek`, `privateKey` and `signingKey` stay unset).
 */
export interface VaultSession extends Session {
  /** The vault app key (hex); absent while the session is locked. */
  vaultKey?: string;
  /** The vault identity's private key (hex). */
  vaultPrivateKey?: string;
  /**
   * When the unlocked session locks unless there is activity first (unix ms, auto-lock). A
   * restored session past it opens locked. Absent while locked.
   */
  lockAt?: number;
}

/** The keyring the vault syncs with: the vault app key in the DEK's role (envelope kid "dek"). */
export function vaultKeyring(keys: VaultKeys): Keyring {
  return new Keyring({ dek: keys.appKey, privateKey: keys.privateKey, publicKey: keys.publicKey });
}

/** Vault keys from their stored hex form; null when they do not parse. */
export function keysFromHex(appKeyHex: string, privateKeyHex: string): VaultKeys | null {
  try {
    const appKey = hexToBytes(appKeyHex);
    const privateKey = hexToBytes(privateKeyHex);
    if (appKey.length !== 32 || privateKey.length !== 32) return null;
    return { appKey, privateKey, publicKey: getPublicKey(privateKey) };
  } catch {
    return null;
  }
}

/** The vault keys a session holds, or null when it is locked. */
export function sessionKeys(session: VaultSession | null): VaultKeys | null {
  if (!session?.vaultKey || !session.vaultPrivateKey) return null;
  return keysFromHex(session.vaultKey, session.vaultPrivateKey);
}

/** `session` holding `keys` (or locked, without). */
export function withKeys(session: VaultSession, keys: VaultKeys | null): VaultSession {
  const next: VaultSession = { ...session };
  delete next.dek;
  delete next.privateKey;
  delete next.signingKey;
  if (keys) {
    next.vaultKey = bytesToHex(keys.appKey);
    next.vaultPrivateKey = bytesToHex(keys.privateKey);
  } else {
    delete next.vaultKey;
    delete next.vaultPrivateKey;
    delete next.lockAt;
  }
  return next;
}

/** A session without its vault keys (what the app shows the unlock screen for). */
export function lockedSession(session: VaultSession): VaultSession {
  return withKeys(session, null);
}

/** The account was created before encryption and cannot sign in. Shaped like the server's 403. */
export class LegacyAccountError extends Error {
  readonly code = "legacy_account";
  constructor() {
    super("this account was created before end-to-end encryption and cannot sign in");
    this.name = "LegacyAccountError";
  }
}

/** The wrong password for an unlock (the slot does not open). */
export class WrongPasswordError extends Error {
  constructor() {
    super("the password does not open this account's keys");
    this.name = "WrongPasswordError";
  }
}

interface Credential {
  authHash: string;
  mek: Uint8Array;
  salt: string;
  kdf: PasswordKdf;
}

/** The auth hash a password sign-in sends and the MEK that opens the account's keys. */
export async function deriveLoginCredential(
  api: Pick<ApiClient, "getSalt">,
  email: string,
  password: string,
): Promise<Credential> {
  const res = await api.getSalt(email);
  if (!res.is_e2ee) throw new LegacyAccountError();
  if (!res.salt) throw new Error("the server sent no salt for this account");
  // Throws for a KDF this client does not run: no credential it could derive would sign in.
  const kdf = kdfFromWire(res.kdf_version, res.kdf_params) ?? LEGACY_KDF;
  return { ...(await deriveAuthAndMekAsync(password, res.salt, kdf)), salt: res.salt, kdf };
}

function rootStateOf(session: Session): RootKeyState {
  return {
    hasRootKey: session.hasRootKey,
    encryptedRootKey: session.encryptedRootKey,
    appKeys: session.appKeys,
    hasRecoveryRootKey: session.hasRecoveryRootKey,
    recoveryPublicKey: session.recoveryPublicKey,
  };
}

function withRootState(session: VaultSession, state: RootKeyState): VaultSession {
  const next: VaultSession = { ...session, ...state };
  if (state.hasRootKey === false) delete next.encryptedRootKey;
  return next;
}

type KeyApi = Pick<
  ApiClient,
  "migrateRootKey" | "getRootKey" | "putRecoveryRootKey" | "putAppKey" | "enableAccountApp"
>;

/**
 * Open (creating it on first use) the vault key under an unlocked root, and enable the vault
 * for the account. Online: `enableApp` stores a new key once and enables the app idempotently.
 */
async function vaultKeysUnder(
  api: KeyApi,
  session: VaultSession,
  rootKey: Uint8Array,
): Promise<{ keys: VaultKeys; session: VaultSession }> {
  const { keys, state } = await enableApp(api, {
    userId: session.user.id,
    rootKey,
    app: VAULT_APP,
    state: rootStateOf(session),
  });
  return { keys: fromAppKeys(keys), session: withRootState(session, state) };
}

function fromAppKeys(keys: AppKeys): VaultKeys {
  return { appKey: keys.appKey, privateKey: keys.privateKey, publicKey: keys.publicKey };
}

/**
 * The vault keys from what a password sign-in returned: root → (migrate when the account has
 * no root yet) → vault key. The todo keys this opens on the way are dropped.
 */
async function openFromAuth(
  api: KeyApi,
  auth: AuthResponse,
  credential: Credential,
): Promise<{ keys: VaultKeys; session: VaultSession }> {
  const account = openAccountKeys({
    userId: auth.user.id,
    mek: credential.mek,
    encryptedRootKey: auth.encrypted_root_key,
    appKeys: auth.app_keys,
    encryptedDek: auth.encrypted_dek,
    encryptedPrivateKey: auth.encrypted_private_key,
  });
  let session: VaultSession = { ...sessionFromAuth(auth), kdf: credential.kdf };
  let rootKey = account.rootKey;
  try {
    const migrated = await ensureRootKey(api, {
      userId: auth.user.id,
      authHash: credential.authHash,
      mek: credential.mek,
      dek: account.dek,
      privateKey: account.privateKey,
      rootKey,
      state: rootStateOf(session),
    });
    if (migrated) {
      rootKey = migrated.rootKey;
      session = withRootState(session, migrated.state);
    }
  } finally {
    account.dek.fill(0);
    account.privateKey.fill(0);
  }
  if (!rootKey) throw new RootKeyRequiredError();
  try {
    return await vaultKeysUnder(api, session, rootKey);
  } finally {
    rootKey.fill(0);
  }
}

export interface SignInOptions {
  /** Shown in the account's Devices & sessions list. */
  deviceName?: string;
  /** Survives a reinstall (Android); the server replaces this install's older sessions. */
  installKey?: string;
}

export interface SignedIn {
  session: VaultSession;
  keys: VaultKeys;
}

/** Sign in with the account password and open the vault (enabling it on first use). */
export async function signIn(
  api: ApiClient,
  email: string,
  password: string,
  opts: SignInOptions = {},
): Promise<SignedIn> {
  await ensureVaultServer(api);
  const normalized = email.trim().toLowerCase();
  const credential = await deriveLoginCredential(api, normalized, password);
  const auth = await api.login(normalized, credential.authHash, opts.deviceName, opts.installKey);
  if (!auth.encrypted_dek || !auth.encrypted_private_key) throw new LegacyAccountError();
  // The key routes below are authenticated: the client must carry the new session's token.
  api.setTokens(auth.access_token, auth.refresh_token);
  try {
    const { keys, session } = await openFromAuth(api, auth, credential);
    return { keys, session: withKeys(session, keys) };
  } catch (err) {
    // No vault without its key: end the session the server just opened rather than leave it.
    await api.logout(auth.refresh_token).catch(() => {});
    api.setTokens(undefined, undefined);
    throw err;
  } finally {
    credential.mek.fill(0);
  }
}

/**
 * Create an account, exactly as Atlas Todo does (the todo key is the account's DEK and is always
 * enabled), then enable the vault under the new root. Resolves the recovery phrase, which the
 * app must show once: it is the only way back into the account without the password.
 */
export async function signUp(
  api: ApiClient,
  input: { email: string; password: string; displayName?: string; invite?: string },
  opts: SignInOptions = {},
): Promise<SignedIn & { recoveryPhrase: string }> {
  await ensureVaultServer(api);
  const email = input.email.trim().toLowerCase();
  const kdf = kdfForNewCredential(await api.getSalt(email));
  const salt = generateSalt();
  const { authHash, mek } = await deriveAuthAndMekAsync(input.password, salt, kdf);
  const dek = generateDek();
  const keypair = generateUserKeypair();
  const signing = generateSigningKeypair();
  const phrase = generateRecoveryPhrase();
  const recovery = deriveRecoveryKeys(phrase, salt);
  const root = buildSignupRoot({
    mek,
    recoveryWrapKey: recovery.wrapKey,
    dek,
    privateKey: keypair.secretKey,
  });
  try {
    const auth = await api.signup({
      email,
      password: authHash,
      displayName: input.displayName ?? "",
      invite: input.invite,
      deviceName: opts.deviceName,
      installKey: opts.installKey,
      salt,
      publicKey: keypair.publicKey,
      recoveryPublicKey: recovery.auth.publicKey,
      encryptedDek: wrapKey(dek, mek),
      encryptedPrivateKey: wrapKey(keypair.secretKey, mek),
      recoveryEncryptedDek: wrapKey(dek, recovery.wrapKey),
      recoveryEncryptedPrivateKey: wrapKey(keypair.secretKey, recovery.wrapKey),
      kdf,
      signingPublicKey: signing.publicKey,
      encryptedSigningKey: wrapSigningKey(signing.secretKey, dek),
      root,
    });
    api.setTokens(auth.access_token, auth.refresh_token);
    const session: VaultSession = { ...sessionFromAuth(auth), kdf };
    // `buildSignupRoot` keeps the root to itself; its password slot opens it again here.
    const rootKey = unwrapRootKey(root.encryptedRootKey, mek, root.userId, "password");
    try {
      const opened = await vaultKeysUnder(api, session, rootKey);
      return {
        keys: opened.keys,
        session: withKeys(opened.session, opened.keys),
        recoveryPhrase: phrase,
      };
    } finally {
      rootKey.fill(0);
    }
  } finally {
    mek.fill(0);
    dek.fill(0);
    keypair.secretKey.fill(0);
    signing.secretKey.fill(0);
  }
}

/**
 * Unlock a restored session with the password: the MEK opens the root's password slot, the root
 * the vault key. Works offline once the session has the vault's row; without it (the vault
 * was enabled elsewhere since) it asks the server. Rejects with {@link WrongPasswordError} for a
 * password that does not open the slot.
 */
export async function unlock(
  api: ApiClient,
  session: VaultSession,
  password: string,
): Promise<SignedIn> {
  if (!session.salt || !session.encryptedRootKey) {
    throw new Error("this session cannot be unlocked here: sign in again");
  }
  const kdf = session.kdf ?? LEGACY_KDF;
  const { mek } = await deriveAuthAndMekAsync(password, session.salt, kdf);
  let rootKey: Uint8Array;
  try {
    rootKey = unwrapRootKey(session.encryptedRootKey, mek, session.user.id, "password");
  } catch {
    throw new WrongPasswordError();
  } finally {
    mek.fill(0);
  }
  try {
    if (session.appKeys?.some((k) => k.app === VAULT_APP)) {
      const keys = fromAppKeys(openAppKey(rootKey, session.user.id, VAULT_APP, session.appKeys));
      return { keys, session: withKeys(session, keys) };
    }
    const opened = await vaultKeysUnder(api, session, rootKey);
    return { keys: opened.keys, session: withKeys(opened.session, opened.keys) };
  } finally {
    rootKey.fill(0);
  }
}
