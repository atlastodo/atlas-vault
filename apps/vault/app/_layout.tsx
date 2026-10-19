import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { AutoLockGate } from "../src/auth/AutoLockGate";
import { RecoveryPhraseScreen } from "../src/auth/RecoveryPhraseScreen";
import { SignInScreen } from "../src/auth/SignInScreen";
import { UnlockScreen } from "../src/auth/UnlockScreen";
import { PrefsProvider } from "../src/data/PrefsProvider";
import { VaultProvider } from "../src/data/VaultProvider";
import { usePalette } from "../src/ui/theme";

function Loading() {
  const p = usePalette();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: p.background,
      }}
    >
      <ActivityIndicator color={p.accent} />
    </View>
  );
}

/**
 * Who sees what: the sign-in screen without a session, the recovery phrase once after sign-up,
 * the unlock screen for a locked session (no vault keys), else the vault under auto-lock. Locking
 * unmounts the vault: its store, its decrypted items and every revealed secret go with it.
 */
function Gate() {
  const auth = useAuth();
  const p = usePalette();
  if (!auth.restored) return <Loading />;
  if (!auth.session) return <SignInScreen />;
  if (auth.recoveryPhrase) {
    return (
      <RecoveryPhraseScreen phrase={auth.recoveryPhrase} onDone={auth.dismissRecoveryPhrase} />
    );
  }
  if (!auth.keys) return <UnlockScreen />;
  return (
    <VaultProvider
      api={auth.api}
      deviceId={auth.session.deviceId}
      keys={auth.keys}
      fallback={<Loading />}
    >
      <AutoLockGate>
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.background } }}
        />
      </AutoLockGate>
    </VaultProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <PrefsProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </PrefsProvider>
    </SafeAreaProvider>
  );
}
