#!/usr/bin/env node
// The web app in a real browser against a real server, and the atlas CLI beside it
// (scripts/e2e-cli.sh runs it with E2E_WEB=1): sign up, the recovery phrase, a login with its
// password masked until revealed, search that never matches a secret, read-only and writing vault
// tokens made in Settings, the CLI reading the exact password the app stored and refused a write
// on the read-only token, an item the CLI adds appearing in the open app, the trash, a reload,
// an item written offline surviving a reload (sealed on disk) and syncing later, locking and
// unlocking, and a session past its auto-lock deadline opening locked.
//
// Environment: BASE_URL (the page; a server serving the web export as STATIC_DIR), CHROMIUM (a
// Chromium binary), ATLAS_CLI (the atlas binary), SCREENSHOT_DIR (optional, keeps screenshots).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.BASE_URL;
const CLI = process.env.ATLAS_CLI;
const SHOTS = process.env.SCREENSHOT_DIR;
if (!BASE_URL || !process.env.CHROMIUM || !CLI) {
  console.error("e2e-web: set BASE_URL, CHROMIUM and ATLAS_CLI");
  process.exit(2);
}

const email = `web-e2e-${Date.now()}@example.com`;
const password = "a long vault passphrase";
let step = 0;

function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  console.log(`  ok ${++step} - ${message}`);
}

/** `atlas …` with its exit status and both streams. */
function cli(token, ...args) {
  const r = spawnSync(CLI, args, {
    env: { ...process.env, ATLAS_URL: BASE_URL, ATLAS_TOKEN: token, ATLAS_TZ: "UTC" },
    encoding: "utf8",
  });
  if (r.status !== 0 && r.status !== 1) throw new Error(`atlas failed: ${r.stderr}`);
  return r;
}

