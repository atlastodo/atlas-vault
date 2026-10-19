import { DEFAULT_PREFS, parsePrefs } from "./prefs";

describe("parsePrefs", () => {
  it("falls back to the defaults for anything missing or malformed", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ autoLockMinutes: 7, clipboardSeconds: 5 }))).toEqual(
      DEFAULT_PREFS,
    );
  });

  it("keeps valid choices", () => {
    const p = parsePrefs(
      JSON.stringify({
        autoLockMinutes: 60,
        clipboardSeconds: 120,
        generator: { mode: "passphrase", passphrase: { words: 8 } },
      }),
    );
    expect(p.autoLockMinutes).toBe(60);
    expect(p.clipboardSeconds).toBe(120);
    expect(p.generator.mode).toBe("passphrase");
    expect(p.generator.passphrase.words).toBe(8);
    expect(p.generator.passphrase.separator).toBe(DEFAULT_PREFS.generator.passphrase.separator);
  });
});
