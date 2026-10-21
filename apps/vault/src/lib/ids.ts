/** Entity ids: v4 UUIDs from WebCrypto. The server refuses a non-UUID `entity_id`. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
