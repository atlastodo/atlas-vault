import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS,
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  DIGITS,
  LOWER,
  PASSPHRASE_WORDS,
  SYMBOLS,
  UPPER,
  cryptoRandom,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  passwordEntropyBits,
  randomBelow,
  type RandomSource,
} from "./generator";

/** A scripted byte source: replays `bytes` (then zeros), recording how many were drawn. */
function scripted(bytes: number[]): RandomSource & { drawn: number } {
  let i = 0;
  const fn = ((buf: Uint8Array) => {
    for (let j = 0; j < buf.length; j++) buf[j] = bytes[i++] ?? 0;
    fn.drawn = i;
  }) as RandomSource & { drawn: number };
  fn.drawn = 0;
  return fn;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

describe("randomBelow", () => {
  it("rejects values in the biased tail and maps the rest uniformly", () => {
    // n = 3: 2^32 % 3 = 1, so 0xFFFFFFFF is the one rejected value.
    const random = scripted([...u32(0xffffffff), ...u32(7)]);
    expect(randomBelow(3, random)).toBe(7 % 3);
    expect(random.drawn).toBe(8);
  });

  it("is uniform enough over many draws from the real CSPRNG", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 20_000; i++) counts[randomBelow(10)]++;
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThan(250);
  });

  it("refuses an empty range", () => {
    expect(() => randomBelow(0)).toThrow(RangeError);
    expect(randomBelow(1)).toBe(0);
  });

  it("never falls back to Math.random", () => {
    const saved = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(() => cryptoRandom(new Uint8Array(4))).toThrow("no secure random");
      expect(() => generatePassword(DEFAULT_PASSWORD)).toThrow("no secure random");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: saved, configurable: true });
    }
  });
});

describe("generatePassword", () => {
  it("has the length asked for and a character of every chosen class", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword({ ...DEFAULT_PASSWORD, length: 8 });
      expect(pw).toHaveLength(8);
      for (const set of [LOWER, UPPER, DIGITS, SYMBOLS]) {
        expect([...pw].some((c) => set.includes(c))).toBe(true);
      }
    }
  });

  it("draws only from the chosen classes", () => {
    const pw = generatePassword({
      length: 64,
      lower: false,
      upper: false,
      digits: true,
      symbols: false,
    });
    expect(pw).toMatch(/^[0-9]{64}$/);
  });

  it("leaves out look-alike characters on request", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ ...DEFAULT_PASSWORD, length: 128, avoidAmbiguous: true });
      expect([...pw].some((c) => AMBIGUOUS.includes(c))).toBe(false);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword(DEFAULT_PASSWORD)));
    expect(seen.size).toBe(500);
  });

  it("refuses no classes and lengths out of range", () => {
    const none = { length: 20, lower: false, upper: false, digits: false, symbols: false };
    expect(() => generatePassword(none)).toThrow("at least one");
    expect(() => generatePassword({ ...DEFAULT_PASSWORD, length: 7 })).toThrow(RangeError);
    expect(() => generatePassword({ ...DEFAULT_PASSWORD, length: 129 })).toThrow(RangeError);
  });

  it("estimates the entropy from the pool", () => {
    // 26 + 26 + 10 + 28 = 90 characters: 20 * log2(90) ≈ 129.8.
    expect(passwordEntropyBits(DEFAULT_PASSWORD)).toBe(129);
    expect(
      passwordEntropyBits({ length: 10, lower: false, upper: false, digits: true, symbols: false }),
    ).toBe(33);
  });
});

describe("generatePassphrase", () => {
  it("joins words from the list", () => {
    const phrase = generatePassphrase(DEFAULT_PASSPHRASE);
    const words = phrase.split("-");
    expect(words).toHaveLength(6);
    for (const w of words) expect(PASSPHRASE_WORDS).toContain(w);
  });

  it("capitalizes and adds a digit on request", () => {
    const phrase = generatePassphrase({ words: 5, separator: " ", capitalize: true, number: true });
    const words = phrase.split(" ");
    expect(words).toHaveLength(5);
    for (const w of words) expect(w).toMatch(/^[A-Z][a-z]+[0-9]?$/);
    expect(words.filter((w) => /[0-9]$/.test(w))).toHaveLength(1);
  });

  it("picks words by the random source (index 0 is the list's first)", () => {
    expect(generatePassphrase({ ...DEFAULT_PASSPHRASE, words: 4 }, scripted([]))).toBe(
      Array(4).fill(PASSPHRASE_WORDS[0]).join("-"),
    );
  });

  it("uses the 2048-word BIP39 list: 11 bits a word", () => {
    expect(PASSPHRASE_WORDS).toHaveLength(2048);
    expect(new Set(PASSPHRASE_WORDS).size).toBe(2048);
    expect(passphraseEntropyBits(DEFAULT_PASSPHRASE)).toBe(66);
    expect(() => generatePassphrase({ ...DEFAULT_PASSPHRASE, words: 3 })).toThrow(RangeError);
  });
});