function atlas(token, ...args) {
  const out = execFileSync(CLI, args, {
    env: { ...process.env, ATLAS_URL: BASE_URL, ATLAS_TOKEN: token, ATLAS_TZ: "UTC" },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

/** A text input by its label (role queries skip the screens the stack keeps hidden). */
function field(page, name) {
  return page.getByRole("textbox", { name, exact: true });
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.getByText("Atlas Vault", { exact: true }).waitFor();
  check(
    (await field(page, "Server").inputValue()) === BASE_URL,
    "the server defaults to the page's origin",
  );
  await shot(page, "sign-in");

  await page.getByRole("button", { name: "Create an account" }).click();
  await field(page, "Name (optional)").fill("Web E2E");
  await field(page, "Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Your recovery phrase").waitFor({ timeout: 60_000 });
  check(true, "sign-up shows the recovery phrase");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Continue to my vault" }).click();
  await page.getByText("Your vault is empty").waitFor();
  check(true, "a new vault is empty");

  // A login with a password, typed into the hidden field.
  const secret = `web-e2e ${Date.now()} "quoted" pässword`;
  await page.getByRole("button", { name: "New item" }).click();
  await field(page, "Name").fill("GitHub");
  await field(page, "username value").fill("octocat");
  await page.getByLabel("password value", { exact: true }).fill(secret);
  check(
    (await page.getByLabel("password value", { exact: true }).getAttribute("type")) === "password",
    "a hidden field is masked while typed",
  );
  await field(page, "Websites (one per line)").fill("https://github.com");
  await shot(page, "editor");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.getByLabel("password, hidden").waitFor();
  check(!(await page.getByText(secret).isVisible()), "the saved item shows its password masked");
  await page.getByRole("button", { name: "Reveal password" }).click();
  await page.getByText(secret).waitFor();
  check(true, "Reveal shows it");
  await shot(page, "item");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Open GitHub" }).waitFor();
  check(true, "the item is listed");

  await field(page, "Search the vault").fill("octocat");
  await page.getByRole("button", { name: "Open GitHub" }).waitFor();
  await field(page, "Search the vault").fill(secret.slice(0, 12));
  await page.getByText("No items match.").waitFor();
  check(true, "search finds the username and never the password");
  await field(page, "Search the vault").fill("");

  // Vault tokens from Settings: read-only by default, and one with writes turned on.
  await page.getByRole("button", { name: "Settings" }).click();
  const makeToken = async (name, write) => {
    await field(page, "New token name").fill(name);
    if (write) await page.getByLabel("Allow writes").click();
    if (write) page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Create token" }).click();
    const text = page.getByText(/^atlas_pat_/);
    await text.waitFor();
    const token = (await text.textContent()).trim();
    await page.getByRole("button", { name: "I have copied it" }).click();
    return token;
  };
  const reader = await makeToken("web reader", false);
  const writer = await makeToken("web writer", true);
  check(reader.startsWith("atlas_pat_") && writer !== reader, "Settings makes vault tokens");
  await page.getByText("Read-only · expires", { exact: false }).first().waitFor();
  await page.getByText("Read and write · expires", { exact: false }).first().waitFor();
  check(true, "the token list shows each token's access and expiry");
  await shot(page, "settings");

  // The CLI reads exactly what the app stored (the app pushes in the background).
  let got = "";
  for (let i = 0; i < 15 && got !== secret; i++) {
    try {
      got = cli(reader, "vault", "get", "GitHub", "--field", "password").stdout.replace(/\n$/, "");
    } catch {
      got = "";
    }
    if (got !== secret) await page.waitForTimeout(2_000);
  }
  check(got === secret, "atlas vault get GitHub --field password prints the app's password");

  const refused = cli(reader, "vault", "add", "--name", "Nope");
  check(
    refused.status === 1 && refused.stderr.includes("api_token_read_only"),
    "the read-only token cannot write",
  );

  const added = atlas(writer, "vault", "add", "--name", "Written by the CLI", "--type", "note");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Open Written by the CLI" }).waitFor({ timeout: 45_000 });
  check(true, "an item the CLI adds appears in the open app");
  await shot(page, "items");

  // Trash in the app; the CLI no longer lists it.
  await page.getByRole("button", { name: "Open Written by the CLI" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("button", { name: "Open GitHub" }).waitFor();
  let listed = [];
  for (let i = 0; i < 15; i++) {
    listed = atlas(reader, "vault", "list");
    if (!listed.some((e) => e.id === added.id)) break;
    await page.waitForTimeout(2_000);
  }
  check(!listed.some((e) => e.id === added.id), "the CLI leaves out what the app trashed");

  // A reload inside the auto-lock window keeps the vault open (keys sealed in the browser).
  await page.reload();
  await page.getByRole("button", { name: "Open GitHub" }).waitFor();
  check(true, "a reload before the auto-lock deadline keeps the vault open");

  // Offline: the server's sync routes fail. An item written now is kept on this device, sealed,
  // across a reload, and reaches the server once it answers again.
  const offlineSecret = `offline ${Date.now()} secret`;
  await page.route("**/sync/**", (route) => route.abort());
  await page.getByRole("button", { name: "New item" }).click();
  await field(page, "Name").fill("Written offline");
  await page.getByLabel("password value", { exact: true }).fill(offlineSecret);
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.getByLabel("password, hidden").waitFor();
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForTimeout(1_000);
  await page.reload();
  await page.getByRole("button", { name: "Open Written offline" }).waitFor({ timeout: 30_000 });
  check(true, "an item written offline is still there after a reload");
  await page
    .getByText(/changes? waiting/)
    .filter({ visible: true })
    .first()
    .waitFor();
  check(true, "it waits to sync");

  // What the browser keeps on disk for the vault is ciphertext.
  const onDisk = await page.evaluate(async () => {
    const dump = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name || !name.startsWith("atlas-vault-") || name.endsWith("keystore")) continue;
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of db.objectStoreNames) {
        const rows = await new Promise((res, rej) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        dump.push(...rows);
      }
      db.close();
    }
    return JSON.stringify(dump);
  });
  check(
    onDisk.length > 1000 &&
      !onDisk.includes(offlineSecret) &&
      !onDisk.includes(secret) &&
      !onDisk.includes("octocat") &&
      !onDisk.includes("Written offline"),
    "the vault's IndexedDB holds no name, username or password in plaintext",
  );

  await page.unroute("**/sync/**");
  let synced = "";
  for (let i = 0; i < 20 && synced !== offlineSecret; i++) {
    try {
      synced = cli(reader, "vault", "get", "Written offline", "--field", "password").stdout;
      synced = synced.replace(/\n$/, "");
    } catch {
      synced = "";
    }
    if (synced !== offlineSecret) await page.waitForTimeout(2_000);
  }
  check(synced === offlineSecret, "the offline edit reaches the server once it is back");

  // Lock on demand: the keys leave the stored session; the password opens it again.
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await page.getByText("Unlock your vault").waitFor();
  const stored = await page.evaluate(() => localStorage.getItem("atlas-vault.session"));
  check(stored && !stored.includes("sealedKeys"), "locking drops the keys from storage");
  await page.reload();
  await page.getByText("Unlock your vault").waitFor();
  check(true, "a locked vault stays locked across a reload");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByRole("button", { name: "Open GitHub" }).waitFor({ timeout: 60_000 });
  check(true, "the password unlocks it");

  // A stored session past its auto-lock deadline opens locked.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("atlas-vault.session"));
    s.lockAt = Date.now() - 1000;
    localStorage.setItem("atlas-vault.session", JSON.stringify(s));
  });
  await page.reload();
  await page.getByText("Unlock your vault").waitFor();
  check(true, "a session past its auto-lock deadline opens locked");

  check(errors.length === 0, `no uncaught page errors (${errors.join("; ")})`);
  console.log(`e2e-web: ${step} checks passed`);
} finally {
  await browser.close();
}
