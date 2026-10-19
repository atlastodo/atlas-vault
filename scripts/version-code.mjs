#!/usr/bin/env node
// The Android versionCode for a release version, derived so it can only grow:
//
//   major * 1_000_000 + minor * 10_000 + patch * 100 + slot
//
// where slot is N for `-rc.N` (1..98) and 99 for the stable release. So 0.1.4-rc.1 < 0.1.4-rc.2 <
// 0.1.4 < 0.1.5-rc.1, and an rc never collides with its own stable release. minor and patch must be
// below 100. Every code is far above the 80-81 the older +1-per-release scheme reached (v0.1.2,
// v0.1.3), so Play still sees an increase. Only x.y.z and x.y.z-rc.N are release versions.
//
// Usage: version-code.mjs <version>  (prints the code); also imported by the tests.
import { fileURLToPath } from "node:url";

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.([1-9]\d*))?$/;

export function versionCode(version) {
  const m = RELEASE.exec(version);
  if (!m) throw new Error(`version must be x.y.z or x.y.z-rc.N, got '${version}'`);
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  const rc = m[4] === undefined ? undefined : Number(m[4]);
  const slot = rc ?? 99;
  if (minor > 99 || patch > 99 || (rc !== undefined && rc > 98) || major > 2000) {
    throw new Error(`version '${version}' is out of range for the versionCode scheme`);
  }
  return major * 1_000_000 + minor * 10_000 + patch * 100 + slot;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // A string, not a number: console.log would colour a number when FORCE_COLOR is set.
    console.log(String(versionCode(process.argv[2] ?? "")));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
