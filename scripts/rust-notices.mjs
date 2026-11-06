#!/usr/bin/env node
// THIRD_PARTY_NOTICES.txt for the Rust binaries a release ships: every crate the named packages
// reach through normal dependencies (for x86_64 Linux, the superset of what the targets link),
// with its licence texts; packages with identical texts share one copy. Licences are checked by
// cargo-deny (deny.toml, CI's `Audit (Rust)`), not here.
//
// Usage: node scripts/rust-notices.mjs OUT "Title" PACKAGE...   (cargo on PATH)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const [file, title, ...shipped] = process.argv.slice(2);
if (!file || !title || !shipped.length) {
  console.error('usage: rust-notices.mjs OUT "Title" PACKAGE...');
  process.exit(2);
}

const meta = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      "x86_64-unknown-linux-gnu",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ),
);
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const roots = meta.packages.filter((p) => shipped.includes(p.name));
if (roots.length !== shipped.length) {
  console.error(`not in the workspace: ${shipped.filter((s) => !roots.some((r) => r.name === s))}`);
  process.exit(2);
}
const seen = new Set();
const queue = roots.map((p) => p.id);
while (queue.length) {
  const id = queue.shift();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const dep of nodes.get(id)?.deps ?? []) {
    if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
  }
}
// This repository's crates and core's (atlas-client, atlas-core) are under the project licence.
const own = new Set(meta.workspace_members);
const crates = [...seen]
  .filter((id) => !own.has(id))
  .map((id) => byId.get(id))
  .filter((p) => !/^https:\/\/github\.com\/atlastodo\//.test(p.repository ?? ""))
  .map((p) => ({
    name: p.name,
    version: p.version,
    license: p.license ?? (p.license_file ? `see ${p.license_file}` : "UNKNOWN"),
    dir: path.dirname(p.manifest_path),
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

/** The licence and notice files a crate ships, in a stable order. */
function licenseTexts(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)([-_.].*)?$/i.test(f))
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim());
}

const out = [
  `${title} third-party notices`,
  "",
  `${title} is licensed under the GNU Affero General Public License v3.0 only. It includes the`,
  "third-party software below, each under its own licence. Packages with identical licence texts",
  "share one copy of the text.",
  "",
  "=".repeat(78),
  `Rust crates (${shipped.join(", ")})`,
  "=".repeat(78),
  "",
];
const groups = new Map();
for (const c of crates) {
  const texts = licenseTexts(c.dir);
  const key = texts.length
    ? texts.join("\n\n")
    : `(No licence file is included; the crate declares: ${c.license})`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(`${c.name} ${c.version} (${c.license})`);
}
for (const [text, names] of groups) out.push(...names, "", text, "", "-".repeat(78), "");
fs.writeFileSync(file, out.join("\n"));
console.log(
  `Wrote ${file}: ${crates.length} crates (${(fs.statSync(file).size / 1024).toFixed(0)} KiB)`,
);
