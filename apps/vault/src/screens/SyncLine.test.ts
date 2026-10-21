import { syncSummary } from "./SyncLine";

describe("syncSummary", () => {
  const base = { status: "idle", pending: 0, lastError: null, lastSyncAt: null };
  it("says where the vault stands", () => {
    expect(syncSummary(base)).toBe("Connecting…");
    expect(syncSummary({ ...base, lastSyncAt: 1 })).toBe("Synced · end-to-end encrypted");
    expect(syncSummary({ ...base, status: "syncing" })).toBe("Syncing…");
    expect(syncSummary({ ...base, pending: 2 })).toBe("2 changes waiting");
    expect(syncSummary({ ...base, status: "offline" })).toBe(
      "Offline · your vault is saved on this device",
    );
    expect(syncSummary({ ...base, pending: 1, lastError: "x" })).toBe(
      "Offline · 1 change waiting, saved on this device",
    );
  });
});
