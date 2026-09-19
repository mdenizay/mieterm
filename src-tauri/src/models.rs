//! Everything that gets written to disk or crosses the IPC boundary.
//!
//! Every struct decodes leniently — `#[serde(default)]` throughout — so a config file
//! written by an older version still loads after a field is added. That is the whole
//! reason these are hand-defaulted rather than derived from the UI's shape.

use serde::{Deserialize, Serialize};

fn default_port() -> u16 {
    22
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    /// ssh-agent, or whatever `~/.ssh` already offers. The default because it is the
    /// setup that needs nothing described here twice.
    #[default]
    Agent,
    Password,
    Key,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub hostname: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub key_path: String,
    /// Free-form; the sidebar groups by the first one.
    pub tags: Vec<String>,
    /// One of the palette names in the frontend; unknown values fall back to blue.
    pub color: String,
    /// Run once, right after the shell comes up.
    pub startup_command: String,
    /// Raw extra ssh arguments — `-J jump`, `-L 8080:localhost:80`, and so on.
    pub extra_args: String,
    /// Notes the user keeps with the host. Shown in the detail panel.
    pub notes: String,
}

impl Default for Host {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            hostname: String::new(),
            port: 22,
            username: String::new(),
            auth: AuthMethod::Agent,
            key_path: String::new(),
            tags: Vec::new(),
            color: "blue".into(),
            startup_command: String::new(),
            extra_args: String::new(),
            notes: String::new(),
        }
    }
}

impl Host {
    pub fn target(&self) -> String {
        if self.username.is_empty() {
            self.hostname.clone()
        } else {
            format!("{}@{}", self.username, self.hostname)
        }
    }

    pub fn label(&self) -> String {
        if self.name.is_empty() {
            self.target()
        } else {
            self.name.clone()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub command: String,
    /// Shown in the palette so a long list stays searchable by purpose, not just text.
    pub tags: Vec<String>,
    /// Send the command without a trailing newline, for things the user wants to edit
    /// before running.
    pub no_newline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ForwardKind {
    /// -L: a local port that reaches a remote address.
    #[default]
    Local,
    /// -R: a remote port that reaches a local address.
    Remote,
    /// -D: a local SOCKS proxy.
    Dynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PortForward {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub kind: ForwardKind,
    pub local_port: u16,
    /// Ignored for a dynamic forward.
    pub remote_host: String,
    pub remote_port: u16,
    /// Opened as soon as the app starts.
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Light or dark chrome. "system" follows the OS.
    pub ui_theme: String,
    /// Name of one of the frontend's terminal palettes.
    pub terminal_theme: String,
    pub font_family: String,
    pub font_size: u16,
    pub cursor_style: String,
    pub cursor_blink: bool,
    pub scrollback: u32,
    /// Write every session's output to a log file under the app data directory.
    pub record_sessions: bool,
    /// Copy on selection, the way a terminal usually behaves.
    pub copy_on_select: bool,
    /// Keep the connection alive through a NAT that drops idle flows.
    pub keepalive_seconds: u32,
    pub language: String,
    /// Look for a new version a few seconds after launch.
    pub auto_update: bool,
    /// Fetch it in the background once found. Installing is still a click, always.
    pub auto_download_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ui_theme: "system".into(),
            terminal_theme: "One Dark".into(),
            font_family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace".into(),
            font_size: 13,
            cursor_style: "bar".into(),
            cursor_blink: true,
            scrollback: 5000,
            record_sessions: false,
            copy_on_select: true,
            keepalive_seconds: 30,
            language: "en".into(),
            auto_update: true,
            auto_download_updates: true,
        }
    }
}

/// One saved session log, as listed in the recordings panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub title: String,
    pub started_at: String,
    pub bytes: u64,
}

/// A line matched by a search across the recordings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMatch {
    pub id: String,
    pub title: String,
    pub line_number: usize,
    pub line: String,
}

/// A directory entry from the SFTP browser.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Unix mode as an octal string, or empty when the server did not report one.
    pub permissions: String,
    /// Seconds since the epoch, 0 when unknown.
    pub modified: u64,
}
