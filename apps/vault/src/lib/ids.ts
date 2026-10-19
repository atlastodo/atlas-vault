import { randomUUID } from "expo-crypto";

/**
 * Entity ids: v4 UUIDs from expo-crypto. The server refuses a non-UUID `entity_id`, and Hermes
 * has no `crypto.randomUUID`.
 */
export const newId: () => string = randomUUID;
