# Android permissions

Every permission the Android app declares, and why. The release build checks its merged manifest
against the table below (`apps/vault/scripts/check-android-permissions.mjs`), so a dependency
update that adds a permission fails the release instead of reaching users. To accept a new one,
add a row here; to drop one, add it to `android.blockedPermissions` in `apps/vault/app.json`
and remove its row.

Check a local build with `android:permissions` (after `build:android:release` or any Gradle
release build).

## Declared

| Permission                                                  | Asked for                | What it is for                                                                                   |
| ----------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `android.permission.INTERNET`                               | No (granted at install)  | Syncing with your server.                                                                        |
| `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | No (internal to the app) | AndroidX's signature permission that keeps the app's runtime-registered receivers private to it. |

## Removed

Dependencies declare these, but the app does not use what they guard, so `app.json` strips them
(`android.blockedPermissions`):

- Storage (`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`): the vault keeps nothing on shared
  storage (its items stay in memory, its session in the keychain).
- Audio (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`), `VIBRATE`: the app plays no sound and gives no
  haptic feedback.
- `SYSTEM_ALERT_WINDOW`: a development-build overlay.
- `ACCESS_WIFI_STATE`: nothing reads the network's details.
- `USE_BIOMETRIC`, `USE_FINGERPRINT`: expo-secure-store's biometric unlock, which the app does not
  use.
- `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE`: Play's install
  referrer (install attribution), pulled in through expo-application, which the app uses only for
  the install key.
