#!/usr/bin/env node
// The third-party code Atlas Vault ships, and its licences.
//
// Every package reachable through `dependencies` (and installed peer and optional dependencies)
// from the workspace packages that end up in a build: the app and packages/vault-core. Dev
// dependencies (build tools, tests) are not shipped or listed. The Atlas core packages
// (@atlastodo/client-core from npm, and this repository's @atlastodo/vault-core) are Atlas's own
// code under the same licence, so they are walked for their dependencies but not listed. The
// server's and the CLI's notices (Rust crates) ship with the core repository's releases.
//
// Usage:
//   node scripts/third-party-licenses.mjs --check          # fail on a licence outside ALLOW
//   node scripts/third-party-licenses.mjs --notices FILE   # write the notices file
//
// Run `bun install` first. `--check` mirrors the core repository's allow-list (its deny.toml plus
// the licences only JS packages use); a new licence fails it for a human to review.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKSPACES = ["apps/vault", "packages/vault-core"];
// First-party packages (the core packages, vault-core): not third-party code.
const FIRST_PARTY = /^@atlastodo\//;

// The core repository's deny.toml list, and the permissive licences the shipped JS tree adds (each checked by hand).
const ALLOW = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unicode-3.0",
  "Zlib",
  "CDLA-Permissive-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "MIT-0",
  // Weak copyleft, compatible with AGPL (MPL 2.0 section 3.3): lightningcss, through Expo's CSS
  // tooling; also in the core repository's deny.toml, for webauthn-rs.
  "MPL-2.0",
  // Browser-support data, not code: caniuse-lite, through browserslist.
  "CC-BY-4.0",
]);

/** The licence of a package.json: SPDX `license`, an object, or the legacy `licenses` array. */
function licenseOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x?.type)).join(" OR ");
  if (l && typeof l === "object") return l.type ?? "UNKNOWN";
  return "UNKNOWN";
}

/** Whether an SPDX expression is satisfiable with allowed licences (OR picks one; AND needs all). */
export function allowed(expr) {
  const clean = expr.replace(/[()]/g, " ").trim();
  return clean.split(/\s+OR\s+/i).some((alt) =>
    alt
      .split(/\s+AND\s+/i)
      .map((s) => s.trim())
      .every((id) => ALLOW.has(id)),
  );
}

/** Node's lookup: `<dir>/node_modules/<name>`, then each parent's. Bun's isolated layout resolves too. */
function resolveDep(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return path.dirname(fs.realpathSync(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function jsPackages() {
  const seen = new Map(); // realpath -> entry
  // A build context may hold only some workspaces.
  const workspaceDirs = new Set(
    WORKSPACES.map((w) => path.join(ROOT, w))
      .filter((d) => fs.existsSync(path.join(d, "package.json")))
      .map((d) => fs.realpathSync(d)),
  );
  const queue = [...workspaceDirs];
  while (queue.length) {
    const dir = queue.shift();
    if (seen.has(dir)) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    seen.set(dir, {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      dir,
      own: workspaceDirs.has(dir) || FIRST_PARTY.test(pkg.name ?? ""),
    });
    const deps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const found = resolveDep(dir, name);
      // An optional or peer dependency that isn't installed isn't shipped either.
      if (found && !seen.has(found)) queue.push(found);
    }
  }
  return [...seen.values()]
    .filter((p) => !p.own)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The licence and notice files a package ships, in a stable order. */
function licenseTexts(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => /^(licen[cs]e|copying|notice)([-_.].*)?$/i.test(f))
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim());
}

function writeNotices(file) {
  const out = [
    "Atlas Vault third-party notices",
    "",
    "Atlas Vault is licensed under the GNU Affero General Public License v3.0 only. It includes the",
    "third-party software below, each under its own licence. Packages with identical licence texts",
    "share one copy of the text.",
    "",
  ];
  const section = (title, pkgs) => {
    // Group packages by their exact licence text, so the many identical texts appear once.
    const groups = new Map();
    for (const p of pkgs) {
      const texts = licenseTexts(p.dir);
      const key = texts.length
        ? texts.join("\n\n")
        : `(No licence file is included; the package declares: ${p.license})`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(`${p.name} ${p.version} (${p.license})`);
    }
    out.push("=".repeat(78), title, "=".repeat(78), "");
    for (const [text, names] of groups) {
      out.push(...names, "", text, "", "-".repeat(78), "");
    }
  };
  section("JavaScript packages (the web app)", jsPackages());
  fs.writeFileSync(file, out.join("\n"));
  console.log(`Wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KiB)`);
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const bad = jsPackages().filter((p) => !allowed(p.license));
    for (const p of bad) console.error(`${p.name}@${p.version}: ${p.license}`);
    if (bad.length) {
      console.error(
        `\n${bad.length} shipped JS package(s) with a licence outside the allow-list in scripts/third-party-licenses.mjs. ` +
          "Review each; add a licence to ALLOW only if it is compatible with AGPL-3.0-only.",
      );
      process.exit(1);
    }
    console.log("Every shipped JS package has an allowed licence.");
  }
  const at = args.indexOf("--notices");
  if (at >= 0) writeNotices(args[at + 1]);
  if (!args.includes("--check") && at < 0) {
    console.error("usage: third-party-licenses.mjs [--check] [--notices FILE]");
    process.exit(2);
  }
}
