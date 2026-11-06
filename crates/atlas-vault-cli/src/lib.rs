//! The `atlas-vault` command line: Atlas Vault for scripts, CI and n8n, end-to-end encrypted. The
//! same environment, commands, JSON output and exit codes as the `atlas` CLI's vault commands it
//! took over (they moved here from the core repository with the vault rules). Commands also take
//! the app first (`atlas-vault vault get NAME`, the `atlas` CLI's form); the flat forms
//! (`atlas-vault get NAME --field password`) are the same commands.

use std::collections::HashMap;
use std::path::PathBuf;

use atlas_client::session::ConnectOptions;
use atlas_client::Error;
use atlas_vault_rules::{summary_view, VaultClient, VaultQuery, VAULT_APP};
use serde::Serialize;
use serde_json::{json, Map, Value};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn usage_text() -> String {
    format!(
        "atlas-vault {VERSION} - Atlas Vault from the command line, for scripts, CI and n8n.

Configuration (environment):
  ATLAS_URL        the server, e.g. https://app.atlastodo.dev (or --url)
  ATLAS_TOKEN      an API token that includes Atlas Vault, from the vault's settings
                   (environment only, never a flag); read-only unless made with write access
  ATLAS_STATE_DIR  optional: a directory to cache the account in between runs (sealed with
                   the token), so a run downloads only what changed

Commands (all print JSON but `get --field`; each also works with its app first, e.g.
`atlas-vault vault list`):
  list [--folder F] [--type T] [--tag T] [--search TEXT]   items without their secrets
  get ITEM [--field NAME]   an item with its secrets, or one field's value as plain text
  add --name TEXT [--type T] [--username U] [--password P] [--totp SEED]
      [--text NAME=VALUE]... [--hidden NAME=VALUE]... [--uri URL]... [--notes TEXT]
      [--tag T]... [--folder F] [--favorite true|false] [--json OBJECT|-]
  update ITEM [same fields as add] [--remove-field NAME]... [--json OBJECT|-]
  delete ITEM
  folders list
  folders add NAME

ITEM and F are names (case-insensitive) or ids. --json takes type, name, fields
([{{name, kind, value}}]), urls, notes, tags, folder and favorite, and on update set_fields and
remove_fields; --json - reads it from stdin, which keeps secrets out of the process list.
Field flags add or replace one field (on update the others stay); --folder none clears it.

Errors go to stderr as {{\"error\": ..., \"code\": ...}} with exit code 1 (2 for usage errors)."
    )
}

/// Opens the client; tests pass their own.
pub type Connect<'a> = &'a dyn Fn(ConnectOptions) -> Result<VaultClient, Error>;

/// Reads standard input to its end (`--json -`); tests pass their own.
pub type ReadStdin<'a> = &'a dyn Fn() -> std::io::Result<String>;

pub struct Io<'a> {
    pub env: HashMap<String, String>,
    pub stdout: &'a mut dyn FnMut(&str),
    pub stderr: &'a mut dyn FnMut(&str),
    pub connect: Option<Connect<'a>>,
    /// `None` reads nothing: `--json -` is then a usage error.
    pub stdin: Option<ReadStdin<'a>>,
}

#[derive(Debug)]
enum Fail {
    Usage(String),
    Run(Error),
}

impl From<Error> for Fail {
    fn from(e: Error) -> Self {
        Fail::Run(e)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Str,
    Multi,
    Bool(char),
}

const OPTIONS: &[(&str, Kind)] = &[
    ("url", Kind::Str),
    ("help", Kind::Bool('h')),
    ("version", Kind::Bool('v')),
    ("search", Kind::Str),
    ("notes", Kind::Str),
    ("json", Kind::Str),
    ("tag", Kind::Multi),
    ("name", Kind::Str),
    ("type", Kind::Str),
    ("field", Kind::Str),
    ("folder", Kind::Str),
    ("username", Kind::Str),
    ("password", Kind::Str),
    ("totp", Kind::Str),
    ("text", Kind::Multi),
    ("hidden", Kind::Multi),
    ("uri", Kind::Multi),
    ("remove-field", Kind::Multi),
    ("favorite", Kind::Str),
];

#[derive(Debug, Default)]
struct Values {
    strings: HashMap<String, String>,
    /// The repeatable options (`--label`, `--tag`), each value in order.
    multi: HashMap<String, Vec<String>>,
    help: bool,
    version: bool,
}

impl Values {
    fn get(&self, name: &str) -> Option<&str> {
        self.strings.get(name).map(String::as_str)
    }

    fn all(&self, name: &str) -> Option<&Vec<String>> {
        self.multi.get(name)
    }
}

fn unknown(arg: &str) -> String {
    format!(
        "Unknown option '{arg}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{arg}\""
    )
}

/// `node:util` `parseArgs` with `strict` and positionals, as the TypeScript CLI reads its argv.
fn parse_args(argv: &[String]) -> Result<(Values, Vec<String>), String> {
    let mut values = Values::default();
    let mut positionals = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let arg = &argv[i];
        i += 1;
        if arg == "--" {
            positionals.extend(argv[i..].iter().cloned());
            break;
        }
        if let Some(long) = arg.strip_prefix("--") {
            let (name, inline) = match long.split_once('=') {
                Some((n, v)) => (n, Some(v.to_owned())),
                None => (long, None),
            };
            let Some((_, kind)) = OPTIONS.iter().find(|(n, _)| *n == name) else {
                return Err(unknown(&format!("--{name}")));
            };
            match kind {
                Kind::Bool(short) => {
                    if inline.is_some() {
                        return Err(format!(
                            "Option '-{short}, --{name}' does not take an argument"
                        ));
                    }
                    if name == "help" {
                        values.help = true;
                    } else {
                        values.version = true;
                    }
                }
                Kind::Str | Kind::Multi => {
                    let value = match inline {
                        Some(v) => v,
                        None => match argv.get(i) {
                            None => return Err(format!("Option '--{name} <value>' argument missing")),
                            Some(v) if v.len() > 1 && v.starts_with('-') => {
                                return Err(format!(
                                    "Option '--{name}' argument is ambiguous.\nDid you forget to specify the option argument for '--{name}'?\nTo specify an option argument starting with a dash use '--{name}=-XYZ'."
                                ))
                            }
                            Some(v) => {
                                i += 1;
                                v.clone()
                            }
                        },
                    };
                    if *kind == Kind::Multi {
                        values.multi.entry(name.to_owned()).or_default().push(value);
                    } else {
                        values.strings.insert(name.to_owned(), value);
                    }
                }
            }
        } else if arg.len() > 1 && arg.starts_with('-') {
            for ch in arg[1..].chars() {
                match ch {
                    'h' => values.help = true,
                    'v' => values.version = true,
                    other => return Err(unknown(&format!("-{other}"))),
                }
            }
        } else {
            positionals.push(arg.clone());
        }
    }
    Ok((values, positionals))
}

/// The commands, after the optional `vault`.
const NEEDS_TARGET: &[&str] = &["get", "update", "delete", "folders add"];
const COMMANDS: &[&str] = &["list", "add", "folders list"];

/// Run one command and return the exit code.
pub fn run(argv: &[String], io: &mut Io<'_>) -> i32 {
    let (values, positionals) = match parse_args(argv) {
        Ok(p) => p,
        Err(e) => return usage(io, &e),
    };
    if values.version {
        (io.stdout)(VERSION);
        return 0;
    }
    if values.help || positionals.is_empty() {
        (io.stdout)(&usage_text());
        return if values.help { 0 } else { 2 };
    }
    let server_url = values
        .get("url")
        .map(str::to_owned)
        .or_else(|| io.env.get("ATLAS_URL").cloned())
        .filter(|u| !u.is_empty());
    let token = io.env.get("ATLAS_TOKEN").cloned().filter(|t| !t.is_empty());
    let Some(server_url) = server_url else {
        return usage(io, "set ATLAS_URL (or pass --url)");
    };
    let Some(token) = token else {
        return usage(io, "set ATLAS_TOKEN to an API token");
    };
    let time_zone = io.env.get("ATLAS_TZ").cloned().filter(|t| !t.is_empty());
    let state_dir = io
        .env
        .get("ATLAS_STATE_DIR")
        .filter(|d| !d.is_empty())
        .map(PathBuf::from);

    // `atlas-vault vault get ITEM` is `atlas-vault get ITEM`.
    let rest: &[String] = match positionals.first() {
        Some(app) if app == VAULT_APP && positionals.len() > 1 => &positionals[1..],
        _ => &positionals,
    };
    // `folders add NAME`, `get ITEM`.
    let words = if rest.first().map(String::as_str) == Some("folders") {
        2
    } else {
        1
    };
    let command = rest
        .iter()
        .take(words)
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    // Messages name the command as it was typed.
    let typed = if rest.len() < positionals.len() {
        format!("{VAULT_APP} {command}")
    } else {
        command.clone()
    };
    if !COMMANDS.contains(&command.as_str()) && !NEEDS_TARGET.contains(&command.as_str()) {
        return usage(
            io,
            &format!("unknown command \"{}\"", positionals.join(" ")),
        );
    }
    let target = rest.get(words).cloned();
    if NEEDS_TARGET.contains(&command.as_str()) && target.is_none() {
        let what = if command == "folders add" {
            "a folder name"
        } else {
            "an item name or id"
        };
        return usage(io, &format!("\"{typed}\" needs {what}"));
    }
    let mut opts = ConnectOptions::new(&server_url, &token);
    opts.time_zone = time_zone;
    opts.state_dir = state_dir;
    opts.app = VAULT_APP.to_owned();
    // `--json -`: the object comes from stdin, read before signing in so a bad one costs nothing.
    let mut values = values;
    if values.get("json") == Some("-") {
        let Some(read) = io.stdin else {
            return usage(io, "--json - needs standard input");
        };
        match read() {
            Ok(text) => {
                values.strings.insert("json".into(), text);
            }
            Err(e) => return usage(io, &format!("could not read standard input: {e}")),
        }
    }
    if let Err(Fail::Usage(m)) = vault_input(&command, &typed, &values) {
        return usage(io, &m);
    }
    let connected = match io.connect {
        Some(connect) => connect(opts),
        None => VaultClient::connect(opts),
    };
    let mut client = match connected {
        Ok(c) => c,
        Err(e) => return fail(io, &e),
    };
    let result = dispatch(&mut client, &command, &typed, target.as_deref(), &values);
    // A failed cache write costs the next run a full sync, nothing more.
    let _ = client.session().save_state();
    match result {
        Ok(v) => {
            (io.stdout)(&v);
            0
        }
        Err(Fail::Usage(m)) => usage(io, &m),
        Err(Fail::Run(e)) => fail(io, &e),
    }
}

fn to_json<T: Serialize>(v: T) -> String {
    serde_json::to_string_pretty(&v).expect("JSON")
}

fn dispatch(
    vault: &mut VaultClient,
    command: &str,
    typed: &str,
    id: Option<&str>,
    values: &Values,
) -> Result<String, Fail> {
    let id = id.unwrap_or("");
    Ok(match command {
        "list" => {
            let tags = values.all("tag").cloned().unwrap_or_default();
            if tags.len() > 1 {
                return Err(Fail::Usage(format!("{typed} takes one --tag")));
            }
            to_json(vault.vault_items(&VaultQuery {
                folder: values.get("folder").map(str::to_owned),
                kind: values.get("type").map(str::to_owned),
                tag: tags.into_iter().next(),
                search: values.get("search").map(str::to_owned),
            })?)
        }
        "get" => match values.get("field") {
            // The bare value, for `$(atlas-vault get … --field password)`.
            Some(field) => vault.vault_secret(id, field)?,
            None => to_json(vault.vault_item(id)?),
        },
        // A write answers the listing form: a CI log should not end up holding the secret.
        "add" => {
            let item = vault.create_vault_item(&vault_input(command, typed, values)?)?;
            to_json(summary_view(&item))
        }
        "update" => {
            let item = vault.update_vault_item(id, &vault_input(command, typed, values)?)?;
            to_json(summary_view(&item))
        }
        "delete" => to_json(json!({ "deleted": vault.delete_vault_item(id)? })),
        "folders list" => to_json(vault.vault_folders()?),
        "folders add" => to_json(vault.create_vault_folder(id)?),
        other => return Err(Fail::Usage(format!("unknown command \"{other}\""))),
    })
}

/// The `--json` object, when given.
fn json_object(values: &Values) -> Result<Map<String, Value>, Fail> {
    let Some(text) = values.get("json") else {
        return Ok(Map::new());
    };
    let parsed: Value =
        serde_json::from_str(text).map_err(|_| Fail::Usage("--json is not valid JSON".into()))?;
    match parsed {
        Value::Object(o) => Ok(o),
        _ => Err(Fail::Usage("--json must be an object".into())),
    }
}

/// A `NAME=VALUE` field flag.
fn named_value(flag: &str, raw: &str) -> Result<(String, String), Fail> {
    match raw.split_once('=') {
        Some((n, v)) if !n.trim().is_empty() => Ok((n.trim().to_owned(), v.to_owned())),
        _ => Err(Fail::Usage(format!("--{flag} takes NAME=VALUE"))),
    }
}

/// Append `items` to the list `key` of `input`; a non-list there is left for the rules to refuse.
fn extend_list(input: &mut Map<String, Value>, key: &str, items: Vec<Value>, replace_named: bool) {
    let mut list = match input.remove(key) {
        None => Vec::new(),
        Some(Value::Array(a)) => a,
        Some(other) => {
            input.insert(key.into(), other);
            return;
        }
    };
    for item in items {
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .map(|n| n.trim().to_lowercase());
        let same = list.iter_mut().find(|e| {
            replace_named
                && name.is_some()
                && e.get("name")
                    .and_then(Value::as_str)
                    .map(|n| n.trim().to_lowercase())
                    == name
        });
        match same {
            Some(e) => *e = item,
            None => list.push(item),
        }
    }
    input.insert(key.into(), Value::Array(list));
}

/// What `add` and `update` send: the `--json` object (or stdin's), with the flags over
/// it. A field flag adds or replaces one field: on add in `fields`, on update in `set_fields`, so
/// the item's other fields stay. `Null` for the other vault commands.
fn vault_input(command: &str, typed: &str, values: &Values) -> Result<Value, Fail> {
    let update = command == "update";
    if !update && command != "add" {
        return Ok(Value::Null);
    }
    let mut input = json_object(values)?;
    for key in ["name", "type", "notes"] {
        if let Some(v) = values.get(key) {
            input.insert(key.into(), v.into());
        }
    }
    if let Some(f) = values.get("folder") {
        let folder = if f.is_empty() || f.eq_ignore_ascii_case("none") {
            Value::Null
        } else {
            f.into()
        };
        input.insert("folder".into(), folder);
    }
    if let Some(f) = values.get("favorite") {
        let favorite = match f.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" => true,
            "false" | "no" | "0" => false,
            _ => return Err(Fail::Usage("--favorite is true or false".into())),
        };
        input.insert("favorite".into(), favorite.into());
    }
    if let Some(urls) = values.all("uri") {
        input.insert("urls".into(), urls.clone().into());
    }
    if let Some(tags) = values.all("tag") {
        input.insert("tags".into(), tags.clone().into());
    }
    let mut fields: Vec<Value> = Vec::new();
    for (flag, kind) in [
        ("username", "text"),
        ("password", "hidden"),
        ("totp", "totp"),
    ] {
        if let Some(v) = values.get(flag) {
            fields.push(json!({ "name": flag, "kind": kind, "value": v }));
        }
    }
    for kind in ["text", "hidden"] {
        for raw in values.all(kind).into_iter().flatten() {
            let (name, value) = named_value(kind, raw)?;
            fields.push(json!({ "name": name, "kind": kind, "value": value }));
        }
    }
    if !fields.is_empty() {
        let key = if update { "set_fields" } else { "fields" };
        extend_list(&mut input, key, fields, true);
    }
    if let Some(removes) = values.all("remove-field") {
        if !update {
            return Err(Fail::Usage(format!(
                "--remove-field is for {}",
                typed.replace("add", "update")
            )));
        }
        let removes = removes.iter().cloned().map(Value::from).collect();
        extend_list(&mut input, "remove_fields", removes, false);
    }
    if !update && !input.contains_key("name") {
        return Err(Fail::Usage(format!(
            "{typed} needs --name (or a name in --json)"
        )));
    }
    Ok(Value::Object(input))
}

