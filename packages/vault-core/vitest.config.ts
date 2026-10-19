import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The suites run the real password KDF (Argon2id in pure JS), which outlasts the 5 s default.
    testTimeout: 60_000,
  },
});
