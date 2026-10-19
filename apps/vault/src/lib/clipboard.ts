import * as Clipboard from "expo-clipboard";

/**
 * Copying a field's value. A secret is cleared after a timeout, and on lock or sign-out
 * ({@link clearCopiedSecret}).
 *
 * Clearing is best effort: a page cannot read the clipboard without a permission prompt, so the
 * clear overwrites it unconditionally, and only while the tab has focus (browsers refuse clipboard
 * writes from a background tab); a clear that fails, or came due while timers were throttled, is
 * retried when the tab is focused again ({@link flushClipboard}).
 */

let pending: { at: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

async function clearNow(): Promise<boolean> {
  try {
    await Clipboard.setStringAsync("");
    return true;
  } catch {
    return false;
  }
}

async function runClear(): Promise<void> {
  const job = pending;
  if (!job) return;
  if (await clearNow()) {
    if (pending === job) pending = null;
  }
}

/** Copy `value`; a secret is cleared from the clipboard after `clearAfterSeconds`. */
export async function copyValue(
  value: string,
  opts: { secret: boolean; clearAfterSeconds: number },
): Promise<void> {
  await Clipboard.setStringAsync(value);
  if (pending?.timer) clearTimeout(pending.timer);
  pending = null;
  if (!opts.secret) return;
  const ms = opts.clearAfterSeconds * 1000;
  pending = { at: Date.now() + ms, timer: setTimeout(() => void runClear(), ms) };
}

/** Run a clear that came due while timers were not running (call on foreground or focus). */
export function flushClipboard(): void {
  if (pending && Date.now() >= pending.at) void runClear();
}

/** Clear a copied secret now (locking, signing out). */
export async function clearCopiedSecret(): Promise<void> {
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  pending.at = 0;
  await runClear();
}

/** Whether a copied secret is still waiting to be cleared (tests). */
export function hasPendingClear(): boolean {
  return pending !== null;
}
