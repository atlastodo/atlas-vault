import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "atlas-vault.serverUrl";

function isDev(): boolean {
  return (typeof __DEV__ !== "undefined" && __DEV__) || process.env.NODE_ENV === "development";
}

/**
 * The server the app talks to when the user has not typed one:
 * - `EXPO_PUBLIC_API_URL` when set at build time; a path (`/api`) is on the page's origin.
 * - On the web, the page's origin: a core server serves the vault's web build beside its API
 *   (`STATIC_DIR`), at `/` and under `/api`.
 * - In a native development build, `http://localhost:8080` (the core server's default port).
 * - Elsewhere none: the sign-in screen asks for the server.
 */
export function defaultServerUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  const origin =
    Platform.OS === "web" && typeof window !== "undefined" ? window.location?.origin : undefined;
  if (env) {
    if (env.startsWith("/")) return origin ? normalizeServerUrl(origin + env) : "";
    return normalizeServerUrl(env);
  }
  if (origin) return normalizeServerUrl(origin);
  return isDev() ? "http://localhost:8080" : "";
}

/** A typed server address as a base URL: https:// assumed, no trailing slash. "" stays "". */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The stored override, or "" when none is set. */
export async function getServerUrlOverride(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) ?? "";
  } catch {
    return "";
  }
}

/** Store (or clear, when blank) the server the user typed. */
export async function setServerUrlOverride(url: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  if (normalized && normalized !== defaultServerUrl()) await AsyncStorage.setItem(KEY, normalized);
  else await AsyncStorage.removeItem(KEY);
}

/** The server to use: the user's override, else the default. */
export async function loadServerUrl(): Promise<string> {
  return (await getServerUrlOverride()) || defaultServerUrl();
}
