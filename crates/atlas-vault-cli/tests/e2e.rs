//! The `atlas-vault` binary end to end against a real server: the one in `ATLAS_E2E_SERVER`
//! (core's `atlas-server` offering `ATLAS_APPS=todo,vault`; `scripts/e2e-cli.sh` starts one and
//! runs these with `--run-ignored all`). Vault-only tokens keep a CI secret: one with writes opted
//! in stores it, the default read-only one reads it back and is refused writes by the server as
//! well as the client, and the server holds only ciphertext under the vault key. A token that is
//! not one, or is unknown, is refused with a JSON error.

use std::process::Command;

use atlas_client::api::{ApiClient, UreqTransport};
use atlas_client::crypto::{
    format_api_token, generate_api_token, random_bytes, wrap_app_keys_for_api_token,
    x25519_public_key, FieldEnvelope, Keyring,
};
use atlas_client::session::ConnectOptions;
use atlas_client::wire::open_sealed;
use atlas_vault_rules::VaultClient;
use serde_json::{json, Value};
use uuid::Uuid;

/// The server in `ATLAS_E2E_SERVER` (it must offer Atlas Vault and lift its auth rate limit:
/// every CLI run signs in).
fn server() -> String {
    std::env::var("ATLAS_E2E_SERVER")
        .ok()
        .filter(|u| !u.is_empty())
        .expect("ATLAS_E2E_SERVER names a server offering todo and vault (scripts/e2e-cli.sh)")
        .trim_end_matches('/')
        .to_owned()
}

fn wrapped() -> Value {
    json!({ "v": 1, "iv": hex::encode(random_bytes::<12>()), "ct": hex::encode(random_bytes::<48>()) })
}

/// Run the built `atlas-vault` binary; returns (exit code, stdout JSON or text, stderr).
fn atlas_vault(base: &str, token: &str, args: &[&str]) -> (i32, Value, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_atlas-vault"))
        .args(args)
        .env("ATLAS_URL", base)
        .env("ATLAS_TOKEN", token)
        .env_remove("ATLAS_STATE_DIR")
        .output()
        .expect("runs atlas-vault");
    let stdout = String::from_utf8(out.stdout).unwrap();
    let json = serde_json::from_str(&stdout).unwrap_or(Value::String(stdout));
    (
        out.status.code().unwrap(),
        json,
        String::from_utf8(out.stderr).unwrap(),
    )
}

