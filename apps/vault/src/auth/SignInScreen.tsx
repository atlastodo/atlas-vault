import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Body, Button, ErrorText, Field, Muted, Screen, styles as ui } from "../ui/components";
import { describeError } from "../ui/errors";
import { space, usePalette } from "../ui/theme";
import { useAuth } from "./AuthContext";

const MIN_PASSWORD = 8;

/**
 * Sign in to (or create) the Atlas account, on the server the user names. The account is the one
 * Atlas Todo uses: the same email and password open both apps.
 */
export function SignInScreen() {
  const auth = useAuth();
  const p = usePalette();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [server, setServer] = useState(auth.serverUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

  const submit = async () => {
    setError(null);
    if (!server.trim()) return setError("Enter your Atlas server's address.");
    if (!email.trim() || !password) return setError("Enter your email and password.");
    if (signup && password.length < MIN_PASSWORD) {
      return setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
    }
    if (signup && password !== confirmPassword) return setError("The passwords differ.");
    setBusy(true);
    try {
      if (server.trim() !== auth.serverUrl) await auth.changeServerUrl(server);
      if (signup) await auth.signUp(email, password, name.trim());
      else await auth.signIn(email, password);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View style={local.hero}>
        <Text accessibilityRole="header" style={[local.brand, { color: p.text }]}>
          Atlas Vault
        </Text>
        <Muted>
          A password manager, end-to-end encrypted. Your passwords and keys are encrypted on this
          device before they reach your Atlas server, which sees no name, site or secret.
        </Muted>
      </View>
      <Field
        label="Server"
        value={server}
        onChangeText={setServer}
        placeholder="https://atlas.example.com/api"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint="Your Atlas server (the one Atlas Todo uses). It must offer Atlas Vault."
      />
      {signup ? (
        <Field label="Name (optional)" value={name} onChangeText={setName} autoComplete="name" />
      ) : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={signup ? "new-password" : "current-password"}
        onSubmitEditing={signup ? undefined : submit}
      />
      {signup ? (
        <Field
          label="Repeat password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
          onSubmitEditing={submit}
          hint="The password unlocks your encryption keys. Nobody can reset it for you: you will get a recovery phrase next."
        />
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={local.actions}>
        <Button
          kind="primary"
          label={signup ? "Create account" : "Sign in"}
          onPress={submit}
          busy={busy}
        />
        {busy ? <Muted>Deriving your keys can take a few seconds.</Muted> : null}
        <Button
          kind="ghost"
          label={signup ? "I already have an account" : "Create an account"}
          onPress={() => {
            setError(null);
            setMode(signup ? "signin" : "signup");
          }}
          disabled={busy}
        />
      </View>
      <View style={[ui.card, { borderColor: p.border, backgroundColor: p.surfaceMuted }]}>
        <Body>Already use Atlas Todo?</Body>
        <Muted>Sign in with the same account. Your vault has its own key and stays separate.</Muted>
      </View>
    </Screen>
  );
}

const local = StyleSheet.create({
  hero: { paddingTop: space.xxl, paddingBottom: space.xl, gap: space.sm },
  brand: { fontSize: 32, fontWeight: "800" },
  actions: { gap: space.sm, marginTop: space.md, marginBottom: space.xl },
});
