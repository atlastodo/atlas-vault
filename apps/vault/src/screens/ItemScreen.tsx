import { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { isSecretKind } from "@atlastodo/vault-core";
import { useVault } from "../data/VaultProvider";
import {
  Body,
  Button,
  Card,
  Header,
  Muted,
  Screen,
  SectionTitle,
  confirm,
  styles as ui,
} from "../ui/components";
import { CopyButton, FieldRow } from "../ui/fields";
import { formatTime, typeLabel } from "../ui/format";
import { space, usePalette } from "../ui/theme";

/** One item: its fields (secrets masked until revealed, TOTP as a live code), URLs and notes. */
export function ItemScreen({
  id,
  onBack,
  onEdit,
  onHistory,
}: {
  id: string;
  onBack: () => void;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const p = usePalette();
  const { items, version, kick } = useVault();
  const item = useMemo(
    () => items.get(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, version, id],
  );

  if (!item) {
    return (
      <Screen>
        <Header title="Not found" right={<Button label="Back" kind="ghost" onPress={onBack} />} />
        <Muted>This item is not in your vault (it may have been deleted for good).</Muted>
      </Screen>
    );
  }

  const folder = items.folderName(item.folder);
  const secrets = item.fields.filter((f) => isSecretKind(f.kind)).length;
  const trashed = item.deleted_at !== null;

  const toggleFavorite = () => {
    items.update(item.id, { favorite: !item.favorite });
    kick();
  };
  const trash = async () => {
    if (
      await confirm(
        `Move “${item.name}” to the trash?`,
        "You can restore it from the trash.",
        "Move to trash",
      )
    ) {
      items.trash(item.id);
      kick();
      onBack();
    }
  };

  return (
    <Screen scroll>
      <Header
        title={item.name || "Locked item"}
        subtitle={[typeLabel(item.type), folder].filter(Boolean).join(" · ")}
        right={<Button label="Back" kind="ghost" onPress={onBack} />}
      />
      {item.locked ? (
        <Muted>
          Part of this item is encrypted under a key this device does not have, so it cannot be
          shown or edited here.
        </Muted>
      ) : null}
      {trashed ? <Muted>In the trash since {formatTime(item.deleted_at!)}.</Muted> : null}

      {!item.locked && !trashed ? (
        <View style={[ui.row, local.actions]}>
          <Button kind="primary" label="Edit" onPress={onEdit} />
          <Button
            label={item.favorite ? "★ Favorite" : "☆ Add to favorites"}
            accessibilityLabel={item.favorite ? "Remove from favorites" : "Add to favorites"}
            onPress={toggleFavorite}
          />
          {secrets > 0 || item.history.length > 0 ? (
            <Button
              label={`History (${item.history.length})`}
              accessibilityLabel="Secret history"
              onPress={onHistory}
            />
          ) : null}
        </View>
      ) : null}

      {item.fields.length > 0 ? (
        <>
          <SectionTitle>Fields</SectionTitle>
          <Card>
            {item.fields.map((f) => (
              <FieldRow key={f.name} name={f.name} kind={f.kind} value={f.value} />
            ))}
          </Card>
        </>
      ) : null}

      {item.urls.length > 0 ? (
        <>
          <SectionTitle>Websites</SectionTitle>
          <Card>
            {item.urls.map((u) => (
              <View key={u} style={[local.urlRow, { borderTopColor: p.border }]}>
                <Text selectable style={[ui.body, ui.fill, { color: p.text }]} numberOfLines={1}>
                  {u}
                </Text>
                {/^https?:\/\//i.test(u) ? (
                  <Button
                    kind="ghost"
                    label="Open"
                    accessibilityLabel={`Open ${u}`}
                    onPress={() => void Linking.openURL(u).catch(() => {})}
                  />
                ) : null}
                <CopyButton value={u} secret={false} label={u} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {item.notes ? (
        <>
          <SectionTitle>Notes</SectionTitle>
          <Card>
            <Body selectable>{item.notes}</Body>
          </Card>
        </>
      ) : null}

      {item.tags.length > 0 ? (
        <>
          <SectionTitle>Tags</SectionTitle>
          <Body>{item.tags.map((t) => `#${t}`).join("  ")}</Body>
        </>
      ) : null}

      <SectionTitle>Details</SectionTitle>
      <Muted>Created {formatTime(item.created_at)}</Muted>
      <Muted>Changed {formatTime(item.updated_at)}</Muted>

      {!trashed && !item.locked ? (
        <View style={local.danger}>
          <Button kind="danger" label="Move to trash" onPress={() => void trash()} />
        </View>
      ) : null}
    </Screen>
  );
}

const local = StyleSheet.create({
  actions: { marginBottom: space.sm },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderTopWidth: 1,
    paddingVertical: space.xs,
  },
  danger: { marginTop: space.xxl, alignItems: "flex-start" },
});
