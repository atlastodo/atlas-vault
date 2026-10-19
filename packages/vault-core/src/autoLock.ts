/**
 * Auto-lock: the vault locks after a stretch without activity, and on demand. Locking drops the
 * decrypted vault keys from memory and from the stored session (the app owns that part); this is
 * the timing, kept platform-free so it is testable.
 *
 * The deadline is wall-clock (`now() + timeout` at the last activity), not a running timer alone:
 * a phone suspends JavaScript timers in the background, so the app also asks {@link isExpired}
 * whenever it comes back, and a restored session past its deadline opens locked.
 */

export const MINUTE_MS = 60_000;

/** The timeouts the settings offer, in minutes. */
export const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60, 240] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

/** A stored setting as a valid choice (the default for anything else). */
export function autoLockMinutes(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && (AUTO_LOCK_CHOICES as readonly number[]).includes(n)
    ? n
    : DEFAULT_AUTO_LOCK_MINUTES;
}

export interface AutoLockOptions {
  timeoutMs: number;
  onLock: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Activity is recorded at most this often (ms); 1 s by default. */
  throttleMs?: number;
  /** The first deadline (a restored session's); `now + timeout` by default. */
  lockAt?: number;
  /**
   * A deadline another writer moved (another browser tab's activity), read before locking: the
   * later of the two wins.
   */
  externalDeadline?: () => number | null;
}

export class AutoLock {
  private deadline: number;
  private handle: unknown = null;
  private lastTouch = -Infinity;
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: AutoLockOptions) {
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.deadline = opts.lockAt ?? this.now() + opts.timeoutMs;
    this.arm();
  }

  /** When the vault locks unless there is activity first (unix ms). */
  lockAt(): number {
    return this.deadline;
  }

  /** Record activity: the deadline moves to `timeout` from now. */
  touch(): void {
    if (this.stopped) return;
    const now = this.now();
    if (now - this.lastTouch < (this.opts.throttleMs ?? 1000)) return;
    if (this.isExpired()) return void this.lock();
    this.lastTouch = now;
    this.deadline = now + this.opts.timeoutMs;
    this.arm();
  }

  /** Past the deadline (checked when the app returns to the foreground). */
  isExpired(): boolean {
    const external = this.opts.externalDeadline?.() ?? null;
    if (external !== null && external > this.deadline) this.deadline = external;
    return this.now() >= this.deadline;
  }

  /** Lock now if the deadline has passed; returns whether it locked. */
  check(): boolean {
    if (this.stopped || !this.isExpired()) return false;
    this.lock();
    return true;
  }

  lock(): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onLock();
  }

  /** Stop without locking (the vault was locked or signed out another way). */
  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
  }

  private arm(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    // Timers may fire late or early relative to the wall clock: re-check rather than trust them.
    const wait = Math.max(0, this.deadline - this.now());
    this.handle = this.setTimer(() => {
      this.handle = null;
      if (this.isExpired()) this.lock();
      else this.arm();
    }, wait);
  }
}
