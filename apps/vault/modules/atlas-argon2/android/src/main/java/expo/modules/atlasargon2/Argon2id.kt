package expo.modules.atlasargon2

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters

/**
 * Argon2id through Bouncy Castle's pure-Java implementation (no JNI), kept apart from the module so
 * it depends on nothing but Bouncy Castle. Its output must match the other clients' byte for byte
 * (`password_kdf_vectors.json`, shipped in `@atlastodo/client-core` under `test-vectors/`).
 */
object Argon2id {
  fun derive(
    passwordHex: String,
    saltHex: String,
    memoryKib: Int,
    iterations: Int,
    parallelism: Int,
    keyLength: Int,
  ): String {
    val password = fromHex(passwordHex)
    val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
      .withVersion(Argon2Parameters.ARGON2_VERSION_13)
      .withMemoryAsKB(memoryKib)
      .withIterations(iterations)
      .withParallelism(parallelism)
      .withSalt(fromHex(saltHex))
      .build()
    val generator = Argon2BytesGenerator()
    generator.init(params)
    val out = ByteArray(keyLength)
    try {
      generator.generateBytes(password, out)
      return toHex(out)
    } finally {
      password.fill(0)
      out.fill(0)
    }
  }

  private fun fromHex(hex: String): ByteArray {
    require(hex.length % 2 == 0) { "odd-length hex" }
    return ByteArray(hex.length / 2) { i ->
      ((Character.digit(hex[2 * i], 16) shl 4) or Character.digit(hex[2 * i + 1], 16)).toByte()
    }
  }

  private fun toHex(bytes: ByteArray): String {
    val digits = "0123456789abcdef"
    val chars = CharArray(bytes.size * 2)
    for (i in bytes.indices) {
      val v = bytes[i].toInt() and 0xff
      chars[2 * i] = digits[v ushr 4]
      chars[2 * i + 1] = digits[v and 0x0f]
    }
    return String(chars)
  }
}
