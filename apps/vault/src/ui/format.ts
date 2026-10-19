import type { VaultItemType } from "@atlastodo/vault-core";

export const TYPE_LABELS: Record<VaultItemType, string> = {
  login: "Login",
  note: "Secure note",
  card: "Card",
  identity: "Identity",
  ssh_key: "SSH key",
  api_key: "API key",
};

export const KIND_LABELS: Record<string, string> = {
  text: "Text",
  hidden: "Hidden",
  totp: "TOTP",
  email: "Email",
  url: "URL",
  phone: "Phone",
};

/** An item type's label; another client's unknown type as it is. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type as VaultItemType] ?? type;
}

/** A unix-ms time as a short local date and time. */
export function formatTime(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A unix-ms time as a local date. */
export function formatDate(ms: number, locale?: string): string {
  return new Date(ms).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A secret's stand-in: never its length. */
export const MASK = "••••••••••••";
