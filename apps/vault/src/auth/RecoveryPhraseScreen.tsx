import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Header, Muted, Screen } from "../ui/components";
import { radius, space, usePalette } from "../ui/theme";

/**
 * The new account's recovery phrase, shown once after sign-up: it is the only way back into the
 * account (and every app's data) without the password. The server never sees it.
 */
export function RecoveryPhraseScreen({ phrase, onDone }: { phrase: string; onDone: () => void }) {
  const p = usePalette();
  const [saved, setSaved] = useState(false);
  const words = phrase.split(" ");
  return (
    <Screen scroll>
      <Header title="Your recovery phrase" />
      <Muted>
        Write these 24 words down and keep them somewhere safe. If you forget your password, they
        are the only way to recover your account; without both, your vault cannot be decrypted by
        anyone, including the server's operator.
      </Muted>
      <View
        style={[local.grid, { borderColor: p.border, backgroundColor: p.surface }]}
        accessibilityLabel="Recovery phrase"
      >
        {words.map((word, i) => (
          <View key={i} style={local.word}>
            <Text style={[local.index, { color: p.muted }]}>{i + 1}</Text>
            <Text selectable style={[local.text, { color: p.text }]}>
              {word}
            </Text>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved }}
        onPress={() => setSaved((s) => !s)}
        style={local.check}
      >
        <View
          style={[
            local.box,
            {
              borderColor: saved ? p.accent : p.border,
              backgroundColor: saved ? p.accent : p.surface,
            },
          ]}
        >
          {saved ? <Text style={{ color: p.onAccent }}>✓</Text> : null}
        </View>
        <Text style={{ color: p.text, flex: 1 }}>I have written down my recovery phrase</Text>
      </Pressable>
      <Button kind="primary" label="Continue to my vault" onPress={onDone} disabled={!saved} />
    </Screen>
  );
}

const local = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    marginVertical: space.xl,
  },
  word: { width: "33.33%", flexDirection: "row", gap: space.xs, paddingVertical: space.xs },
  index: { width: 22, textAlign: "right", fontVariant: ["tabular-nums"] },
  text: { fontSize: 15, fontWeight: "600" },
  check: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.lg },
  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
