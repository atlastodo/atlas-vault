/**
 * jest-expo for the app's screens and platform glue (packages/vault-core has its own vitest
 * suites for the logic). Tests are behavioural: query by role, text or label, and inject data
 * through the providers' contexts rather than mocking modules.
 */
const path = require("path");
const expoPreset = require("jest-expo/jest-preset");

/** @type {import('jest').Config} */
module.exports = {
  ...expoPreset,
  // Several suites run real crypto, which can outlast jest's 5 s default on a shared runner.
  testTimeout: 30_000,
  setupFilesAfterEnv: ["<rootDir>/jest-setup.ts"],
  // Without a roots pin jest walks the workspace root's `.bun` store and runs dependencies' tests.
  roots: ["<rootDir>/app", "<rootDir>/src"],
  // Bun's isolated linker puts packages at `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>`, so
  // jest-expo's stock allowlist (anchored to the first `node_modules/`) transforms nothing.
  transformIgnorePatterns: [
    "node_modules/.bun/.*/node_modules/(?!(.*(react-native|expo|@expo|@noble|@scure|@react-navigation|@atlastodo)))",
  ],
  moduleNameMapper: {
    // Babel injects `@babel/runtime` helpers relative to the file, and a package transformed from
    // `node_modules/.bun` cannot reach the app's copy under the isolated linker.
    "^@babel/runtime/(.*)$": path.resolve(__dirname, "node_modules/@babel/runtime/$1"),
    ...expoPreset.moduleNameMapper,
  },
};
