import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { VAULT_HISTORY_PER_FIELD } from "@atlastodo/vault-core";
import { useVault } from "../data/VaultProvider";
import { Button, Card, Header, Muted, Screen, SectionTitle } from "../ui/components";
import { FieldRow } from "../ui/fields";
import { formatTime } from "../ui/format";
import { space, usePalette } from "../ui/theme";

/**
 * Earlier values of an item's secret fields, newest first and grouped by field: kept by the shared
 * rules when a hidden or TOTP field changes or goes (at most five per field), masked until revealed.
 */
export function HistoryScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const p = usePalette();
  const { items, version } = useVault();
  const item = useMemo(
    () => items.get(id),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [items, version, id],
  );
  const groups = useMemo(() => {
    const out = new Map<string, { value: string; changed_at: number }[]>();
    for (const h of item?.history ?? []) {
      const key = h.field;
      out.set(key, [...(out.get(key) ?? []), { value: h.value, changed_at: h.changed_at }]);
    }
    return [...out.entries()];
  }, [item]);

  return (
    <Screen scroll>
      <Header
        title="Secret history"
        subtitle={item?.name}
        right={<Button label="Back" kind="ghost" onPress={onBack} />}
      />
      <Muted>
        When a hidden or TOTP field changes or is removed, its old value is kept here (the last{" "}
        {VAULT_HISTORY_PER_FIELD} per field), encrypted like the rest of the item.
      </Muted>
      {groups.length === 0 ? <Muted>No earlier values yet.</Muted> : null}
      {groups.map(([field, entries]) => (
        <View key={field}>
          <SectionTitle>{field}</SectionTitle>
          <Card>
            {entries.map((e, i) => (
              <View key={`${e.changed_at}-${i}`}>
                <Text style={[local.when, { color: p.muted }]}>
                  Replaced {formatTime(e.changed_at)}
                </Text>
                <FieldRow name={field} kind="hidden" value={e.value} />
              </View>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const local = StyleSheet.create({ when: { fontSize: 12, marginTop: space.sm } });
