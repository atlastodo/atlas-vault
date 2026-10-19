/**
 * TOTP codes (RFC 6238 over RFC 4226's HOTP) from a vault item's `totp` field. The shared item
 * rules store a TOTP value either as an `otpauth://totp/…` URI (kept as given) or as a base32
 * secret (upper-case, no spaces or padding); both are read here. SHA-1 (the default), SHA-256 and
 * SHA-512, 6 to 8 digits and any period are supported. Only code display: nothing is written.
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpParams {
  secret: Uint8Array;
  algorithm: TotpAlgorithm;
  digits: number;
  /** Seconds. */
  period: number;
  issuer?: string;
  account?: string;
}

export class TotpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotpError";
  }
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, case-insensitive, spaces and padding ignored. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  if (!clean) throw new TotpError("the TOTP secret is empty");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new TotpError("the TOTP secret is not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function intParam(v: string | null, fallback: number, min: number, max: number, name: string) {
  if (v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new TotpError(`unsupported TOTP ${name}`);
  return n;
}

/** The parameters of a stored TOTP value; throws {@link TotpError} for one it cannot use. */
export function parseTotp(value: string): TotpParams {
  const v = value.trim();
  if (!/^otpauth:\/\//i.test(v)) {
    return { secret: base32Decode(v), algorithm: "SHA1", digits: 6, period: 30 };
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new TotpError("the otpauth URI does not parse");
  }
  // `new URL` puts the type in the host for a non-special scheme ("otpauth://totp/Label").
  const type = (url.host || url.pathname.replace(/^\/+/, "").split("/")[0] || "").toLowerCase();
  if (type !== "totp") throw new TotpError("only time-based (totp) codes are supported");
  const q = url.searchParams;
  const secret = q.get("secret");
  if (!secret) throw new TotpError("the otpauth URI has no secret");
  const alg = (q.get("algorithm") ?? "SHA1").toUpperCase().replace("-", "");
  if (alg !== "SHA1" && alg !== "SHA256" && alg !== "SHA512") {
    throw new TotpError(`unsupported TOTP algorithm ${alg}`);
  }
  const label = decodeURIComponent(url.pathname.replace(/^\/+/, "")).replace(/^totp\//i, "");
  const [labelIssuer, account] = label.includes(":")
    ? [label.slice(0, label.indexOf(":")), label.slice(label.indexOf(":") + 1).trim()]
    : [undefined, label || undefined];
  return {
    secret: base32Decode(secret),
    algorithm: alg,
    digits: intParam(q.get("digits"), 6, 6, 8, "digits"),
    period: intParam(q.get("period"), 30, 1, 3600, "period"),
    issuer: q.get("issuer") ?? labelIssuer,
    account: account || undefined,
  };
}

const HASHES = { SHA1: sha1, SHA256: sha256, SHA512: sha512 } as const;

/** RFC 4226 HOTP: the code for `counter`, zero-padded to `digits`. */
export function hotp(
  secret: Uint8Array,
  counter: number,
  algorithm: TotpAlgorithm = "SHA1",
  digits = 6,
): string {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c % 256;
    c = Math.floor(c / 256);
  }
  const mac = hmac(HASHES[algorithm], secret, msg);
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export interface TotpCode {
  code: string;
  /** Seconds until the next code. */
  remaining: number;
  period: number;
}

/** The code at `nowMs` (unix ms). */
export function totpCode(params: TotpParams, nowMs: number): TotpCode {
  const seconds = Math.floor(nowMs / 1000);
  const counter = Math.floor(seconds / params.period);
  return {
    code: hotp(params.secret, counter, params.algorithm, params.digits),
    remaining: params.period - (seconds % params.period),
    period: params.period,
  };
}

/** A code split for reading ("123 456"). */
export function formatTotp(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}
