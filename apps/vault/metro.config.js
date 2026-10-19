/**
 * Metro for the Bun workspace. Bun keeps every installed package in the workspace root's
 * `node_modules/.bun`, so Metro watches the workspace root (for packages/vault-core too),
 * resolves from both the app's and the root's `node_modules`, and honours the package `exports`
 * field (the core packages are ESM `dist/` builds behind it).
 *
 * Hierarchical lookup must stay enabled: Bun's isolated linker puts each package's dependencies
 * under `node_modules/.bun/<pkg>/node_modules`, so Metro walks up from a module's real path.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
