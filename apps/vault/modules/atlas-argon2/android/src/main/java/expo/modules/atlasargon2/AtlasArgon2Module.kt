package expo.modules.atlasargon2

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The password KDF's Argon2id on Android. Hermes has no WebAssembly and no JIT, so the portable
 * JavaScript implementation takes many seconds there; this runs on a background thread instead.
 * Bytes cross the bridge as hex, which every Expo version converts the same way.
 */
class AtlasArgon2Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("AtlasArgon2")

    AsyncFunction("argon2idAsync") {
        passwordHex: String,
        saltHex: String,
        memoryKib: Int,
        iterations: Int,
        parallelism: Int,
        keyLength: Int ->
      Argon2id.derive(passwordHex, saltHex, memoryKib, iterations, parallelism, keyLength)
    }
  }
}
