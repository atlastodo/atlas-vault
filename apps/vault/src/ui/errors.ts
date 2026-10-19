import {
  ApiError,
  NetworkError,
  RootKeyRequiredError,
  ServerIncompatibleError,
  apiErrorCode,
} from "@atlastodo/client-core";
import { LegacyAccountError, TokenPolicyError, VaultError } from "@atlastodo/vault-core";

/** The server's typed API token errors, in words. */
const TOKEN_ERRORS: Record<string, string> = {
  api_token_expiry_required: "A vault token needs an expiry.",
  api_token_expiry_in_past: "The token's expiry must be in the future.",
  api_token_expiry_too_far: "A vault token expires at most a year after it is made.",
  api_token_read_only: "This API token is read-only.",
  api_token_expired: "This API token has expired.",
};

/** A sentence for the user about what went wrong. */
export function describeError(err: unknown): string {
  if (err instanceof VaultError) return capitalize(err.message) + ".";
  if (err instanceof TokenPolicyError) return TOKEN_ERRORS[err.code] ?? capitalize(err.message);
  if (err instanceof ServerIncompatibleError) {
    if (err.incompatibility.reason === "apps") {
      return "This server does not offer Atlas Vault. Its operator can turn it on with ATLAS_APPS=todo,vault.";
    }
    return err.message;
  }
  if (err instanceof LegacyAccountError) {
    return "This account was created before end-to-end encryption and cannot sign in.";
  }
  if (err instanceof RootKeyRequiredError) {
    return "This account needs one sign-in with its password in an up-to-date Atlas app first.";
  }
  if (err instanceof NetworkError || (err instanceof TypeError && /fetch/i.test(err.message))) {
    return "Can't reach the server. Check its address and your connection.";
  }
  if (err instanceof ApiError) {
    const code = apiErrorCode(err);
    if (code && TOKEN_ERRORS[code]) return TOKEN_ERRORS[code]!;
    if (code === "invalid_credentials") return "Wrong email or password.";
    if (code === "app_not_enabled") return "Atlas Vault is not enabled for this account here.";
    if (code === "account_disabled") return "This account is disabled.";
    if (err.status === 409 && /token/i.test(err.message)) return capitalize(err.message);
    if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (err.status >= 500) return "The server ran into a problem. Try again shortly.";
    return capitalize(err.message);
  }
  return err instanceof Error ? capitalize(err.message) : String(err);
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}
