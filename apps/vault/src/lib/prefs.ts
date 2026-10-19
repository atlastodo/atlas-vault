import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  autoLockMinutes,
  type PassphraseOptions,
  type PasswordOptions,
} from "@atlastodo/vault-core";

/**
 * This device's own settings (not synced: a phone and a desktop want different lock timeouts):
 * the auto-lock timeout, how long a copied secret stays on the clipboard, and the generator's
 * last options. None of them is secret. AsyncStorage is localStorage on the web.
 */

export const CLIPBOARD_CHOICES = [10, 30, 60, 120] as const;
export const DEFAULT_CLIPBOARD_SECONDS = 30;

export interface GeneratorPrefs {
  mode: "password" | "passphrase";
  password: PasswordOptions;
  passphrase: PassphraseOptions;
}

export interface Prefs {
  autoLockMinutes: number;
  clipboardSeconds: number;
  generator: GeneratorPrefs;
}

export const DEFAULT_PREFS: Prefs = {
  autoLockMinutes: autoLockMinutes(undefined),
  clipboardSeconds: DEFAULT_CLIPBOARD_SECONDS,
  generator: { mode: "password", password: DEFAULT_PASSWORD, passphrase: DEFAULT_PASSPHRASE },
};

const KEY = "atlas-vault.prefs";

function clipboardSeconds(v: unknown): number {
  return typeof v === "number" && (CLIPBOARD_CHOICES as readonly number[]).includes(v)
    ? v
    : DEFAULT_CLIPBOARD_SECONDS;
}

/** Stored prefs with anything unknown or malformed back at its default. */
export function parsePrefs(raw: string | null): Prefs {
  let v: Partial<Prefs> = {};
  try {
    v = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    v = {};
  }
  const g = (v.generator ?? {}) as Partial<GeneratorPrefs>;
  return {
    autoLockMinutes: autoLockMinutes(v.autoLockMinutes),
    clipboardSeconds: clipboardSeconds(v.clipboardSeconds),
    generator: {
      mode: g.mode === "passphrase" ? "passphrase" : "password",
      password: { ...DEFAULT_PASSWORD, ...(g.password ?? {}) },
      passphrase: { ...DEFAULT_PASSPHRASE, ...(g.passphrase ?? {}) },
    },
  };
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    return parsePrefs(await AsyncStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}
