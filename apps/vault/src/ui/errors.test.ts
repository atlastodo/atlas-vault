import { ApiError } from "@atlastodo/client-core";
import { TokenPolicyError, VaultError } from "@atlastodo/vault-core";
import { describeError } from "./errors";

describe("describeError", () => {
  it("words the server's token policy errors", () => {
    const err = new ApiError(400, "a token for Atlas Vault expires at most 365 days after", {
      code: "api_token_expiry_too_far",
    });
    expect(describeError(err)).toBe("A vault token expires at most a year after it is made.");
    expect(describeError(new TokenPolicyError("api_token_expiry_required", "x"))).toBe(
      "A vault token needs an expiry.",
    );
  });

  it("passes the shared rules' messages on", () => {
    expect(describeError(new VaultError("bad_input", 'two fields are named "password"'))).toBe(
      'Two fields are named "password".',
    );
  });
});
