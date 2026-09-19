//! Session recording: the raw terminal stream, written to a file per session.
//!
//! What gets stored is exactly what the pty produced, escape sequences included, so a
//! recording can be replayed with `cat` and looks like the session did. Search has to
//! strip those sequences first — a grep over raw output misses any line that happens to
//! carry a colour code, which on a modern shell is most of them.

use crate::error::{AppError, AppResult};
use crate::models::{Recording, RecordingMatch};
use crate::storage;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Recorder {
    file: Mutex<Option<File>>,
    path: PathBuf,
}

impl Recorder {
    pub fn start(session_id: &str, title: &str) -> AppResult<Self> {
        let dir = storage::recordings_dir()?;
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let path = dir.join(format!("{stamp}-{}.log", sanitise(session_id)));
        let mut file = File::create(&path).map_err(|e| {
            AppError::new("Could not start recording this session.").with_detail(e.to_string())
        })?;
        // A header line, so the list can show what the recording is of without keeping a
        // separate index that could drift from the files on disk.
        let _ = writeln!(
            file,
            "#mieterm {} {}",
            chrono::Local::now().to_rfc3339(),
            title.replace('\n', " ")
        );
        Ok(Self {
            file: Mutex::new(Some(file)),
            path,
        })
    }

    pub fn write(&self, bytes: &[u8]) {
        // A failed write to a log must never take the terminal down with it.
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(bytes);
            }
        }
    }

    pub fn finish(&self) {
        if let Ok(mut guard) = self.file.lock() {
            if let Some(mut file) = guard.take() {
                let _ = file.flush();
            }
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

pub fn list() -> AppResult<Vec<Recording>> {
    let dir = storage::recordings_dir()?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| {
        AppError::new("Could not read the recordings folder.").with_detail(e.to_string())
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }
        let id = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let (title, started_at) = read_header(&path);
        out.push(Recording {
            id,
            title,
            started_at,
            bytes,
        });
    }

    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

pub fn read(id: &str) -> AppResult<String> {
    let path = resolve(id)?;
    let raw = std::fs::read(&path)
        .map_err(|e| AppError::new("Could not read that recording.").with_detail(e.to_string()))?;
    Ok(String::from_utf8_lossy(&raw).into_owned())
}

pub fn delete(id: &str) -> AppResult<()> {
    let path = resolve(id)?;
    std::fs::remove_file(&path)
        .map_err(|e| AppError::new("Could not delete that recording.").with_detail(e.to_string()))
}

/// Case-insensitive substring search across every recording, on the text with escape
/// sequences removed. Capped so a search over months of logs cannot fill the window.
pub fn search(query: &str, limit: usize) -> AppResult<Vec<RecordingMatch>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for recording in list()? {
        let path = storage::recordings_dir()?.join(&recording.id);
        let Ok(file) = File::open(&path) else {
            continue;
        };
        for (index, line) in BufReader::new(file).lines().enumerate() {
            let Ok(line) = line else { break };
            let clean = strip_ansi(&line);
            if clean.to_lowercase().contains(&needle) {
                out.push(RecordingMatch {
                    id: recording.id.clone(),
                    title: recording.title.clone(),
                    line_number: index + 1,
                    line: clean.trim_end().chars().take(400).collect(),
                });
                if out.len() >= limit {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}

fn resolve(id: &str) -> AppResult<PathBuf> {
    // The id comes from the frontend, so it is treated as untrusted: only a bare file
    // name inside the recordings folder is ever opened.
    let dir = storage::recordings_dir()?;
    let path = dir.join(sanitise(id));
    if !storage::is_inside(&dir, &path) {
        return Err(AppError::new("That recording is not one of Mieterm's."));
    }
    Ok(path)
}

fn read_header(path: &PathBuf) -> (String, String) {
    let fallback = || {
        (
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Session")
                .to_string(),
            String::new(),
        )
    };
    let Ok(file) = File::open(path) else {
        return fallback();
    };
    let mut first = String::new();
    if BufReader::new(file).read_line(&mut first).is_err() {
        return fallback();
    }
    match first.strip_prefix("#mieterm ") {
        Some(rest) => match rest.trim_end().split_once(' ') {
            Some((stamp, title)) => (title.to_string(), stamp.to_string()),
            None => fallback(),
        },
        None => fallback(),
    }
}

fn sanitise(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Drops CSI/OSC escape sequences so a search sees the text a person saw.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            if ch != '\r' {
                out.push(ch);
            }
            continue;
        }
        match chars.next() {
            // CSI: parameters, then a final byte in @-~.
            Some('[') => {
                for next in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&next) {
                        break;
                    }
                }
            }
            // OSC: runs until BEL or ST (ESC \).
            Some(']') => {
                while let Some(next) = chars.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            // Two-character sequences: ESC already consumed the second byte.
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::strip_ansi;

    #[test]
    fn removes_colour_codes() {
        assert_eq!(strip_ansi("\u{1b}[32mok\u{1b}[0m done"), "ok done");
    }

    #[test]
    fn removes_window_title_sequences() {
        assert_eq!(strip_ansi("\u{1b}]0;title\u{7}shell$ ls"), "shell$ ls");
    }

    #[test]
    fn leaves_plain_text_alone() {
        assert_eq!(strip_ansi("total 12"), "total 12");
    }

    #[test]
    fn drops_carriage_returns_so_matches_are_not_split() {
        assert_eq!(strip_ansi("line\r"), "line");
    }
}
