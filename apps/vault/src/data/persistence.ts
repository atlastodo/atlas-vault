import * as SQLite from "expo-sqlite";
import { ExpoSqlDatabase, SqlitePersistence, type Persistence } from "@atlastodo/client-core";

/**
 * The vault's durable op log on a phone: client-core's SQLite persistence over expo-sqlite, one
 * database per account (two accounts on one device never share an outbox). The engine seals it
 * (every value encrypted under a key derived from the vault key), so a locked vault's database
 * holds only ids and ciphertext; signing out deletes it anyway. The web build resolves
 * `persistence.web.ts`.
 */
export async function createPersistence(userId: string): Promise<Persistence> {
  const db = await SQLite.openDatabaseAsync(dbName(userId), { useNewConnection: true });
  return new SqlitePersistence(new ExpoSqlDatabase(db));
}

export async function deleteDatabase(userId: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(dbName(userId));
}

function dbName(userId: string): string {
  return `atlas-vault-${userId}.db`;
}
