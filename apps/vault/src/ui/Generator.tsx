import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  PASSPHRASE_MAX_WORDS,
  PASSPHRASE_MIN_WORDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  passwordEntropyBits,
} from "@atlastodo/vault-core";
import { usePrefs } from "../data/PrefsProvider";
import type { GeneratorPrefs } from "../lib/prefs";
import { Button, Choice, ErrorText, Field, Muted, Toggle } from "./components";
import { CopyButton } from "./fields";
import { MONO, radius, space, usePalette } from "./theme";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function make(g: GeneratorPrefs): string {
  return g.mode === "password" ? generatePassword(g.password) : generatePassphrase(g.passphrase);
}

/**
 * The password generator: a password (length, character classes, look-alikes left out) or a
 * passphrase (words, separator, capitals, a digit), from the platform's CSPRNG. The options are
 * remembered on this device. `onUse` puts the value into a field (the editor); without it the
 * panel offers Copy.
 */
export function GeneratorPanel({ onUse }: { onUse?: (value: string) => void }) {
  const p = usePalette();
  const { prefs, setPrefs } = usePrefs();
  const g = prefs.generator;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lengthText, setLengthText] = useState(String(g.password.length));
  const [wordsText, setWordsText] = useState(String(g.passphrase.words));

  const regenerate = useCallback((next: GeneratorPrefs) => {
    try {
      setValue(make(next));
      setError(null);
    } catch (err) {
      setValue("");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    regenerate(g);
  }, [g, regenerate]);

  const update = (next: GeneratorPrefs) => setPrefs({ generator: next });
  const bits =
    g.mode === "password" ? passwordEntropyBits(g.password) : passphraseEntropyBits(g.passphrase);

  return (
    <View>
      <View style={[local.output, { backgroundColor: p.surfaceMuted, borderColor: p.border }]}>
        <Text
          selectable
          accessibilityLabel="Generated value"
          style={[local.value, { color: p.text }]}
        >
          {value || " "}
        </Text>
        <Muted>About {bits} bits of entropy</Muted>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={local.actions}>
        <Button label="Regenerate" onPress={() => regenerate(g)} />
        {onUse ? (
          <Button kind="primary" label="Use it" disabled={!value} onPress={() => onUse(value)} />
        ) : value ? (
          <CopyButton value={value} secret label="generated value" />
        ) : null}
      </View>
      <Choice
        label="Kind"
        value={g.mode}
        options={[
          { value: "password", label: "Password" },
          { value: "passphrase", label: "Passphrase" },
        ]}
        onChange={(mode) => update({ ...g, mode })}
      />
      {g.mode === "password" ? (
        <>
          <Field
            label={`Length (${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH})`}
            value={lengthText}
            keyboardType="number-pad"
            onChangeText={setLengthText}
            onBlur={() => {
              const n = clamp(Number(lengthText) || 0, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH);
              setLengthText(String(n));
              update({ ...g, password: { ...g.password, length: n } });
            }}
          />
          <Toggle
            label="Lower case (a–z)"
            value={g.password.lower}
            onChange={(lower) => update({ ...g, password: { ...g.password, lower } })}
          />
          <Toggle
            label="Upper case (A–Z)"
            value={g.password.upper}
            onChange={(upper) => update({ ...g, password: { ...g.password, upper } })}
          />
          <Toggle
            label="Digits (0–9)"
            value={g.password.digits}
            onChange={(digits) => update({ ...g, password: { ...g.password, digits } })}
          />
          <Toggle
            label="Symbols (!#$%…)"
            value={g.password.symbols}
            onChange={(symbols) => update({ ...g, password: { ...g.password, symbols } })}
          />
          <Toggle
            label="Leave out look-alikes (I l 1 O 0 o)"
            value={!!g.password.avoidAmbiguous}
            onChange={(avoidAmbiguous) =>
              update({ ...g, password: { ...g.password, avoidAmbiguous } })
            }
          />
        </>
      ) : (
        <>
          <Field
            label={`Words (${PASSPHRASE_MIN_WORDS}–${PASSPHRASE_MAX_WORDS})`}
            value={wordsText}
            keyboardType="number-pad"
            onChangeText={setWordsText}
            onBlur={() => {
              const n = clamp(Number(wordsText) || 0, PASSPHRASE_MIN_WORDS, PASSPHRASE_MAX_WORDS);
              setWordsText(String(n));
              update({ ...g, passphrase: { ...g.passphrase, words: n } });
            }}
          />
          <Choice
            label="Separator"
            value={g.passphrase.separator}
            options={[
              { value: "-", label: "hyphen" },
              { value: " ", label: "space" },
              { value: ".", label: "dot" },
              { value: "_", label: "underscore" },
            ]}
            onChange={(separator) => update({ ...g, passphrase: { ...g.passphrase, separator } })}
          />
          <Toggle
            label="Capitalize words"
            value={g.passphrase.capitalize}
            onChange={(capitalize) => update({ ...g, passphrase: { ...g.passphrase, capitalize } })}
          />
          <Toggle
            label="Add a digit"
            value={g.passphrase.number}
            onChange={(number) => update({ ...g, passphrase: { ...g.passphrase, number } })}
          />
        </>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  output: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  value: { fontFamily: MONO, fontSize: 18, lineHeight: 26 },
  actions: { flexDirection: "row", gap: space.sm, marginVertical: space.md, flexWrap: "wrap" },
});
