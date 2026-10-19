import { defineConfig } from "vitest/config";

/** The end-to-end suites (scripts/e2e-cli.sh): a real server and the atlas CLI. */
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One account, one server: the steps build on each other.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
