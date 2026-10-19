import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  itemSubtitle,
  VAULT_ITEM_TYPES,
  type ItemView,
  type VaultQuery,
} from "@atlastodo/vault-core";
import { useVault } from "../data/VaultProvider";
import { Button, Chip, Header, Muted, Screen, styles as ui } from "../ui/components";
import { typeLabel } from "../ui/format";
import { radius, space, usePalette } from "../ui/theme";
import { SyncLine } from "./SyncLine";

type Scope =
  { kind: "all" } | { kind: "favorites" } | { kind: "folder"; id: string } | { kind: "none" };

/**
 * The vault: items outside the trash by name, narrowed by a folder (or favorites), a type, a tag
 * and a search over names, URLs, tags and non-secret field values (never a secret).
 */
export function ItemsScreen({
  onOpen,
  onNew,
  onSettings,
  onGenerator,
  onLock,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onGenerator: () => void;
  onLock: () => void;
}) {
  const p = usePalette();
  const { items, version, loaded, notice } = useVault();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [type, setType] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const { folders, tags, total } = useMemo(
    () => ({ folders: items.folders(), tags: items.tags(), total: items.list().length }),
    // `version` bumps on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, version],
  );
  const shown = useMemo(() => {
    const query: VaultQuery = { search, type: type ?? undefined, tag: tag ?? undefined };
    if (scope.kind === "favorites") query.favorites = true;
    if (scope.kind === "folder") query.folder = scope.id;
    if (scope.kind === "none") query.folder = "none";
    return items.list(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, version, search, scope, type, tag]);

  const scopeChip = (label: string, s: Scope) => (
    <Chip
      key={label}
      label={label}
      selected={JSON.stringify(s) === JSON.stringify(scope)}
      onPress={() => setScope(s)}
      accessibilityLabel={`Show ${label}`}
    />
  );

  return (
    <Screen>
      <Header
        title="Vault"
        right={
          <View style={local.headerActions}>
            <Button label="Lock" kind="ghost" onPress={onLock} />
            <Button label="Generator" kind="ghost" onPress={onGenerator} />
            <Button label="Settings" kind="ghost" onPress={onSettings} />
            <Button label="New item" kind="primary" onPress={onNew} />
          </View>
        }
      />
      <SyncLine />
      {notice ? <Muted>{notice}</Muted> : null}
      <TextInput
        accessibilityLabel="Search the vault"
        placeholder="Search names, sites, usernames, tags"
        placeholderTextColor={p.muted}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          ui.input,
          { color: p.text, backgroundColor: p.surface, borderColor: p.border, marginTop: space.md },
        ]}
      />
      <View style={[ui.row, local.filters]}>
        {scopeChip("All", { kind: "all" })}
        {scopeChip("Favorites", { kind: "favorites" })}
        {folders.map((f) => scopeChip(f.name, { kind: "folder", id: f.id }))}
        {folders.length > 0 ? scopeChip("No folder", { kind: "none" }) : null}
      </View>
      <View style={[ui.row, local.filters]}>
        {VAULT_ITEM_TYPES.map((t) => (
          <Chip
            key={t}
            label={typeLabel(t)}
            selected={type === t}
            onPress={() => setType(type === t ? null : t)}
            accessibilityLabel={`Filter by type ${typeLabel(t)}`}
          />
        ))}
        {tags.map((t) => (
          <Chip
            key={`#${t}`}
            label={`#${t}`}
            selected={tag?.toLowerCase() === t.toLowerCase()}
            onPress={() => setTag(tag?.toLowerCase() === t.toLowerCase() ? null : t)}
            accessibilityLabel={`Filter by tag ${t}`}
          />
        ))}
      </View>
      <FlatList
        style={ui.fill}
        data={shown}
        keyExtractor={(i) => i.id}
        contentContainerStyle={local.list}
        renderItem={({ item }) => <ItemCard item={item} onPress={() => onOpen(item.id)} />}
        ListEmptyComponent={
          <View style={local.empty}>
            {!loaded ? (
              <Muted>Opening your vault…</Muted>
            ) : total === 0 ? (
              <>
                <Text style={[local.emptyTitle, { color: p.text }]}>Your vault is empty</Text>
                <Muted>
                  Add a login, card, note or key. Items are encrypted on this device before they
                  reach your Atlas server; it sees no name, site or secret.
                </Muted>
                <Button kind="primary" label="Add the first item" onPress={onNew} />
              </>
            ) : (
              <Muted>No items match.</Muted>
            )}
          </View>
        }
      />
    </Screen>
  );
}

function ItemCard({ item, onPress }: { item: ItemView; onPress: () => void }) {
  const p = usePalette();
  const sub = itemSubtitle(item);
  const name = item.name || (item.locked ? "Locked item" : "Unnamed");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      onPress={onPress}
      style={({ pressed }) => [
        local.card,
        { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={local.titleRow}>
        <Text style={[local.cardTitle, { color: p.text }]} numberOfLines={1}>
          {item.favorite ? "★ " : ""}
          {name}
        </Text>
        <Text style={[ui.small, { color: p.muted }]}>{typeLabel(item.type)}</Text>
      </View>
      {sub ? (
        <Text style={[ui.small, { color: p.muted }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
      {item.tags.length > 0 ? (
        <Text style={[ui.small, { color: p.accent }]} numberOfLines={1}>
          {item.tags.map((t) => `#${t}`).join("  ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

const local = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    justifyContent: "flex-end",
  },
  filters: { marginTop: space.sm },
  list: { paddingTop: space.md, paddingBottom: space.xxl * 2 },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
    gap: 2,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: "600" },
  empty: { alignItems: "flex-start", gap: space.md, paddingTop: space.xxl },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
});
