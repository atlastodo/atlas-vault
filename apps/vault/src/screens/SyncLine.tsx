import { Text } from "react-native";
import { useVault } from "../data/VaultProvider";
import { styles as ui } from "../ui/components";
import { usePalette } from "../ui/theme";

/** One line on how the vault stands with the server. */
export function syncSummary(s: {
  status: string;
  pending: number;
  lastError: string | null;
  lastSyncAt: number | null;
}): string {
  const waiting = s.pending > 0 ? `${s.pending} change${s.pending === 1 ? "" : "s"} waiting` : "";
  if (s.status === "syncing") return "Syncing…";
  if (s.lastError || s.status === "offline") {
    return waiting
      ? `Offline · ${waiting}, saved on this device`
      : "Offline · your vault is saved on this device";
  }
  if (s.status === "throttled") return "The server asked to slow down; syncing shortly";
  if (waiting) return waiting;
  return s.lastSyncAt ? "Synced · end-to-end encrypted" : "Connecting…";
}

export function SyncLine() {
  const p = usePalette();
  const vault = useVault();
  return (
    <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>
      {syncSummary(vault)}
    </Text>
  );
}
