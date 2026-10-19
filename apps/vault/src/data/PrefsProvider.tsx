import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "../lib/prefs";

export interface PrefsValue {
  prefs: Prefs;
  setPrefs: (change: Partial<Prefs>) => void;
}

export const PrefsContext = createContext<PrefsValue>({ prefs: DEFAULT_PREFS, setPrefs: () => {} });

export function usePrefs(): PrefsValue {
  return useContext(PrefsContext);
}

/** This device's settings (`lib/prefs.ts`), loaded once and saved on change. */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, set] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    let cancelled = false;
    void loadPrefs().then((p) => !cancelled && set(p));
    return () => {
      cancelled = true;
    };
  }, []);
  const setPrefs = useCallback((change: Partial<Prefs>) => {
    set((prev) => {
      const next = { ...prev, ...change };
      void savePrefs(next).catch((err) => console.warn("[atlas-vault] could not save:", err));
      return next;
    });
  }, []);
  return <PrefsContext.Provider value={{ prefs, setPrefs }}>{children}</PrefsContext.Provider>;
}
