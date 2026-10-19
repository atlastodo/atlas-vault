/**
 * The password generator: random passwords from chosen character classes, and passphrases of
 * BIP39 English words (2048 words, 11 bits each). Every random choice comes from the platform's
 * CSPRNG (`crypto.getRandomValues`: WebCrypto in a browser, expo-crypto's SecureRandom polyfill on
 * a phone) through {@link randomBelow}, which rejection-samples so no choice is biased. There is no
 * fallback to `Math.random`: without a CSPRNG the generator throws.
 */

import { wordlist as BIP39_ENGLISH } from "@scure/bip39/wordlists/english.js";

/** Fills `bytes` with cryptographically secure random values. */
export type RandomSource = (bytes: Uint8Array) => void;

export function cryptoRandom(bytes: Uint8Array): void {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof c?.getRandomValues !== "function") {
    throw new Error("no secure random number generator on this platform");
  }
  c.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
}

/** A uniform integer in [0, n), by rejection sampling 32-bit values (no modulo bias). */
export function randomBelow(n: number, random: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`bad range ${n}`);
  if (n === 1) return 0;
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint8Array(4);
  for (;;) {
    random(buf);
    const x = ((buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!) >>> 0;
    if (x < limit) return x % n;
  }
}

export const LOWER = "abcdefghijklmnopqrstuvwxyz";
export const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";
export const SYMBOLS = "!#$%&()*+,-./:;<=>?@[]^_{|}~";
/** Characters easily read as one another, left out with `avoidAmbiguous`. */
export const AMBIGUOUS = "Il1O0o";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSPHRASE_MIN_WORDS = 4;
export const PASSPHRASE_MAX_WORDS = 20;

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous?: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  /** Append a random digit to one random word. */
  number: boolean;
}

export const DEFAULT_PASSWORD: PasswordOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

export const DEFAULT_PASSPHRASE: PassphraseOptions = {
  words: 6,
  separator: "-",
  capitalize: false,
  number: false,
};

function classes(opts: PasswordOptions): string[] {
  const strip = (s: string) =>
    opts.avoidAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join("") : s;
  const out: string[] = [];
  if (opts.lower) out.push(strip(LOWER));
  if (opts.upper) out.push(strip(UPPER));
  if (opts.digits) out.push(strip(DIGITS));
  if (opts.symbols) out.push(strip(SYMBOLS));
  return out;
}

/**
 * A password of `length` characters with at least one from each chosen class: one character drawn
 * from each class, the rest from all of them, then a Fisher-Yates shuffle.
 */
export function generatePassword(
  opts: PasswordOptions,
  random: RandomSource = cryptoRandom,
): string {
  const sets = classes(opts);
  if (sets.length === 0) throw new RangeError("choose at least one kind of character");
  const length = Math.trunc(opts.length);
  if (!(length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH)) {
    throw new RangeError(
      `a password is ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  const pool = sets.join("");
  const chars = sets.map((s) => s[randomBelow(s.length, random)]!);
  while (chars.length < length) chars.push(pool[randomBelow(pool.length, random)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, random);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** A passphrase of BIP39 English words. */
export function generatePassphrase(
  opts: PassphraseOptions,
  random: RandomSource = cryptoRandom,
): string {
  const count = Math.trunc(opts.words);
  if (!(count >= PASSPHRASE_MIN_WORDS && count <= PASSPHRASE_MAX_WORDS)) {
    throw new RangeError(
      `a passphrase is ${PASSPHRASE_MIN_WORDS} to ${PASSPHRASE_MAX_WORDS} words`,
    );
  }
  const words = Array.from({ length: count }, () => {
    const w = BIP39_ENGLISH[randomBelow(BIP39_ENGLISH.length, random)]!;
    return opts.capitalize ? w[0]!.toUpperCase() + w.slice(1) : w;
  });
  if (opts.number) {
    const at = randomBelow(count, random);
    words[at] = words[at]! + String(randomBelow(10, random));
  }
  return words.join(opts.separator);
}

/** The words a passphrase is drawn from (BIP39 English). */
export const PASSPHRASE_WORDS: readonly string[] = BIP39_ENGLISH;

/**
 * The entropy in bits of what the generator makes with these options (a lower bound for a
 * password: the one-of-each-class rule takes a little away, ignored here as it is under a bit).
 */
export function passwordEntropyBits(opts: PasswordOptions): number {
  const pool = classes(opts).join("").length;
  return pool === 0 ? 0 : Math.floor(Math.trunc(opts.length) * Math.log2(pool));
}

export function passphraseEntropyBits(opts: PassphraseOptions): number {
  const count = Math.trunc(opts.words);
  let bits = count * Math.log2(BIP39_ENGLISH.length);
  if (opts.number) bits += Math.log2(10) + Math.log2(count);
  return Math.floor(bits);
}
