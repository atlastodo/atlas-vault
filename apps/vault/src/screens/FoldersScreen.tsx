import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useVault } from "../data/VaultProvider";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Header,
  Muted,
  Screen,
  confirm,
  styles as ui,
} from "../ui/components";
import { describeError } from "../ui/errors";
import { space, usePalette } from "../ui/theme";

/** The vault's folders: add, rename, delete (its items move out of it first). */
export function FoldersScreen({ onBack }: { onBack: () => void }) {
  const p = usePalette();
  const { items, version, kick } = useVault();
  const folders = useMemo(
    () => items.folders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, version],
  );
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => void) => {
    setError(null);
    try {
      fn();
      kick();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    }
  };

  const remove = async (id: string, folderName: string) => {
    const count = items.all().filter((i) => i.folder === id).length;
    const ok = await confirm(
      `Delete the folder “${folderName}”?`,
      count ? `Its ${count} item(s) stay in your vault, in no folder.` : "It holds no items.",
      "Delete folder",
    );
    if (ok) run(() => items.deleteFolder(id));
  };

  return (
    <Screen scroll>
      <Header title="Folders" right={<Button label="Back" kind="ghost" onPress={onBack} />} />
      <Card>
        {folders.length === 0 ? <Muted>No folders yet.</Muted> : null}
        {folders.map((f) =>
          editing?.id === f.id ? (
            <View key={f.id} style={[local.row, { borderTopColor: p.border }]}>
              <View style={ui.fill}>
                <Field
                  label="Folder name"
                  value={editing.name}
                  onChangeText={(t) => setEditing({ id: f.id, name: t })}
                />
              </View>
              <Button
                kind="primary"
                label="Save"
                onPress={() => {
                  if (run(() => items.renameFolder(f.id, editing.name))) setEditing(null);
                }}
              />
              <Button kind="ghost" label="Cancel" onPress={() => setEditing(null)} />
            </View>
          ) : (
            <View key={f.id} style={[local.row, { borderTopColor: p.border }]}>
              <View style={ui.fill}>
                <Muted>{f.name}</Muted>
              </View>
              <Button
                kind="ghost"
                label="Rename"
                accessibilityLabel={`Rename ${f.name}`}
                onPress={() => setEditing({ id: f.id, name: f.name })}
              />
              <Button
                kind="danger"
                label="Delete"
                accessibilityLabel={`Delete folder ${f.name}`}
                onPress={() => void remove(f.id, f.name)}
              />
            </View>
          ),
        )}
      </Card>
      <View style={local.form}>
        <Field label="New folder" value={name} onChangeText={setName} placeholder="CI" />
        <Button
          label="Add folder"
          onPress={() => {
            if (run(() => items.createFolder(name))) setName("");
          }}
          style={local.start}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    </Screen>
  );
}

const local = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderTopWidth: 1,
    paddingVertical: space.sm,
  },
  form: { marginTop: space.lg },
  start: { alignSelf: "flex-start" },
});
