/**
 * API tokens for Atlas Vault: what CI jobs and scripts sign in with to read a secret (`atlas vault
 * get …`, the SDK's `VaultClient`; `docs/integrations.md` in the core repository, Vault tokens for
 * CI). A vault token is for the vault alone (`apps: ["vault"]`) and carries the vault app key and
 * identity wrapped for itself (`wrapAppKeysForApiToken`), nothing of todo's; the server never sees
 * the token's secret.
 *
 * The vault's token policy (`api_tokens` in core's `manifests/vault.json`, read here through
 * client-core's {@link tokenPolicyFor}) is enforced by the server: a token must expire, at most
 * `max_lifetime_days` after it is made, and reads only unless made with `write: true`. This module
 * asks for both explicitly and checks the expiry before sending; the server's typed errors
 * (`api_token_expiry_required`, `…_in_past`, `…_too_far`) still reach the caller as `ApiError`s.
 */

import {
  ApiClient,
  deriveApiTokenKeys,
  formatApiToken,
  generateApiToken,
  tokenPolicyFor,
  wrapAppKeysForApiToken,
  type ApiTokenView,
  type TokenPolicy,
} from "@atlastodo/client-core";
import type { VaultKeys } from "./account";
import { VAULT_APP } from "./items";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The vault's token policy as this client bundles it. */
export const VAULT_TOKEN_POLICY: TokenPolicy = tokenPolicyFor([VAULT_APP]);

/** The expiries the settings offer, in days, within the policy's longest lifetime. */
export function tokenLifetimeChoices(policy: TokenPolicy = VAULT_TOKEN_POLICY): number[] {
  const max = policy.max_lifetime_days;
  const choices = [7, 30, 90, 180, 365].filter((d) => max == null || d <= max);
  return max != null && !choices.includes(max) ? [...choices, max] : choices;
}

/** A token's apps, or todo for a server predating app-scoped tokens. */
export function tokenApps(token: ApiTokenView): string[] {
  return token.apps ?? ["todo"];
}

/** Whether a listed token has passed its expiry (it stays listed until revoked). */
export function isTokenExpired(token: ApiTokenView, now: number = Date.now()): boolean {
  return token.expires_at != null && token.expires_at <= now;
}

/** The account's tokens that can read the vault, newest first. */
export async function listVaultTokens(api: ApiClient): Promise<ApiTokenView[]> {
  return (await api.listApiTokens())
    .filter((t) => tokenApps(t).includes(VAULT_APP))
    .sort((a, b) => b.created_at - a.created_at);
}

export type TokenPolicyCode =
  "api_token_expiry_required" | "api_token_expiry_in_past" | "api_token_expiry_too_far";

/** A token request the policy refuses, caught before sending (same codes as the server's). */
export class TokenPolicyError extends Error {
  constructor(
    readonly code: TokenPolicyCode,
    message: string,
  ) {
    super(message);
    this.name = "TokenPolicyError";
  }
}

export function checkTokenExpiry(
  expiresAt: number | null,
  now: number,
  policy: TokenPolicy = VAULT_TOKEN_POLICY,
): void {
  if (expiresAt == null) {
    if (policy.expiry_required) {
      throw new TokenPolicyError("api_token_expiry_required", "a vault token needs an expiry");
    }
    return;
  }
  if (expiresAt <= now) {
    throw new TokenPolicyError("api_token_expiry_in_past", "the expiry must be in the future");
  }
  if (policy.max_lifetime_days != null && expiresAt > now + policy.max_lifetime_days * DAY_MS) {
    throw new TokenPolicyError(
      "api_token_expiry_too_far",
      `a vault token expires at most ${policy.max_lifetime_days} days after it is made`,
    );
  }
}

export interface CreateVaultTokenInput {
  userId: string;
  keys: VaultKeys;
  name: string;
  /** Unix ms; required by the vault's policy. */
  expiresAt: number;
  /** Writes are opt-in: read-only unless this is `true`. */
  write?: boolean;
  now?: number;
}

/**
 * Make a vault-only token. Resolves the token string, which exists nowhere else: show it once.
 * Needs an interactive session (a token cannot make tokens).
 */
export async function createVaultToken(
  api: ApiClient,
  input: CreateVaultTokenInput,
): Promise<{ token: string; view: ApiTokenView }> {
  checkTokenExpiry(input.expiresAt, input.now ?? Date.now());
  const parts = generateApiToken();
  const { auth } = deriveApiTokenKeys(parts);
  const view = await api.createApiToken({
    id: parts.id,
    name: input.name.trim() || "Atlas Vault CI",
    auth,
    apps: [VAULT_APP],
    app_keys: {
      [VAULT_APP]: wrapAppKeysForApiToken(parts, input.userId, VAULT_APP, {
        appKey: input.keys.appKey,
        privateKey: input.keys.privateKey,
      }),
    },
    expires_at: Math.trunc(input.expiresAt),
    // Sent either way, so the token is read-only whatever a server's default.
    write: input.write === true,
  });
  return { token: formatApiToken(parts), view };
}
