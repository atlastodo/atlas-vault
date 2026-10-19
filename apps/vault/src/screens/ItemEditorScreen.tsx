import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  VAULT_FIELD_KINDS,
  VAULT_ITEM_TYPES,
  isSecretKind,
  type VaultFieldInput,
  type VaultItemType,
} from "@atlastodo/vault-core";
import { useVault } from "../data/VaultProvider";
import {
  Button,
  Choice,
  ErrorText,
  Field,
  Header,
  Muted,
  Screen,
  SectionTitle,
  Toggle,
  styles as ui,
} from "../ui/components";
import { describeError } from "../ui/errors";
import { KIND_LABELS, typeLabel } from "../ui/format";
import { GeneratorPanel } from "../ui/Generator";
import { MONO, radius, space, usePalette } from "../ui/theme";

interface DraftField {
  key: number;
  name: string;
  kind: string;
  value: string;
}

/** The fields a new item of each type starts with (empty ones are left out when saved). */
export const TEMPLATES: Record<VaultItemType, { name: string; kind: string }[]> = {
  login: [
    { name: "username", kind: "text" },
    { name: "password", kind: "hidden" },
    { name: "totp", kind: "totp" },
  ],
  note: [],
  card: [
    { name: "cardholder", kind: "text" },
    { name: "number", kind: "hidden" },
    { name: "expiry", kind: "text" },
    { name: "security code", kind: "hidden" },
    { name: "pin", kind: "hidden" },
  ],
  identity: [
    { name: "full name", kind: "text" },
    { name: "email", kind: "email" },
    { name: "phone", kind: "phone" },
    { name: "address", kind: "text" },
  ],
  ssh_key: [
    { name: "private key", kind: "hidden" },
    { name: "public key", kind: "text" },
    { name: "passphrase", kind: "hidden" },
  ],
  api_key: [
    { name: "key", kind: "hidden" },
    { name: "secret", kind: "hidden" },
  ],
};

let nextKey = 1;
const draft = (f: { name: string; kind: string; value?: string }): DraftField => ({
  key: nextKey++,
  name: f.name,
  kind: f.kind,
  value: f.value ?? "",
});

const splitList = (text: string, by: RegExp) =>
  text
    .split(by)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Create or edit an item of any type: typed fields (hidden and TOTP included, with the generator
 * for a hidden one), URLs, notes, tags, a folder and the favorite flag. Saving goes through the
 * shared item rules, which refuse bad input (two fields of one name, a TOTP seed that is not
 * base32, …) with a message shown here, and keep a changed secret's old value in the history.
 */
