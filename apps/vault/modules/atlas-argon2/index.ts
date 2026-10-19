import { requireOptionalNativeModule } from "expo";

interface AtlasArgon2 {
  /**
   * Argon2id (version 0x13, no secret, no associated data) of hex-encoded password and salt bytes,
   * answered as hex. Runs off the JS thread.
   */
  argon2idAsync(
    passwordHex: string,
    saltHex: string,
    memoryKib: number,
    iterations: number,
    parallelism: number,
    keyLength: number,
  ): Promise<string>;
}

/** The Android module, or null where it is not built in (iOS, the web, Expo Go, tests). */
export const Argon2 = requireOptionalNativeModule<AtlasArgon2>("AtlasArgon2");
