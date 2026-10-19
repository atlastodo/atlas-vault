/**
 * Atlas Vault and the `atlas vault` CLI against a real server: an item the CLI adds shows up in
 * the app's store field for field and one the app writes shows up in the CLI, both ways, with
 * edits, secret history and the trash; `atlas vault get X --field password` prints exactly what
 * the app stored; and a read-only token made the way the app makes it (`createVaultToken`) is
 * refused writes by the server itself, not only by the CLI. The app side is this package's own
 * code (sign-up, enabling the vault, vault tokens, the sync engine), as the app runs it.
 *
 * Run by scripts/e2e-cli.sh (`e2e:cli`), which starts a server offering the vault
 * (ATLAS_APPS=todo,vault) and points ATLAS_E2E_URL and ATLAS_CLI at it and the CLI binary.
 * Skipped without them.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  ApiClient,
  ApiError,
  MemoryPersistence,
  apiErrorCode,
  buildSignupRoot,
  deriveApiTokenKeys,
  deriveAuthAndMekAsync,
  deriveRecoveryKeys,
  generateApiToken,
  generateDek,
  generateRecoveryPhrase,
  generateSalt,
  generateSigningKeypair,
  generateUserKeypair,
  kdfForNewCredential,
  parseApiToken,
  wrapAppKeysForApiToken,
  wrapKey,
  wrapSigningKey,
} from "@atlastodo/client-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DAY_MS,
  VaultEngine,
  createVaultApiClient,
  createVaultToken,
  listVaultTokens,
  lockedSession,
  signIn,
  signUp,
  unlock,
  type ItemView,
  type VaultItem,
  type VaultKeys,
  type VaultSession,
} from "../src";

const URL_ = process.env.ATLAS_E2E_URL;
const CLI = process.env.ATLAS_CLI;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** `atlas …` with `token`, optionally feeding `stdin`. */
function cli(token: string, args: string[], stdin?: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = execFile(
      CLI!,
      args,
      { env: { ...process.env, ATLAS_URL: URL_, ATLAS_TOKEN: token, ATLAS_TZ: "UTC" } },
      (err, stdout, stderr) =>
        resolve({
          code: err ? Number((err as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    );
    child.stdin?.end(stdin ?? "");
  });
}

/** `atlas …` that must succeed; resolves its parsed JSON output. */
async function atlas(token: string, args: string[], stdin?: string): Promise<unknown> {
  const run = await cli(token, args, stdin);
  if (run.code !== 0) throw new Error(`atlas ${args.join(" ")} failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

/** An app engine; the e2e engines keep their log in memory (the sealed disk store has its own tests). */
function engineFor(api: ApiClient, keys: VaultKeys, deviceId: string, userId = "e2e"): VaultEngine {
  return new VaultEngine({ api, persistence: new MemoryPersistence(), userId, deviceId, keys });
}

/** An app item as the CLI prints it: without `locked`, with its folder's name. */
function asCli(engine: VaultEngine, item: ItemView): VaultItem & { folder_name: string | null } {
  const { locked: _locked, ...rest } = item;
  return { ...rest, folder_name: engine.items.folderName(item.folder) };
}

describe.skipIf(!URL_ || !CLI)("Atlas Vault and the atlas CLI", () => {
  const email = `vault-e2e-${randomUUID()}@example.com`;
  const password = "correct horse battery staple vault";
  let api: ApiClient;
  let session: VaultSession;
  let keys: VaultKeys;
  let rw: string;
  let ro: string;
  let app: VaultEngine;

  beforeAll(async () => {
    api = createVaultApiClient({ baseUrl: URL_! });
    const signed = await signUp(api, { email, password, displayName: "E2E" });
    session = signed.session;
    keys = signed.keys;
    expect(signed.recoveryPhrase.split(" ")).toHaveLength(24);
    // The vault key is a row under the root, beside todo's; the session keeps only the vault's.
    expect(session.appKeys?.map((k) => k.app).sort()).toEqual(["todo", "vault"]);
    expect(session.dek).toBeUndefined();
    const expiresAt = Date.now() + 30 * DAY_MS;
    const base = { userId: session.user.id, keys, expiresAt };
    ({ token: rw } = await createVaultToken(api, { ...base, name: "e2e writer", write: true }));
    ({ token: ro } = await createVaultToken(api, { ...base, name: "e2e reader" }));
    const listed = await listVaultTokens(api);
    expect(listed.map((t) => [t.name, t.apps, t.write]).sort()).toEqual([
      ["e2e reader", ["vault"], false],
      ["e2e writer", ["vault"], true],
    ]);
    for (const t of listed) expect(t.expires_at).toBe(expiresAt);
    app = engineFor(api, keys, randomUUID());
    await app.start();
  });

  it("shows an item the CLI adds in the app, field for field", async () => {
    await atlas(rw, ["vault", "folders", "add", "CI"]);
    const input = {
      name: "Deploy key",
      type: "api_key",
      fields: [
        { name: "username", value: "deployer" },
        { name: "token", kind: "hidden", value: "sk_live_from_the_cli" },
        { name: "2fa", kind: "totp", value: "jbsw y3dp ehpk 3pxp" },
      ],
      urls: ["https://ci.example.com"],
      notes: "Rotate yearly.",
      tags: ["prod"],
      folder: "CI",
    };
    // The secret goes over stdin, never argv.
    const added = (await atlas(rw, ["vault", "add", "--json", "-"], JSON.stringify(input))) as {
      id: string;
    };
    await app.syncNow();
    const full = await atlas(ro, ["vault", "get", added.id]);
    const mine = app.items.get(added.id)!;
    expect(mine.locked).toBe(false);
    expect(asCli(app, mine)).toEqual(full);
    expect(mine.fields.find((f) => f.name === "2fa")?.value).toBe("JBSWY3DPEHPK3PXP");
    expect(app.items.list({ folder: mine.folder!, tag: "PROD" }).map((i) => i.id)).toEqual([
      added.id,
    ]);
  });

  it("gives the CLI exactly the password the app stored", async () => {
    // Spaces, quotes and unicode survive as stored (a hidden field is never trimmed).
    const secret = ` p@ss "wörd" ${randomUUID()} `;
    const made = app.items.create({
      name: "Mail server",
      fields: [
        { name: "username", value: "postmaster" },
        { name: "password", kind: "hidden", value: secret },
      ],
      urls: ["smtp://mail.example.com"],
      favorite: true,
    });
    await app.syncNow();
    expect(app.pendingCount()).toBe(0);
    const run = await cli(ro, ["vault", "get", "Mail server", "--field", "password"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`${secret}\n`);
    expect(await atlas(ro, ["vault", "get", made.id])).toEqual(asCli(app, made));
  });

  it("shows the app's edits, secret history and trash in the CLI", async () => {
    const [mail] = app.items.list({ search: "mail server" });
    const edited = app.items.update(mail!.id, {
      set_fields: [{ name: "password", value: "rotated-by-the-app" }],
      tags: ["mail"],
    });
    expect(edited.history.map((h) => h.field)).toEqual(["password"]);
    const doomed = app.items.create({ name: "To the trash", type: "note", notes: "bye" });
    app.items.trash(doomed.id);
    await app.syncNow();

    const listed = (await atlas(ro, ["vault", "list"])) as { id: string; name: string }[];
    expect(listed.map((i) => i.name)).toEqual(["Deploy key", "Mail server"]);
    // `list` never prints secret values.
    expect(JSON.stringify(listed)).not.toContain("rotated-by-the-app");
    expect(await atlas(ro, ["vault", "get", mail!.id])).toEqual(asCli(app, edited));
    const trashed = (await atlas(ro, ["vault", "get", doomed.id])) as VaultItem;
    expect(trashed.deleted_at).toBe(app.items.get(doomed.id)!.deleted_at);
  });

  it("brings the CLI's edits and deletes back to the app", async () => {
    const patch = {
      set_fields: [{ name: "token", value: "sk_live_rotated_by_cli" }],
      favorite: true,
    };
    await atlas(rw, ["vault", "update", "Deploy key", "--json", "-"], JSON.stringify(patch));
    await atlas(rw, ["vault", "delete", "Mail server"]);
    await app.syncNow();
    const [deploy] = app.items.list({ favorites: true });
    expect(deploy?.name).toBe("Deploy key");
    expect(deploy!.fields.find((f) => f.name === "token")?.value).toBe("sk_live_rotated_by_cli");
    expect(deploy!.history[0]).toMatchObject({ field: "token", value: "sk_live_from_the_cli" });
    const mail = app.items.trashed().find((i) => i.name === "Mail server")!;
    expect(mail.deleted_at).not.toBeNull();

    app.items.restore(mail.id);
    await app.syncNow();
    const back = (await atlas(ro, ["vault", "list", "--search", "mail"])) as { id: string }[];
    expect(back.map((i) => i.id)).toEqual([mail.id]);
  });

  it("refuses writes on a read-only token at the server, not only in the CLI", async () => {
    // The CLI checks the session's `write` and refuses before sending anything.
    const refused = await cli(ro, ["vault", "add", "--name", "Nope"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("api_token_read_only");

    // The server refuses the push itself: a session of the same token, a raw push.
    const parts = parseApiToken(ro);
    const raw = new ApiClient({ baseUrl: URL_!, apps: ["vault"] });
    const tokenSession = await raw.openApiTokenSession(parts.id, deriveApiTokenKeys(parts).auth);
    expect(tokenSession).toMatchObject({ apps: ["vault"], write: false });
    const headers = {
      authorization: `Bearer ${tokenSession.access_token}`,
      "x-atlas-sync-apps": "vault",
      "x-atlas-sync-protocol": "6",
    };
    const res = await fetch(`${URL_}/sync/push`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ operations: [] }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "api_token_read_only" });
    // It still reads.
    const pull = await fetch(`${URL_}/sync/pull?since=0`, { headers });
    expect(pull.status).toBe(200);
    await app.syncNow();
    expect(app.items.list().some((i) => i.name === "Nope")).toBe(false);
  });

  it("surfaces the server's token policy errors", async () => {
    const attempt = async (extra: Record<string, unknown>) => {
      const parts = generateApiToken();
      try {
        await api.createApiToken({
          id: parts.id,
          name: "policy",
          auth: deriveApiTokenKeys(parts).auth,
          apps: ["vault"],
          app_keys: {
            vault: wrapAppKeysForApiToken(parts, session.user.id, "vault", {
              appKey: keys.appKey,
              privateKey: keys.privateKey,
            }),
          },
          ...extra,
        });
        return "created";
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        return apiErrorCode(err as ApiError);
      }
    };
    expect(await attempt({})).toBe("api_token_expiry_required");
    expect(await attempt({ expires_at: Date.now() - 1000 })).toBe("api_token_expiry_in_past");
    expect(await attempt({ expires_at: Date.now() + 400 * DAY_MS })).toBe(
      "api_token_expiry_too_far",
    );
  });

  it("opens the same vault on another device by password, and unlocks offline", async () => {
    const other = createVaultApiClient({ baseUrl: URL_! });
    const signed = await signIn(other, email, password, { deviceName: "Atlas Vault e2e" });
    expect(signed.keys.appKey).toEqual(keys.appKey);
    const device = engineFor(other, signed.keys, randomUUID());
    await device.start();
    await device.syncNow();
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect(device.items.all().sort(byId)).toEqual(app.items.all().sort(byId));
    await device.stop();

    const unlocked = await unlock(other, lockedSession(signed.session), password);
    expect(unlocked.keys.appKey).toEqual(keys.appKey);
    await expect(unlock(other, lockedSession(signed.session), "wrong password")).rejects.toThrow(
      "does not open",
    );
  });
});

/**
 * An Atlas Todo account (signed up as the todo app does: a root key with the todo key only, the
 * vault not enabled) gets its vault on its first sign-in to Atlas Vault.
 */
async function signUpAsTodo(baseUrl: string, email: string, password: string): Promise<void> {
  const api = new ApiClient({ baseUrl });
  const kdf = kdfForNewCredential(await api.getSalt(email));
  const salt = generateSalt();
  const { authHash, mek } = await deriveAuthAndMekAsync(password, salt, kdf);
  const dek = generateDek();
  const keypair = generateUserKeypair();
  const phrase = generateRecoveryPhrase();
  const recovery = deriveRecoveryKeys(phrase, salt);
  const signing = generateSigningKeypair();
  await api.signup({
    email,
    password: authHash,
    salt,
    kdf,
    publicKey: keypair.publicKey,
    recoveryPublicKey: recovery.auth.publicKey,
    encryptedDek: wrapKey(dek, mek),
    encryptedPrivateKey: wrapKey(keypair.secretKey, mek),
    recoveryEncryptedDek: wrapKey(dek, recovery.wrapKey),
    recoveryEncryptedPrivateKey: wrapKey(keypair.secretKey, recovery.wrapKey),
    signingPublicKey: signing.publicKey,
    encryptedSigningKey: wrapSigningKey(signing.secretKey, dek),
    root: buildSignupRoot({
      mek,
      recoveryWrapKey: recovery.wrapKey,
      dek,
      privateKey: keypair.secretKey,
    }),
  });
}

describe.skipIf(!URL_ || !CLI)("an Atlas Todo account opening Atlas Vault", () => {
  it("enables the vault with its own key on the first sign-in", async () => {
    const email = `todo-first-${randomUUID()}@example.com`;
    const password = "an account made by atlas todo";
    await signUpAsTodo(URL_!, email, password);

    const api = createVaultApiClient({ baseUrl: URL_! });
    const first = await signIn(api, email, password);
    const apps = await api.listAccountApps();
    expect(apps.find((a) => a.id === "vault")?.enabled).toBe(true);
    expect(first.session.appKeys?.map((k) => k.app).sort()).toEqual(["todo", "vault"]);

    // A second sign-in opens the same key rather than making another.
    const again = await signIn(createVaultApiClient({ baseUrl: URL_! }), email, password);
    expect(again.keys.appKey).toEqual(first.keys.appKey);

    const engine = engineFor(api, first.keys, randomUUID());
    await engine.start();
    engine.items.create({ name: "First vault item" });
    await engine.syncNow();
    const { token } = await createVaultToken(api, {
      userId: first.session.user.id,
      keys: first.keys,
      name: "todo-first",
      expiresAt: Date.now() + DAY_MS,
    });
    const listed = (await atlas(token, ["vault", "list"])) as { name: string }[];
    expect(listed.map((e) => e.name)).toEqual(["First vault item"]);
    await engine.stop();
  });
});
