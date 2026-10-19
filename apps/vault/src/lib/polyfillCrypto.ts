/**
 * Cryptographic polyfill for React Native (Hermes / JSC).
 *
 * Hermes does not implement the standard Web Cryptography API (`globalThis.crypto.getRandomValues`).
 * Cryptographic libraries like `@noble/hashes`, `@noble/curves`, `@noble/ciphers`, and `@scure/bip39`
 * require `crypto.getRandomValues` for CSPRNG operations (generating salts, IVs, DEKs, keypairs,
 * and BIP39 recovery phrases).
 *
 * This polyfills `globalThis.crypto.getRandomValues` and `globalThis.crypto.randomUUID` synchronously
 * using `expo-crypto`'s native implementation (SecureRandom on Android, SecRandomCopyBytes on iOS).
 */
import * as Crypto from "expo-crypto";

function ensureCryptoPolyfill(): void {
  if (typeof globalThis.crypto !== "object" || globalThis.crypto === null) {
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: {},
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      (globalThis as { crypto?: unknown }).crypto = {};
    }
  }

  const cryptoObj = globalThis.crypto as unknown as Record<string, unknown>;

  if (typeof cryptoObj.getRandomValues !== "function") {
    const getRandomValuesImpl = function getRandomValues<T extends ArrayBufferView | null>(
      array: T,
    ): T {
      if (array) {
        Crypto.getRandomValues(array as unknown as Parameters<typeof Crypto.getRandomValues>[0]);
      }
      return array;
    };

    try {
      Object.defineProperty(cryptoObj, "getRandomValues", {
        value: getRandomValuesImpl,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      cryptoObj.getRandomValues = getRandomValuesImpl;
    }
  }

  if (typeof cryptoObj.randomUUID !== "function") {
    const randomUUIDImpl = function randomUUID(): string {
      return Crypto.randomUUID();
    };

    try {
      Object.defineProperty(cryptoObj, "randomUUID", {
        value: randomUUIDImpl,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      cryptoObj.randomUUID = randomUUIDImpl;
    }
  }
}

// Execute immediately on import
ensureCryptoPolyfill();
