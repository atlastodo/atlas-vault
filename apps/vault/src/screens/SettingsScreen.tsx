import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import type { ApiTokenView } from "@atlastodo/client-core";
import {
  AUTO_LOCK_CHOICES,
  DAY_MS,
  VAULT_TOKEN_POLICY,
  createVaultToken,
  isTokenExpired,
  listVaultTokens,
  tokenLifetimeChoices,
} from "@atlastodo/vault-core";
import { useAuth } from "../auth/AuthContext";
import { useLock } from "../auth/AutoLockGate";
import { usePrefs } from "../data/PrefsProvider";
import { useVault } from "../data/VaultProvider";
import { CLIPBOARD_CHOICES } from "../lib/prefs";
import {
  Body,
  Button,
  Card,
  Choice,
  ErrorText,
  Field,
  Header,
  Muted,
  Screen,
  SectionTitle,
  Toggle,
  confirm,
  styles as ui,
} from "../ui/components";
import { describeError } from "../ui/errors";
import { CopyButton } from "../ui/fields";
import { formatDate, formatTime } from "../ui/format";
import { MONO, space, usePalette } from "../ui/theme";
import { syncSummary } from "./SyncLine";

const REPO_URL = process.env.EXPO_PUBLIC_REPO_URL || "https://github.com/atlastodo/atlas-vault";

const minutesLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

export function SettingsScreen({
  onBack,
  onTrash,
  onFolders,
}: {
  onBack: () => void;
  onTrash: () => void;
  onFolders: () => void;
}) {
  const auth = useAuth();
  const vault = useVault();
  const { lockNow } = useLock();
  const { prefs, setPrefs } = usePrefs();
  const p = usePalette();

  const signOut = async () => {
    const message =
      vault.pending > 0
        ? `${vault.pending} change(s) have not reached the server yet and will be lost.`
        : "Your vault stays on the server; this device forgets the session.";
    if (await confirm("Sign out?", message, "Sign out")) await auth.signOut();
  };

  return (
    <Screen scroll>
      <Header title="Settings" right={<Button label="Done" kind="ghost" onPress={onBack} />} />

      <SectionTitle>Account</SectionTitle>
      <Card>
        <Body>{auth.session?.user.email}</Body>
        <Muted>Server: {auth.serverUrl}</Muted>
        <Muted>
          Your Atlas account, shared with Atlas Todo. Change the password or recovery phrase there.
        </Muted>
      </Card>

      <SectionTitle>Security on this device</SectionTitle>
      <Card>
        <Choice
          label="Lock after inactivity"
          value={prefs.autoLockMinutes}
          options={AUTO_LOCK_CHOICES.map((m) => ({ value: m as number, label: minutesLabel(m) }))}
          onChange={(autoLockMinutes) => setPrefs({ autoLockMinutes })}
        />
        <Choice
          label="Clear a copied secret after"
          value={prefs.clipboardSeconds}
          options={CLIPBOARD_CHOICES.map((s) => ({
            value: s as number,
            label: s < 60 ? `${s} s` : `${s / 60} min`,
          }))}
          onChange={(clipboardSeconds) => setPrefs({ clipboardSeconds })}
        />
        <Muted>
          Locking forgets the vault's keys and decrypted items on this device; your password opens
          it again. A web browser can clear the clipboard only while its tab has focus.
        </Muted>
        <Button label="Lock now" onPress={() => void lockNow()} style={local.cardAction} />
      </Card>

      <SectionTitle>Sync</SectionTitle>
      <Card>
        <Body>{syncSummary(vault)}</Body>
        {vault.lastSyncAt ? <Muted>Last synced {formatTime(vault.lastSyncAt)}</Muted> : null}
        {vault.lastError ? <ErrorText>{vault.lastError}</ErrorText> : null}
        <Button label="Sync now" onPress={vault.kick} style={local.cardAction} />
      </Card>

      <SectionTitle>API tokens for CI</SectionTitle>
      <ApiTokens />

      <SectionTitle>Vault</SectionTitle>
      <View style={[ui.row, local.start]}>
        <Button label="Folders" onPress={onFolders} />
        <Button label="Open the trash" onPress={onTrash} />
      </View>

      <SectionTitle>About</SectionTitle>
      <Card>
        <Body>Atlas Vault {Constants.expoConfig?.version ?? ""}</Body>
        <Muted>Free software under the GNU AGPL v3. Source: {REPO_URL}</Muted>
      </Card>

      <View style={[local.signOut, { borderTopColor: p.border }]}>
        <Button kind="danger" label="Sign out" onPress={signOut} />
      </View>
    </Screen>
  );
}

