import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  formatTotp,
  isSecretKind,
  parseTotp,
  totpCode,
  type TotpParams,
} from "@atlastodo/vault-core";
import { usePrefs } from "../data/PrefsProvider";
import { copyValue } from "../lib/clipboard";
import { Button } from "./components";
import { MASK } from "./format";
import { MONO, space, usePalette } from "./theme";

/** Copy `value` (a secret is marked sensitive and cleared after the device's timeout). */
export function useCopy(): (value: string, secret: boolean) => Promise<void> {
  const { prefs } = usePrefs();
  return (value, secret) => copyValue(value, { secret, clearAfterSeconds: prefs.clipboardSeconds });
}

/** A Copy button that says "Copied" for a moment. */
export function CopyButton({
  value,
  secret,
  label,
}: {
  value: string;
  secret: boolean;
  label: string;
}) {
  const copy = useCopy();
  const { prefs } = usePrefs();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      kind="ghost"
      label={done ? (secret ? `Copied · clears in ${prefs.clipboardSeconds} s` : "Copied") : "Copy"}
      accessibilityLabel={`Copy ${label}`}
      onPress={() => {
        void copy(value, secret).then(() => setDone(true));
      }}
    />
  );
}

/**
 * One field of an item: its name, its value (a secret masked until revealed; revealing is per
 * field and forgotten when the screen goes, which a lock makes it do) and Copy.
 */
export function FieldRow({ name, kind, value }: { name: string; kind: string; value: string }) {
  const p = usePalette();
  const secret = isSecretKind(kind);
  const [revealed, setRevealed] = useState(false);
  if (kind === "totp") return <TotpRow name={name} value={value} />;
  return (
    <View style={[local.row, { borderTopColor: p.border }]}>
      <View style={local.fill}>
        <Text style={[local.name, { color: p.muted }]}>{name}</Text>
        <Text
          selectable={!secret || revealed}
          accessibilityLabel={secret && !revealed ? `${name}, hidden` : `${name}: ${value}`}
          style={[local.value, { color: p.text }, secret && local.mono]}
        >
          {secret && !revealed ? MASK : value || "—"}
        </Text>
      </View>
      {secret ? (
        <Button
          kind="ghost"
          label={revealed ? "Hide" : "Reveal"}
          accessibilityLabel={`${revealed ? "Hide" : "Reveal"} ${name}`}
          onPress={() => setRevealed((r) => !r)}
        />
      ) : null}
      {value ? <CopyButton value={value} secret={secret} label={name} /> : null}
    </View>
  );
}

/** The current code of a TOTP field, counting down; the seed itself is never shown here. */
export function TotpRow({ name, value }: { name: string; value: string }) {
  const p = usePalette();
  const parsed = useMemo((): { params: TotpParams } | { error: string } => {
    try {
      return { params: parseTotp(value) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [value]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if ("error" in parsed) {
    return (
      <View style={[local.row, { borderTopColor: p.border }]}>
        <View style={local.fill}>
          <Text style={[local.name, { color: p.muted }]}>{name}</Text>
          <Text style={[local.value, { color: p.danger }]}>Can't make a code: {parsed.error}</Text>
        </View>
      </View>
    );
  }
  const code = totpCode(parsed.params, now);
  return (
    <View style={[local.row, { borderTopColor: p.border }]}>
      <View style={local.fill}>
        <Text style={[local.name, { color: p.muted }]}>{name} (one-time code)</Text>
        <Text
          accessibilityLabel={`${name} code ${code.code.split("").join(" ")}, ${code.remaining} seconds left`}
          style={[local.code, { color: p.text }]}
        >
          {formatTotp(code.code)}
        </Text>
        <Text style={[local.name, { color: code.remaining <= 5 ? p.danger : p.muted }]}>
          {code.remaining} s left
        </Text>
      </View>
      <CopyButton value={code.code} secret label={`${name} code`} />
    </View>
  );
}

const local = StyleSheet.create({
  fill: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderTopWidth: 1,
    paddingVertical: space.sm,
  },
  name: { fontSize: 13, fontWeight: "600" },
  value: { fontSize: 16, lineHeight: 22 },
  mono: { fontFamily: MONO },
  code: { fontSize: 26, fontWeight: "700", fontFamily: MONO, letterSpacing: 2 },
});
