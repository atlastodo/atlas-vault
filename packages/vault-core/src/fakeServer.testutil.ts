/**
 * Test helpers: a fake sync server that, like the real one, only stores and replays ops (and can
 * go offline), and fresh vault keys.
 */
import { generateUserKeypair, randomBytes, type FetchLike } from "@atlastodo/client-core";
import type { VaultKeys } from "./account";

export interface WireOp {
  id: string;
  entity: string;
  entity_id: string;
  field?: string;
  value?: unknown;
}

export function fakeServer() {
  const log: WireOp[] = [];
  const headers: Record<string, string>[] = [];
  const state = { online: true };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetch: FetchLike = async (input, init) => {
    if (!state.online) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
    if (url.pathname === "/sync/push" && init?.method === "POST") {
      const { operations } = JSON.parse(String(init.body)) as { operations: WireOp[] };
      const from = log.length;
      for (const op of operations) if (!log.some((o) => o.id === op.id)) log.push(op);
      return json({ cursor: log.length, applied: operations.length, from });
    }
    if (url.pathname === "/sync/pull") {
      const since = Number(url.searchParams.get("since"));
      return json({ operations: log.slice(since), cursor: log.length });
    }
    return json({ error: "not found" }, 404);
  };
  return { log, headers, fetch, state };
}

export function vaultKeys(): VaultKeys {
  const identity = generateUserKeypair();
  return { appKey: randomBytes(32), privateKey: identity.secretKey, publicKey: identity.publicKey };
}
