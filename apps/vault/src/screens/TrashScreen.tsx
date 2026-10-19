import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useVault } from "../data/VaultProvider";
import { Button, Header, Muted, Screen, confirm, styles as ui } from "../ui/components";
import { formatTime, typeLabel } from "../ui/format";
import { space, usePalette } from "../ui/theme";

/** Items moved to the trash (here, on another device or by the CLI): Restore or delete for good. */
export function TrashScreen({ onBack }: { onBack: () => void }) {
  const p = usePalette();
  const { items, version, kick } = useVault();
  const trashed = useMemo(
    () => items.trashed(),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [items, version],
  );
  const purge = async (id: string, name: string) => {
    const ok = await confirm(
      `Delete “${name}” for good?`,
      "It is removed from every device, its secret history too. This cannot be undone.",
      "Delete for good",
    );
    if (!ok) return;
    items.purge(id);
    kick();
  };
  return (
    <Screen>
      <Header title="Trash" right={<Button label="Back" kind="ghost" onPress={onBack} />} />
      <Muted>Items in the trash stay encrypted and synced until you restore or delete them.</Muted>
      <FlatList
        style={[ui.fill, local.list]}
        data={trashed}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={[ui.card, local.row, { backgroundColor: p.surface, borderColor: p.border }]}>
            <View style={ui.fill}>
              <Text style={[local.title, { color: p.text }]} numberOfLines={1}>
                {item.name || "Locked item"}
              </Text>
              <Text style={[ui.small, { color: p.muted }]}>
                {typeLabel(item.type)} · trashed {formatTime(item.deleted_at ?? 0)}
              </Text>
            </View>
            <Button
              label="Restore"
              accessibilityLabel={`Restore ${item.name}`}
              onPress={() => {
                items.restore(item.id);
                kick();
              }}
            />
            <Button
              kind="danger"
              label="Delete"
              accessibilityLabel={`Delete ${item.name} for good`}
              onPress={() => void purge(item.id, item.name)}
            />
          </View>
        )}
        ListEmptyComponent={<Muted>The trash is empty.</Muted>}
      />
    </Screen>
  );
}

const local = StyleSheet.create({
  list: { marginTop: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { fontSize: 16, fontWeight: "600" },
});
