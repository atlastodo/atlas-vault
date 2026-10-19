/**
 * The vault's offline-first store and its sync: a client-core {@link LocalStore} over the
 * device's durable op log (IndexedDB in a browser, SQLite on a phone), kept in step with the
 * server by a {@link SyncClient} scoped to the vault app.
 *
 * The op log is sealed at rest: client-core's {@link sealPersistence} stores every value as an
 * envelope under a key derived from the vault key ({@link deriveLocalStoreKey}), which exists only
 * while the vault is unlocked. A locked vault's database holds ids, field names and clocks (what
 * the server sees too) and ciphertext; the engine closes it when it stops and wipes its copy of
 * the key. A log that does not open under this key (another key or account, tampering) is
 * cleared and pulled again from the server.
 *
 * Edits land in the local store first and are pushed in the background; the server's ops for the
 * vault (and only those: the client's `ApiClient` names `vault` in `x-atlas-sync-apps`) are
 * pulled, or arrive over the realtime socket, and merge field by field (HLC last-writer-wins).
 * Every field is encrypted under the vault app key before it leaves the device.
 */

import {
  LocalStore,
  SealedStoreError,
  SyncClient,
  deriveLocalStoreKey,
  sealPersistence,
  type ApiClient,
  type Operation,
  type Persistence,
  type SyncResult,
  type SyncStatus,
} from "@atlastodo/client-core";
import { vaultKeyring, type VaultKeys } from "./account";
import { VaultItems } from "./items";

export interface VaultEngineOptions {
  /** A vault-scoped client (`createVaultApiClient`) with the session's tokens. */
  api: ApiClient;
  /**
   * The device's op log as stored (unsealed backend: `IndexedDbPersistence`, `SqlitePersistence`,
   * or `MemoryPersistence`, which keeps nothing). The engine seals it; never pass a sealed one.
   */
  persistence: Persistence;
  /** The account: the local key is derived per user. */
  userId: string;
  /** This device's id: the clocks' tiebreak, so it must be stable for the device. */
  deviceId: string;
  keys: VaultKeys;
  /** Entity ids; must be UUIDs (Hermes has no `crypto.randomUUID`, so the app passes one). */
  newId?: () => string;
  now?: () => number;
  /** Use the server's realtime socket as well as the poll. */
  realtime?: boolean;
  onStatus?: (status: SyncStatus) => void;
  onSynced?: (result: SyncResult) => void;
  onError?: (err: unknown) => void;
  onQuarantine?: (op: Operation, err: unknown) => void;
  onPersistError?: (err: unknown) => void;
  /** The local log did not open under this key and was cleared (it is pulled again). */
  onStoreReset?: (err: SealedStoreError) => void;
}

export class VaultEngine {
  private _store: LocalStore;
  private _items: VaultItems;
  private readonly localKey: Uint8Array;
  private readonly local: Persistence;
  private sync: SyncClient | null = null;
  private started = false;
  private stopped = false;
  private resumed = false;

  constructor(private readonly opts: VaultEngineOptions) {
    this.localKey = deriveLocalStoreKey(opts.keys.appKey, opts.userId);
    this.local = sealPersistence(opts.persistence, this.localKey);
    this._store = this.newStore();
    this._items = new VaultItems(this._store, { now: opts.now });
  }

  get store(): LocalStore {
    return this._store;
  }

  get items(): VaultItems {
    return this._items;
  }

  /** Whether the start found a local copy that had synced before (the vault is there offline). */
  hadLocalCopy(): boolean {
    return this.resumed;
  }

  private newStore(): LocalStore {
    return new LocalStore(this.opts.deviceId, {
      persistence: this.local,
      newId: this.opts.newId,
      now: this.opts.now,
      onPersistError: this.opts.onPersistError,
    });
  }

  /** Empty the device's log (ops, cursor, bootstrap) and start from a fresh store. */
  private async resetLocal(err: SealedStoreError): Promise<void> {
    const raw = this.opts.persistence;
    if (!raw.clear) throw err;
    await raw.clear();
    await raw.setCursor(0);
    await raw.setBootstrap?.(null);
    this._store = this.newStore();
    this._items = new VaultItems(this._store, { now: this.opts.now });
    await this._store.hydrate();
    this.opts.onStoreReset?.(err);
  }

  /**
   * Load the local log (offline edits are there before any network), install the vault key
   * and build the sync client at the stored cursor. Call once; then {@link syncNow}.
   */
  async start(): Promise<void> {
    if (this.started) throw new Error("the vault engine is already started");
    this.started = true;
    const { api } = this.opts;
    try {
      await this._store.hydrate();
    } catch (err) {
      if (!(err instanceof SealedStoreError)) throw err;
      await this.resetLocal(err);
    }
    api.setKeyring(vaultKeyring(this.opts.keys));
    // A vault has no values from before encryption: plaintext in a field is a forgery, dropped.
    api.setLegacyMigrated(true);
    const local = this.local;
    const stored = await local.getCursor();
    const cursor = Number.isFinite(stored) ? stored : 0;
    let bootstrap = null;
    try {
      bootstrap = (await local.getBootstrap?.()) ?? null;
    } catch (err) {
      if (!(err instanceof SealedStoreError)) throw err;
      // A resume point we cannot open: start the walk over.
      await this.opts.persistence.setBootstrap?.(null);
    }
    this.resumed = cursor > 0 && bootstrap === null;
    this.sync = new SyncClient(this._store, api, {
      cursor,
      bootstrap,
      onBootstrapProgress: (progress, page) => {
        local.setBootstrap?.(progress, page).catch((err) => this.opts.onError?.(err));
      },
      onCursor: (c) => {
        // A failed write only means the next start pulls a little more.
        local.setCursor(c).catch((err) => this.opts.onError?.(err));
      },
      onStatus: this.opts.onStatus,
      onSynced: this.opts.onSynced,
      onError: this.opts.onError,
      onQuarantine: this.opts.onQuarantine,
      realtime: this.opts.realtime ? { url: (since) => api.syncWsUrl(since) } : undefined,
    });
  }

  /** One push-then-pull cycle (single-flight); rejects when it fails. */
  syncNow(): Promise<SyncResult> {
    if (!this.sync) throw new Error("start the vault engine first");
    return this.sync.sync();
  }

  /** Changes not on the server yet. */
  pendingCount(): number {
    return this._store.unsyncedOps().length;
  }

  isRealtimeLive(): boolean {
    return this.sync?.isRealtimeLive() ?? false;
  }

  /**
   * Close the socket, let queued writes land (sealed), close the database and wipe the local key.
   * The store cannot write afterwards: the database rejects every call once closed.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.sync?.dispose();
    this.sync = null;
    await this._store.flush().catch(() => {});
    await this.local.close?.().catch(() => {});
    this.opts.api.setKeyring(null);
    this.localKey.fill(0);
  }
}
