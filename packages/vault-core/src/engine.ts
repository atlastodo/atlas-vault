/**
 * The vault's offline-first store and its sync: a client-core {@link LocalStore} over a durable
 * op log ({@link Persistence}: IndexedDB in a browser, SQLite on a phone), kept in step with the
 * server by a {@link SyncClient} scoped to the vault app.
 *
 * Edits land in the local store first and are pushed in the background; the server's ops for the
 * vault (and only those: the client's `ApiClient` names `vault` in `x-atlas-sync-apps`) are
 * pulled, or arrive over the realtime socket, and merge field by field (HLC last-writer-wins).
 * Every field is encrypted under the vault app key before it leaves the device.
 */

import {
  LocalStore,
  SyncClient,
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
  /** The device's op log; client-core's `MemoryPersistence` keeps nothing. */
  persistence: Persistence;
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
}

export class VaultEngine {
  readonly store: LocalStore;
  readonly items: VaultItems;
  private sync: SyncClient | null = null;
  private started = false;

  constructor(private readonly opts: VaultEngineOptions) {
    this.store = new LocalStore(opts.deviceId, {
      persistence: opts.persistence,
      newId: opts.newId,
      now: opts.now,
      onPersistError: opts.onPersistError,
    });
    this.items = new VaultItems(this.store, { now: opts.now });
  }

  /**
   * Load the local log (offline edits are there before any network), install the vault key
   * and build the sync client at the stored cursor. Call once; then {@link syncNow}.
   */
  async start(): Promise<void> {
    if (this.started) throw new Error("the vault engine is already started");
    this.started = true;
    const { api, persistence } = this.opts;
    await this.store.hydrate();
    api.setKeyring(vaultKeyring(this.opts.keys));
    // A vault has no values from before encryption: plaintext in a field is a forgery, dropped.
    api.setLegacyMigrated(true);
    const cursor = await persistence.getCursor();
    const bootstrap = (await persistence.getBootstrap?.()) ?? null;
    this.sync = new SyncClient(this.store, api, {
      cursor: Number.isFinite(cursor) ? cursor : 0,
      bootstrap,
      onBootstrapProgress: (progress, page) => {
        persistence.setBootstrap?.(progress, page).catch((err) => this.opts.onError?.(err));
      },
      onCursor: (c) => {
        // A failed write only means the next start pulls a little more.
        persistence.setCursor(c).catch((err) => this.opts.onError?.(err));
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
    return this.store.unsyncedOps().length;
  }

  isRealtimeLive(): boolean {
    return this.sync?.isRealtimeLive() ?? false;
  }

  /** Close the socket, let queued writes land and release the database. */
  async stop(): Promise<void> {
    this.sync?.dispose();
    this.sync = null;
    await this.store.flush().catch(() => {});
    await this.opts.persistence.close?.();
    this.opts.api.setKeyring(null);
  }
}