fn usage(io: &mut Io<'_>, message: &str) -> i32 {
    let line = Described {
        error: message.to_owned(),
        code: "usage".into(),
        status: None,
    };
    (io.stderr)(&serde_json::to_string(&line).expect("JSON"));
    (io.stderr)("Run `atlas-vault --help` for the commands.");
    2
}

#[derive(Serialize)]
struct Described {
    error: String,
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

/// `{ error, code, status? }` for a failure, as the TypeScript CLI describes one.
pub fn describe(err: &Error) -> String {
    let d = match err {
        Error::Atlas { code, message } => Described {
            error: message.clone(),
            code: code.clone(),
            status: None,
        },
        Error::InvalidApiToken(_) => Described {
            error: "ATLAS_TOKEN is not an Atlas API token".into(),
            code: "invalid_token".into(),
            status: None,
        },
        Error::Api { .. } | Error::UpgradeRequired { .. } => {
            let status = err.status().unwrap_or(0);
            let code = match err {
                Error::UpgradeRequired { .. } => "upgrade_required".to_owned(),
                _ => err
                    .api_code()
                    .map(str::to_owned)
                    .unwrap_or_else(|| match status {
                        401 => "unauthorized".into(),
                        429 => "rate_limited".into(),
                        _ => "server_error".into(),
                    }),
            };
            // An expired token says so itself.
            let hint = if status == 401 && code == "unauthorized" {
                " (revoked or wrong token?)"
            } else {
                ""
            };
            Described {
                error: format!("{err}{hint}"),
                code,
                status: Some(status),
            }
        }
        other => Described {
            error: other.to_string(),
            code: "error".into(),
            status: None,
        },
    };
    serde_json::to_string(&d).expect("JSON")
}

fn fail(io: &mut Io<'_>, err: &Error) -> i32 {
    (io.stderr)(&describe(err));
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_argv_like_node_parse_args() {
        let (v, p) =
            parse_args(&args(&["-hv", "a", "--tag", "x", "--tag=y", "--", "--z"])).unwrap();
        assert!(v.help && v.version);
        assert_eq!(p, ["a", "--z"]);
        assert_eq!(*v.all("tag").unwrap(), ["x", "y"]);
        assert!(parse_args(&args(&["--foo"]))
            .unwrap_err()
            .starts_with("Unknown option '--foo'"));
        assert_eq!(
            parse_args(&args(&["--name"])).unwrap_err(),
            "Option '--name <value>' argument missing"
        );
        assert!(parse_args(&args(&["--name", "-x"]))
            .unwrap_err()
            .contains("is ambiguous"));
        assert_eq!(
            parse_args(&args(&["--help=1"])).unwrap_err(),
            "Option '-h, --help' does not take an argument"
        );
        let (v, _) = parse_args(&args(&["--name=-x", "--name", "b"])).unwrap();
        assert_eq!(v.get("name"), Some("b"));
    }
}
