import { useEffect, useState, type ReactNode } from "react";
import { LocalStore } from "@atlastodo/client-core";
import { VaultItems } from "@atlastodo/vault-core";
import { VaultContext, type VaultValue } from "../data/VaultProvider";

/** A vault in memory (a real store, no server) and a provider for it, for screen tests. */
export function memoryVault(now: () => number = Date.now) {
  let n = 0;
  const store = new LocalStore("test-device", {
    now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  const items = new VaultItems(store, { now });
  const kicks = { count: 0 };

  function Provider({ children, extra }: { children: ReactNode; extra?: Partial<VaultValue> }) {
    const [version, setVersion] = useState(0);
    useEffect(() => store.onChange(() => setVersion((v) => v + 1)), []);
    const value: VaultValue = {
      items,
      version,
      status: "idle",
      pending: store.unsyncedOps().length,
      loaded: true,
      lastError: null,
      lastSyncAt: null,
      kick: () => {
        kicks.count++;
      },
      flush: async () => 0,
      ...extra,
    };
    return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
  }

  return { store, items, kicks, Provider };
}
