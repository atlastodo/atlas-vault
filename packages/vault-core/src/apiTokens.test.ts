import { generateUserKeypair, randomBytes, type FetchLike } from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { createVaultApiClient } from "./account";
import {
  DAY_MS,
  checkTokenExpiry,
  createVaultToken,
  isTokenExpired,
  listVaultTokens,
  tokenLifetimeChoices,
} from "./apiTokens";

function server() {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/api-tokens" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return new Response(
        JSON.stringify({ id: body.id, name: body.name, apps: body.apps, created_at: 1 }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/auth/api-tokens") {
      return new Response(
        JSON.stringify([
          { id: "a", name: "todo", created_at: 1 },
          { id: "b", name: "old", apps: ["vault"], created_at: 2, expires_at: 5 },
          { id: "c", name: "new", apps: ["vault"], created_at: 3 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404 });
  };
  return { bodies, api: createVaultApiClient({ baseUrl: "http://atlas.test", token: "t", fetch }) };
}

const keys = () => {
  const id = generateUserKeypair();
  return { appKey: randomBytes(32), privateKey: id.secretKey, publicKey: id.publicKey };
};

describe("vault API tokens", () => {
  const now = 1_790_000_000_000;

  it("makes a vault-only token, read-only unless writes are opted in, with an expiry", async () => {
    const { api, bodies } = server();
    const made = await createVaultToken(api, {
      userId: "u",
      keys: keys(),
      name: " ci ",
      expiresAt: now + 30 * DAY_MS,
      now,
    });
    expect(made.token).toMatch(/^atlas_pat_/);
    expect(bodies[0]).toMatchObject({
      name: "ci",
      apps: ["vault"],
      expires_at: now + 30 * DAY_MS,
      write: false,
    });
    expect(Object.keys(bodies[0]!.app_keys as object)).toEqual(["vault"]);
    expect(bodies[0]).not.toHaveProperty("wrapped_dek");
    // The token string never reaches the server: only its derived auth value does.
    expect(JSON.stringify(bodies[0])).not.toContain(made.token.slice("atlas_pat_".length));

    await createVaultToken(api, {
      userId: "u",
      keys: keys(),
      name: "writer",
      expiresAt: now + DAY_MS,
      write: true,
      now,
    });
    expect(bodies[1]).toMatchObject({ write: true });
  });

  it("checks the expiry against the policy before sending", async () => {
    const { api, bodies } = server();
    const input = { userId: "u", keys: keys(), name: "x", now };
    await expect(createVaultToken(api, { ...input, expiresAt: now })).rejects.toMatchObject({
      code: "api_token_expiry_in_past",
    });
    await expect(
      createVaultToken(api, { ...input, expiresAt: now + 366 * DAY_MS }),
    ).rejects.toMatchObject({ code: "api_token_expiry_too_far" });
    expect(() => checkTokenExpiry(null, now)).toThrow("needs an expiry");
    expect(() => checkTokenExpiry(now + 365 * DAY_MS, now)).not.toThrow();
    expect(bodies).toEqual([]);
  });

  it("offers lifetimes within a year", () => {
    expect(tokenLifetimeChoices()).toEqual([7, 30, 90, 180, 365]);
    expect(
      tokenLifetimeChoices({
        expiry_required: true,
        max_lifetime_days: 60,
        write_by_default: false,
      }),
    ).toEqual([7, 30, 60]);
  });

  it("lists the vault's tokens, newest first, and spots expired ones", async () => {
    const { api } = server();
    const listed = await listVaultTokens(api);
    expect(listed.map((t) => t.id)).toEqual(["c", "b"]);
    expect(isTokenExpired(listed[1]!, 10)).toBe(true);
    expect(isTokenExpired(listed[0]!, 10)).toBe(false);
  });
});