export function ItemEditorScreen({
  id,
  initialType,
  onDone,
}: {
  /** Null for a new item. */
  id: string | null;
  initialType?: string;
  /** Called with the saved item's id, or null when cancelled. */
  onDone: (savedId: string | null) => void;
}) {
  const p = usePalette();
  const { items, kick } = useVault();
  const existing = useMemo(() => (id ? items.get(id) : null), [items, id]);
  const startType = (VAULT_ITEM_TYPES as readonly string[]).includes(initialType ?? "")
    ? (initialType as VaultItemType)
    : "login";
  const [type, setType] = useState<string>(existing?.type ?? startType);
  const [name, setName] = useState(existing?.name ?? "");
  const [fields, setFields] = useState<DraftField[]>(() =>
    existing ? existing.fields.map(draft) : TEMPLATES[startType].map(draft),
  );
  const [urls, setUrls] = useState(existing?.urls.join("\n") ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [folder, setFolder] = useState<string | null>(existing?.folder ?? null);
  const [favorite, setFavorite] = useState(existing?.favorite ?? false);
  const [error, setError] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<number | null>(null);
  const folders = useMemo(() => items.folders(), [items]);

  const changeType = (next: string) => {
    setType(next);
    // A new item that is still untouched takes the new type's template.
    if (!existing && fields.every((f) => !f.value)) {
      setFields(TEMPLATES[next as VaultItemType].map(draft));
    }
  };

  const setField = (key: number, change: Partial<DraftField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const save = () => {
    setError(null);
    // An empty field is left out (a template's unused ones; clearing a secret removes it, which
    // keeps its old value in the history).
    const kept: VaultFieldInput[] = fields
      .filter((f) => f.value !== "")
      .map((f) => ({ name: f.name, kind: f.kind, value: f.value }));
    const input = {
      type,
      name,
      fields: kept,
      urls: splitList(urls, /\n/),
      notes,
      tags: splitList(tags, /,/),
      folder,
      favorite,
    };
    try {
      const saved = existing ? items.update(existing.id, input) : items.create(input);
      kick();
      onDone(saved.id);
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (existing?.locked) {
    return (
      <Screen>
        <Header title="Can't edit" />
        <Muted>This item cannot be opened on this device.</Muted>
        <Button label="Back" onPress={() => onDone(null)} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header
        title={existing ? "Edit item" : "New item"}
        right={
          <View style={local.headerActions}>
            <Button label="Cancel" kind="ghost" onPress={() => onDone(null)} />
            <Button label="Save" kind="primary" onPress={save} />
          </View>
        }
      />
      <Choice
        label="Type"
        value={type}
        options={VAULT_ITEM_TYPES.map((t) => ({ value: t as string, label: typeLabel(t) }))}
        onChange={changeType}
      />
      <Field label="Name" value={name} onChangeText={setName} placeholder="GitHub" />

      <SectionTitle>Fields</SectionTitle>
      {fields.length === 0 ? <Muted>No fields yet.</Muted> : null}
      {fields.map((f) => (
        <View
          key={f.key}
          style={[local.fieldCard, { borderColor: p.border, backgroundColor: p.surface }]}
        >
          <View style={local.fieldHead}>
            <TextInput
              accessibilityLabel="Field name"
              value={f.name}
              onChangeText={(t) => setField(f.key, { name: t })}
              placeholder="Field name"
              placeholderTextColor={p.muted}
              autoCapitalize="none"
              style={[local.fieldName, { color: p.text, borderColor: p.border }]}
            />
            <Button
              kind="ghost"
              label="Remove"
              accessibilityLabel={`Remove field ${f.name || "without a name"}`}
              onPress={() => setFields((fs) => fs.filter((x) => x.key !== f.key))}
            />
          </View>
          <View style={ui.row}>
            {VAULT_FIELD_KINDS.map((k) => (
              <Pressable
                key={k}
                accessibilityRole="radio"
                accessibilityState={{ checked: f.kind === k }}
                accessibilityLabel={`${f.name || "Field"} kind ${KIND_LABELS[k]}`}
                onPress={() => setField(f.key, { kind: k })}
                style={[
                  local.kind,
                  {
                    borderColor: f.kind === k ? p.accent : p.border,
                    backgroundColor: f.kind === k ? p.accentSoft : "transparent",
                  },
                ]}
              >
                <Text style={[ui.small, { color: p.text }]}>{KIND_LABELS[k]}</Text>
              </Pressable>
            ))}
          </View>
          <SecretInput
            label={f.name ? `${f.name} value` : "Value"}
            kind={f.kind}
            value={f.value}
            onChange={(value) => setField(f.key, { value })}
          />
          {f.kind === "hidden" ? (
            generatingFor === f.key ? (
              <View style={local.generator}>
                <GeneratorPanel
                  onUse={(value) => {
                    setField(f.key, { value });
                    setGeneratingFor(null);
                  }}
                />
                <Button
                  label="Close the generator"
                  kind="ghost"
                  onPress={() => setGeneratingFor(null)}
                />
              </View>
            ) : (
              <Button
                kind="ghost"
                label="Generate"
                accessibilityLabel={`Generate ${f.name || "a value"}`}
                onPress={() => setGeneratingFor(f.key)}
                style={local.start}
              />
            )
          ) : null}
          {f.kind === "totp" ? (
            <Muted>An otpauth:// link or the base32 secret from the site's QR code setup.</Muted>
          ) : null}
        </View>
      ))}
      <Button
        label="Add a field"
        onPress={() => setFields((fs) => [...fs, draft({ name: "", kind: "text" })])}
        style={local.start}
      />

      <SectionTitle>More</SectionTitle>
      <Field
        label="Websites (one per line)"
        value={urls}
        onChangeText={setUrls}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Field
        label="Tags (comma-separated)"
        value={tags}
        onChangeText={setTags}
        autoCapitalize="none"
      />
      <Choice
        label="Folder"
        value={folder ?? ""}
        options={[
          { value: "", label: "None" },
          ...folders.map((f) => ({ value: f.id, label: f.name })),
        ]}
        onChange={(v) => setFolder(v || null)}
      />
      <Toggle label="Favorite" value={favorite} onChange={setFavorite} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={local.footer}>
        <Button kind="primary" label="Save" onPress={save} />
      </View>
    </Screen>
  );
}

/** A value input: a secret is masked (secure entry) until revealed. */
function SecretInput({
  label,
  kind,
  value,
  onChange,
}: {
  label: string;
  kind: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const p = usePalette();
  const secret = isSecretKind(kind);
  const [revealed, setRevealed] = useState(false);
  const masked = secret && !revealed;
  return (
    <View style={local.valueRow}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={masked}
        multiline={!masked && kind === "text"}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        keyboardType={
          kind === "email"
            ? "email-address"
            : kind === "url"
              ? "url"
              : kind === "phone"
                ? "phone-pad"
                : "default"
        }
        style={[
          local.value,
          { color: p.text, borderColor: p.border, backgroundColor: p.background },
          secret && local.mono,
        ]}
      />
      {secret ? (
        <Button
          kind="ghost"
          label={revealed ? "Hide" : "Reveal"}
          accessibilityLabel={`${revealed ? "Hide" : "Reveal"} ${label}`}
          onPress={() => setRevealed((r) => !r)}
        />
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: space.xs },
  fieldCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.sm,
  },
  fieldHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  fieldName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    borderBottomWidth: 1,
    paddingVertical: space.xs,
  },
  kind: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  valueRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  value: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
  },
  mono: { fontFamily: MONO },
  generator: { marginTop: space.sm },
  start: { alignSelf: "flex-start" },
  footer: { marginTop: space.lg, alignItems: "flex-start" },
});
