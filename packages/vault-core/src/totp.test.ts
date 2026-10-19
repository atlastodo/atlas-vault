import { describe, expect, it } from "vitest";
import { base32Decode, formatTotp, hotp, parseTotp, totpCode, type TotpAlgorithm } from "./totp";

const ascii = (s: string) => new TextEncoder().encode(s);

/** RFC 6238 Appendix B: the seeds are these ASCII strings, codes are 8 digits, period 30 s. */
const SEEDS: Record<TotpAlgorithm, Uint8Array> = {
  SHA1: ascii("12345678901234567890"),
  SHA256: ascii("12345678901234567890123456789012"),
  SHA512: ascii("1234567890123456789012345678901234567890123456789012345678901234"),
};

const RFC6238: [number, string, TotpAlgorithm][] = [
  [59, "94287082", "SHA1"],
  [59, "46119246", "SHA256"],
  [59, "90693936", "SHA512"],
  [1111111109, "07081804", "SHA1"],
  [1111111109, "68084774", "SHA256"],
  [1111111109, "25091201", "SHA512"],
  [1111111111, "14050471", "SHA1"],
  [1111111111, "67062674", "SHA256"],
  [1111111111, "99943326", "SHA512"],
  [1234567890, "89005924", "SHA1"],
  [1234567890, "91819424", "SHA256"],
  [1234567890, "93441116", "SHA512"],
  [2000000000, "69279037", "SHA1"],
  [2000000000, "90698825", "SHA256"],
  [2000000000, "38618901", "SHA512"],
  [20000000000, "65353130", "SHA1"],
  [20000000000, "77737706", "SHA256"],
  [20000000000, "47863826", "SHA512"],
];

describe("TOTP (RFC 6238 test vectors)", () => {
  it.each(RFC6238)("T=%i gives %s with %s", (time, code, algorithm) => {
    const got = totpCode(
      { secret: SEEDS[algorithm], algorithm, digits: 8, period: 30 },
      time * 1000,
    );
    expect(got.code).toBe(code);
  });

  it("counts down to the next code", () => {
    const params = { secret: SEEDS.SHA1, algorithm: "SHA1" as const, digits: 6, period: 30 };
    expect(totpCode(params, 59_000).remaining).toBe(1);
    expect(totpCode(params, 60_000).remaining).toBe(30);
  });
});

describe("HOTP (RFC 4226 Appendix D)", () => {
  const expected = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];
  it.each(expected.map((c, i) => [i, c] as const))("counter %i gives %s", (counter, code) => {
    expect(hotp(SEEDS.SHA1, counter)).toBe(code);
  });
});

describe("reading a stored TOTP value", () => {
  // "12345678901234567890" in base32.
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("decodes base32, case and spacing aside", () => {
    expect(base32Decode(SECRET)).toEqual(SEEDS.SHA1);
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toEqual(SEEDS.SHA1);
    expect(() => base32Decode("not base32!")).toThrow("not base32");
  });

  it("reads a bare base32 seed (the shared rules' stored form) as SHA-1, 6 digits, 30 s", () => {
    const p = parseTotp(SECRET);
    expect(p).toMatchObject({ algorithm: "SHA1", digits: 6, period: 30 });
    expect(totpCode(p, 59_000).code).toBe("287082");
  });

  it("reads an otpauth URI with its parameters and label", () => {
    const p = parseTotp(
      `otpauth://totp/ACME%20Co:jane@example.com?secret=${SECRET}&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60`,
    );
    expect(p).toMatchObject({
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      issuer: "ACME Co",
      account: "jane@example.com",
    });
    const plain = parseTotp(`otpauth://totp/Atlas:me?secret=${SECRET}`);
    expect(plain).toMatchObject({ algorithm: "SHA1", digits: 6, period: 30, issuer: "Atlas" });
  });

  it("refuses what it cannot compute", () => {
    expect(() => parseTotp(`otpauth://hotp/x?secret=${SECRET}&counter=1`)).toThrow("time-based");
    expect(() => parseTotp("otpauth://totp/x")).toThrow("no secret");
    expect(() => parseTotp(`otpauth://totp/x?secret=${SECRET}&algorithm=MD5`)).toThrow("MD5");
    expect(() => parseTotp(`otpauth://totp/x?secret=${SECRET}&digits=12`)).toThrow("digits");
  });

  it("formats a code in two halves", () => {
    expect(formatTotp("123456")).toBe("123 456");
    expect(formatTotp("12345678")).toBe("1234 5678");
  });
});
