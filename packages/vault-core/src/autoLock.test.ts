import { describe, expect, it } from "vitest";
import { AutoLock, DEFAULT_AUTO_LOCK_MINUTES, MINUTE_MS, autoLockMinutes } from "./autoLock";

/** A wall clock and timers that only move when told to. */
function fakeTime() {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers = timers.filter((t) => t.id !== id);
    },
    /** Move the clock; with `fire`, run the timers that came due (a foreground tab). */
    advance(ms: number, fire = true) {
      now += ms;
      if (!fire) return;
      for (;;) {
        const due = timers.filter((t) => t.at <= now);
        if (due.length === 0) break;
        timers = timers.filter((t) => t.at > now);
        for (const t of due) t.fn();
      }
    },
    pending: () => timers.length,
  };
}

function lockFor(minutes: number) {
  const time = fakeTime();
  let locks = 0;
  const lock = new AutoLock({
    timeoutMs: minutes * MINUTE_MS,
    onLock: () => locks++,
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return { time, lock, locks: () => locks };
}

describe("AutoLock", () => {
  it("locks once the timeout passes without activity", () => {
    const { time, locks } = lockFor(5);
    time.advance(5 * MINUTE_MS - 1);
    expect(locks()).toBe(0);
    time.advance(1);
    expect(locks()).toBe(1);
    time.advance(60 * MINUTE_MS);
    expect(locks()).toBe(1);
  });

  it("moves the deadline with activity", () => {
    const { time, lock, locks } = lockFor(5);
    time.advance(4 * MINUTE_MS);
    lock.touch();
    time.advance(4 * MINUTE_MS);
    expect(locks()).toBe(0);
    expect(lock.lockAt()).toBe(time.now() + MINUTE_MS);
    time.advance(MINUTE_MS);
    expect(locks()).toBe(1);
  });

  it("locks on return when the timers slept through the deadline (a backgrounded phone)", () => {
    const { time, lock, locks } = lockFor(1);
    time.advance(10 * MINUTE_MS, false);
    expect(lock.isExpired()).toBe(true);
    // Activity past the deadline locks rather than extending it.
    lock.touch();
    expect(locks()).toBe(1);
  });

  it("check() locks only when expired", () => {
    const { time, lock, locks } = lockFor(1);
    expect(lock.check()).toBe(false);
    time.advance(MINUTE_MS, false);
    expect(lock.check()).toBe(true);
    expect(locks()).toBe(1);
  });

  it("locks on demand, once, and stops its timer", () => {
    const { time, lock, locks } = lockFor(5);
    lock.lock();
    lock.lock();
    expect(locks()).toBe(1);
    expect(time.pending()).toBe(0);
  });

  it("does nothing after stop()", () => {
    const { time, lock, locks } = lockFor(1);
    lock.stop();
    time.advance(5 * MINUTE_MS);
    lock.touch();
    expect(locks()).toBe(0);
  });
});

describe("autoLockMinutes", () => {
  it("accepts only the offered choices", () => {
    expect(autoLockMinutes(15)).toBe(15);
    expect(autoLockMinutes("60")).toBe(60);
    expect(autoLockMinutes(7)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(autoLockMinutes(null)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(autoLockMinutes("forever")).toBe(DEFAULT_AUTO_LOCK_MINUTES);
  });
});

describe("AutoLock across writers", () => {
  it("starts from a restored deadline", () => {
    const time = fakeTime();
    let locks = 0;
    new AutoLock({
      timeoutMs: 15 * MINUTE_MS,
      lockAt: time.now() + MINUTE_MS,
      onLock: () => locks++,
      now: time.now,
      setTimer: time.setTimer,
      clearTimer: time.clearTimer,
    });
    time.advance(MINUTE_MS);
    expect(locks).toBe(1);
  });

  it("follows a later deadline another tab stored, and locks once that passes", () => {
    const time = fakeTime();
    let external: number | null = null;
    let locks = 0;
    new AutoLock({
      timeoutMs: MINUTE_MS,
      onLock: () => locks++,
      now: time.now,
      setTimer: time.setTimer,
      clearTimer: time.clearTimer,
      externalDeadline: () => external,
    });
    external = time.now() + 3 * MINUTE_MS;
    time.advance(2 * MINUTE_MS);
    expect(locks).toBe(0);
    time.advance(MINUTE_MS);
    expect(locks).toBe(1);
  });
});
