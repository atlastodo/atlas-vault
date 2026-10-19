import * as Clipboard from "expo-clipboard";
import { clearCopiedSecret, copyValue, flushClipboard, hasPendingClear } from "./clipboard";

const board = (Clipboard as unknown as { __clipboard: { value: string } }).__clipboard;

describe("copying", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    board.value = "";
  });
  afterEach(() => jest.useRealTimers());

  it("clears a secret after the timeout", async () => {
    await copyValue("hunter2", { secret: true, clearAfterSeconds: 30 });
    expect(board.value).toBe("hunter2");
    await jest.advanceTimersByTimeAsync(29_000);
    expect(board.value).toBe("hunter2");
    await jest.advanceTimersByTimeAsync(1_000);
    expect(board.value).toBe("");
    expect(hasPendingClear()).toBe(false);
  });

  it("overwrites the clipboard without reading it (a page cannot, without a prompt)", async () => {
    await copyValue("hunter2", { secret: true, clearAfterSeconds: 10 });
    board.value = "copied elsewhere";
    await jest.advanceTimersByTimeAsync(10_000);
    expect(board.value).toBe("");
  });

  it("does not clear what is not a secret", async () => {
    await copyValue("octocat", { secret: false, clearAfterSeconds: 10 });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(board.value).toBe("octocat");
    expect(hasPendingClear()).toBe(false);
  });

  it("clears at once on lock, and catches up on a clear that came due in the background", async () => {
    await copyValue("s1", { secret: true, clearAfterSeconds: 30 });
    await clearCopiedSecret();
    expect(board.value).toBe("");

    await copyValue("s2", { secret: true, clearAfterSeconds: 30 });
    // Timers did not run (a throttled background tab), but the wall clock moved on.
    jest.setSystemTime(Date.now() + 60_000);
    flushClipboard();
    await Promise.resolve();
    await Promise.resolve();
    expect(board.value).toBe("");
  });
});