/// Sign up a current account and enable Atlas Vault as the app does; returns the signed-in API
/// client, the account id, and the vault key and identity.
fn account_with_vault(base: &str) -> (ApiClient, String, [u8; 32], [u8; 32]) {
    let api = ApiClient::new(base, Box::new(UreqTransport::default()));
    let user_id = Uuid::new_v4().to_string();
    let signup = api
        .request(
            "POST",
            "/auth/signup",
            Some(&json!({
                "email": format!("cli-vault-{}@example.com", Uuid::now_v7()),
                "password": hex::encode(random_bytes::<32>()),
                "salt": hex::encode(random_bytes::<16>()),
                "public_key": x25519_public_key(&random_bytes()),
                "recovery_public_key": x25519_public_key(&random_bytes()),
                "encrypted_dek": wrapped(),
                "encrypted_private_key": wrapped(),
                "recovery_encrypted_dek": wrapped(),
                "recovery_encrypted_private_key": wrapped(),
                "user_id": user_id,
                "encrypted_root_key": wrapped(),
                "recovery_encrypted_root_key": wrapped(),
                "app_keys": [{ "app": "todo", "wrapped_key": wrapped(), "wrapped_private_key": wrapped() }],
            })),
        )
        .expect("signs up");
    api.set_token(Some(signup["access_token"].as_str().unwrap().to_owned()));
    api.request(
        "PUT",
        "/auth/app-keys/vault",
        Some(&json!({ "wrapped_key": wrapped(), "wrapped_private_key": wrapped() })),
    )
    .expect("stores the vault key");
    api.request("PUT", "/auth/apps/vault", None)
        .expect("enables vault");
    (api, user_id, random_bytes(), random_bytes())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Make a vault-only API token carrying `key` and `private_key`, expiring in a day; `extra` adds
/// to the request (`write`). Returns the token string and its id.
fn vault_token(
    api: &ApiClient,
    user_id: &str,
    key: &[u8; 32],
    private_key: &[u8; 32],
    extra: Value,
) -> (String, String) {
    let token = generate_api_token();
    let wraps = wrap_app_keys_for_api_token(&token, user_id, "vault", key, private_key).unwrap();
    let auth = atlas_client::crypto::derive_api_token_keys(&token).auth;
    let mut body = json!({
        "id": token.id, "name": "ci", "auth": auth,
        "apps": ["vault"], "app_keys": { "vault": wraps },
        "expires_at": now_ms() + 86_400_000,
    });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    api.request("POST", "/auth/api-tokens", Some(&body))
        .expect("creates a vault token");
    (format_api_token(&token), token.id.clone())
}

/// [`atlas_vault`] with `input` on standard input.
fn atlas_vault_with_stdin(
    base: &str,
    token: &str,
    args: &[&str],
    input: &str,
) -> (i32, Value, String) {
    use std::io::Write;
    let mut child = Command::new(env!("CARGO_BIN_EXE_atlas-vault"))
        .args(args)
        .env("ATLAS_URL", base)
        .env("ATLAS_TOKEN", token)
        .env_remove("ATLAS_STATE_DIR")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("runs atlas-vault");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    let stdout = String::from_utf8(out.stdout).unwrap();
    let json = serde_json::from_str(&stdout).unwrap_or(Value::String(stdout));
    (
        out.status.code().unwrap(),
        json,
        String::from_utf8(out.stderr).unwrap(),
    )
}

fn error_code(err: &str) -> String {
    let line: Value = serde_json::from_str(err.trim()).expect("a JSON error");
    line["code"].as_str().unwrap_or("").to_owned()
}

#[test]
#[ignore = "end to end: scripts/e2e-cli.sh runs it against the server in ATLAS_E2E_SERVER"]
fn the_cli_keeps_vault_secrets_for_ci_with_scoped_tokens() {
    let base = server();
    let (api, user_id, vault_key, vault_private) = account_with_vault(&base);

    // A token with writes opted in stores a secret, read from stdin so it never sits in argv.
    let (writer, _) = vault_token(
        &api,
        &user_id,
        &vault_key,
        &vault_private,
        json!({ "write": true }),
    );
    let (code, _, err) = atlas_vault(&base, &writer, &["folders", "add", "CI"]);
    assert_eq!(code, 0, "{err}");
    let (code, added, err) = atlas_vault_with_stdin(
        &base,
        &writer,
        &["add", "--json", "-"],
        r#"{"name": "Deploy key", "type": "api_key", "folder": "ci",
            "fields": [{"name": "token", "kind": "hidden", "value": "sk_live_e2e"}]}"#,
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(added["folder_name"], "CI");
    assert!(
        !added.to_string().contains("sk_live_e2e"),
        "a write does not echo the secret: {added}"
    );
    let id = added["id"].as_str().unwrap().to_owned();

    // The default vault token reads only: the secret, as plain text for scripts.
    let (reader, reader_id) = vault_token(&api, &user_id, &vault_key, &vault_private, json!({}));
    let (code, value, err) =
        atlas_vault(&base, &reader, &["get", "deploy key", "--field", "token"]);
    assert_eq!(code, 0, "{err}");
    assert_eq!(value, Value::String("sk_live_e2e\n".into()));
    let (code, listed, err) = atlas_vault(&base, &reader, &["list", "--folder", "CI"]);
    assert_eq!(code, 0, "{err}");
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert!(!listed.to_string().contains("sk_live_e2e"));
    let (code, _, err) = atlas_vault(&base, &reader, &["delete", &id]);
    assert_eq!(code, 1);
    assert_eq!(error_code(&err), "api_token_read_only", "{err}");

    // The server refuses the read-only token's writes itself, whatever the client does.
    let client = VaultClient::connect(ConnectOptions::new(&base, &reader))
        .expect("a vault session connects");
    assert!(!client.session().can_write);
    let refused = client
        .session()
        .api
        .request("POST", "/sync/push", Some(&json!({ "operations": [] })))
        .unwrap_err();
    assert_eq!(refused.status(), Some(403));
    assert_eq!(refused.api_code(), Some("api_token_read_only"));

    // What the server holds is ciphertext under the vault key, as vault.sealed ops.
    let pulled = client
        .session()
        .api
        .request("GET", "/sync/pull?since=0", None)
        .unwrap();
    let raw = pulled.to_string();
    assert!(!raw.contains("sk_live_e2e") && !raw.contains("Deploy key"));
    for op in pulled["operations"].as_array().unwrap() {
        assert_eq!(op["entity"], "vault.sealed");
        let envelope = FieldEnvelope::from_value_v3(&op["value"]).expect("encrypted");
        let opened = open_sealed(
            &Keyring::new(vault_key, [0; 32], None),
            "vault.sealed",
            op["entity_id"].as_str().unwrap(),
            op["field"].as_str().unwrap(),
            None,
            &envelope,
        )
        .expect("the vault key opens it");
        assert!(opened.kind.as_str().starts_with("vault."));
    }

    // Revoked, the token opens nothing; a vault token without an expiry is never made.
    api.request("DELETE", &format!("/auth/api-tokens/{reader_id}"), None)
        .expect("revokes");
    let (code, _, err) = atlas_vault(&base, &reader, &["list"]);
    assert_eq!(code, 1);
    assert_eq!(error_code(&err), "unauthorized", "{err}");
    let token = generate_api_token();
    let wraps =
        wrap_app_keys_for_api_token(&token, &user_id, "vault", &vault_key, &vault_private).unwrap();
    let refused = api
        .request(
            "POST",
            "/auth/api-tokens",
            Some(&json!({
                "id": token.id, "name": "forever", "apps": ["vault"],
                "auth": atlas_client::crypto::derive_api_token_keys(&token).auth,
                "app_keys": { "vault": wraps },
            })),
        )
        .unwrap_err();
    assert_eq!(refused.api_code(), Some("api_token_expiry_required"));
}

#[test]
#[ignore = "end to end: scripts/e2e-cli.sh runs it against the server in ATLAS_E2E_SERVER"]
fn the_cli_refuses_bad_tokens() {
    let base = server();
    // A token that is not one, and an unknown one.
    let (code, _, err) = atlas_vault(&base, "nope", &["list"]);
    assert_eq!(code, 1);
    assert!(err.contains("invalid_token"), "{err}");
    let other = format_api_token(&generate_api_token());
    let (code, _, err) = atlas_vault(&base, &other, &["vault", "list"]);
    assert_eq!(code, 1);
    assert!(err.contains("\"status\":401"), "{err}");
}
