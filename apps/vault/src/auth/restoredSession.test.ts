import type { VaultSession } from "@atlastodo/vault-core";
import { restoredSession } from "./AuthContext";

const base = {
  accessToken: "a",
  refreshToken: "r",
  user: { id: "u", email: "e@example.com" },
  deviceId: "d",
} as unknown as VaultSession;

describe("restoredSession", () => {
  const unlocked = { ...base, vaultKey: "k", vaultPrivateKey: "p", lockAt: 2_000 };

  it("keeps an unlocked session before its deadline", () => {
    expect(restoredSession(unlocked, 1_000)).toBe(unlocked);
  });

  it("locks one past its deadline, or without one", () => {
    for (const s of [
      restoredSession(unlocked, 2_000),
      restoredSession({ ...unlocked, lockAt: undefined }, 0),
    ]) {
      expect(s?.vaultKey).toBeUndefined();
      expect(s?.vaultPrivateKey).toBeUndefined();
      expect(s?.lockAt).toBeUndefined();
      expect(s?.accessToken).toBe("a");
    }
  });

  it("leaves locked and missing sessions alone", () => {
    expect(restoredSession(base, 5)).toBe(base);
    expect(restoredSession(null, 5)).toBeNull();
  });
});