/**
 * Vault-only API tokens for CI and scripts (`atlas vault get …`, the SDK's `VaultClient`). The
 * server's policy for vault tokens: an expiry is required (at most a year), and a token reads only
 * unless writes are turned on here. A new token is shown once.
 */
function ApiTokens() {
  const { api, session, keys, serverUrl } = useAuth();
  const p = usePalette();
  const lifetimes = tokenLifetimeChoices();
  const [tokens, setTokens] = useState<ApiTokenView[] | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState<number>(lifetimes.includes(90) ? 90 : lifetimes[0]!);
  const [write, setWrite] = useState(VAULT_TOKEN_POLICY.write_by_default);
  const [created, setCreated] = useState<{ token: string; write: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await listVaultTokens(api));
    } catch (err) {
      setError(describeError(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!session || !keys) return;
    if (write) {
      const ok = await confirm(
        "Allow this token to write?",
        "It will be able to add, change and delete items in your vault. Most CI jobs only need to read.",
        "Allow writes",
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await createVaultToken(api, {
        userId: session.user.id,
        keys,
        name: name || "Atlas Vault CI",
        expiresAt: Date.now() + days * DAY_MS,
        write,
      });
      setCreated({ token: made.token, write });
      setName("");
      setWrite(VAULT_TOKEN_POLICY.write_by_default);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiTokenView) => {
    const ok = await confirm(
      `Revoke “${token.name}”?`,
      "Anything using it loses access on its next request.",
      "Revoke",
    );
    if (!ok) return;
    try {
      await api.revokeApiToken(token.id);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Card>
      <Muted>
        For CI jobs and scripts that need a secret, with the atlas command-line tool or the SDK. A
        token opens your whole vault (nothing of Atlas Todo), so keep it in your CI's secret store.
      </Muted>
      {created ? (
        <View style={[local.created, { backgroundColor: p.accentSoft }]}>
          <Body>Copy it now; it is not shown again:</Body>
          <Text selectable style={[local.mono, { color: p.text }]}>
            {created.token}
          </Text>
          <CopyButton value={created.token} secret label="the new token" />
          <Text selectable style={[local.mono, { color: p.muted }]}>
            ATLAS_URL={serverUrl} ATLAS_TOKEN=… atlas vault get "Deploy key" --field token
          </Text>
          <Muted>{created.write ? "It can read and write." : "It is read-only."}</Muted>
          <Button
            label="I have copied it"
            kind="ghost"
            onPress={() => setCreated(null)}
            style={local.start}
          />
        </View>
      ) : null}
      {tokens?.map((t) => {
        const expired = isTokenExpired(t);
        return (
          <View key={t.id} style={[local.token, { borderTopColor: p.border }]}>
            <View style={ui.fill}>
              <Body>{t.name}</Body>
              <Muted>
                {t.write ? "Read and write" : "Read-only"}
                {" · "}
                {t.expires_at
                  ? `${expired ? "expired" : "expires"} ${formatDate(t.expires_at)}`
                  : "never expires"}
              </Muted>
              <Muted>
                Made {formatTime(t.created_at)}
                {t.last_used_at ? ` · used ${formatTime(t.last_used_at)}` : " · never used"}
              </Muted>
            </View>
            <Button
              label="Revoke"
              kind="danger"
              accessibilityLabel={`Revoke ${t.name}`}
              onPress={() => void revoke(t)}
            />
          </View>
        );
      })}
      {tokens && tokens.length === 0 ? <Muted>No vault tokens yet.</Muted> : null}
      <View style={local.form}>
        <Field
          label="New token name"
          value={name}
          onChangeText={setName}
          placeholder="deploy job"
        />
        <Choice
          label="Expires after"
          value={days}
          options={lifetimes.map((d) => ({ value: d, label: d === 365 ? "1 year" : `${d} days` }))}
          onChange={setDays}
        />
        <Toggle
          label="Allow writes"
          hint="Off: the token can only read (the server refuses its writes)."
          value={write}
          onChange={setWrite}
        />
        <Button label="Create token" onPress={create} busy={busy} style={local.start} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

const local = StyleSheet.create({
  cardAction: { marginTop: space.md, alignSelf: "flex-start" },
  start: { alignSelf: "flex-start" },
  signOut: {
    marginTop: space.xxl,
    paddingTop: space.lg,
    borderTopWidth: 1,
    alignItems: "flex-start",
  },
  created: { borderRadius: 10, padding: space.md, marginVertical: space.md, gap: space.sm },
  mono: { fontFamily: MONO, fontSize: 13 },
  token: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    paddingTop: space.md,
    marginTop: space.md,
  },
  form: { marginTop: space.lg },
});
