//! Plain JSON files in the platform's application-data directory.
//!
//! A database would be more machinery than four small lists need, and a text file the
//! user can read, diff, and copy between machines is worth more here than query speed.
//! Secrets never appear in any of it — those live in the OS keychain, see `secrets`.

use crate::error::{AppError, AppResult};
use crate::models::{Host, PortForward, Settings, Snippet};
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

const HOSTS: &str = "hosts.json";
const SNIPPETS: &str = "snippets.json";
const FORWARDS: &str = "forwards.json";
const SETTINGS: &str = "settings.json";

pub fn data_dir() -> AppResult<PathBuf> {
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::new("Could not locate this account's application data folder."))?;
    let dir = base.join("Mieterm");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("Could not create Mieterm's data folder.").with_detail(e.to_string())
    })?;
    Ok(dir)
}

pub fn recordings_dir() -> AppResult<PathBuf> {
    let dir = data_dir()?.join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("Could not create the session recordings folder.").with_detail(e.to_string())
    })?;
    Ok(dir)
}

/// A missing or unreadable file is an empty list, not an error: a first run has no files,
/// and a corrupted one should not lock the user out of the app that writes it.
fn load<T: DeserializeOwned + Default>(name: &str) -> AppResult<T> {
    let path = data_dir()?.join(name);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(_) => Ok(T::default()),
    }
}

/// Written to a sibling temp file and renamed, so an interrupted write cannot leave a
/// half-serialised hosts.json behind.
fn save<T: Serialize>(name: &str, value: &T) -> AppResult<()> {
    let dir = data_dir()?;
    let path = dir.join(name);
    let temp = dir.join(format!("{name}.tmp"));
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::new("Could not serialise the file.").with_detail(e.to_string()))?;
    std::fs::write(&temp, text).map_err(|e| {
        AppError::new(format!("Could not write {name}.")).with_detail(e.to_string())
    })?;
    std::fs::rename(&temp, &path)
        .map_err(|e| AppError::new(format!("Could not replace {name}.")).with_detail(e.to_string()))
}

pub fn load_hosts() -> AppResult<Vec<Host>> {
    load(HOSTS)
}
pub fn save_hosts(v: &[Host]) -> AppResult<()> {
    save(HOSTS, &v)
}
pub fn load_snippets() -> AppResult<Vec<Snippet>> {
    let list: Vec<Snippet> = load(SNIPPETS)?;
    if list.is_empty() {
        Ok(default_snippets())
    } else {
        Ok(list)
    }
}
pub fn save_snippets(v: &[Snippet]) -> AppResult<()> {
    save(SNIPPETS, &v)
}
pub fn load_forwards() -> AppResult<Vec<PortForward>> {
    load(FORWARDS)
}
pub fn save_forwards(v: &[PortForward]) -> AppResult<()> {
    save(FORWARDS, &v)
}
pub fn load_settings() -> AppResult<Settings> {
    let path = data_dir()?.join(SETTINGS);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(_) => Ok(Settings::default()),
    }
}
pub fn save_settings(v: &Settings) -> AppResult<()> {
    save(SETTINGS, v)
}

/// An empty snippet list on a first run is a dead feature nobody discovers, so it starts
/// with the handful of commands most people type on a new box anyway.
fn default_snippets() -> Vec<Snippet> {
    let make = |name: &str, command: &str, tag: &str| Snippet {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        command: command.into(),
        tags: vec![tag.into()],
        no_newline: false,
    };
    vec![
        make("Disk usage", "df -h", "system"),
        make(
            "Largest folders here",
            "du -sh * | sort -rh | head -20",
            "system",
        ),
        make("Memory", "free -h", "system"),
        make("Top processes", "ps aux --sort=-%cpu | head -15", "system"),
        make("Listening ports", "ss -tulpn", "network"),
        make("Service status", "systemctl status ", "system"),
        make("Follow syslog", "journalctl -f", "logs"),
        make(
            "Nginx error log",
            "tail -f /var/log/nginx/error.log",
            "logs",
        ),
        make("Docker containers", "docker ps -a", "docker"),
        make("Docker logs", "docker logs -f ", "docker"),
        make("Git status", "git status", "git"),
        make("Uptime and load", "uptime", "system"),
    ]
}

/// True when `path` stays inside `root` after both are resolved. Used before anything
/// writes to a path built from a remote filename.
pub fn is_inside(root: &Path, path: &Path) -> bool {
    match (root.canonicalize(), path.canonicalize()) {
        (Ok(root), Ok(path)) => path.starts_with(root),
        // An not-yet-created download target cannot be canonicalised; check its parent.
        _ => match (root.canonicalize(), path.parent().map(|p| p.canonicalize())) {
            (Ok(root), Some(Ok(parent))) => parent.starts_with(root),
            _ => false,
        },
    }
}
