//! Terminal sessions: a real pseudo-terminal per tab, streamed to the webview.
//!
//! A pty rather than a pipe is what makes vim, htop, less and tmux behave, and what lets
//! ssh prompt for a fingerprint or a password like it would in any terminal. portable-pty
//! gives the same API over ConPTY on Windows.
//!
//! Output is forwarded as base64. A pty emits bytes, and a read can land in the middle of
//! a UTF-8 sequence or an escape sequence; decoding here would corrupt exactly the
//! multi-byte output people notice. xterm.js takes the bytes and does its own decoding.

use crate::error::{AppError, AppResult};
use crate::models::{AuthMethod, Host, Settings};
use crate::{recording, secrets, ssh};
use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Emitted for every chunk the pty produces.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    id: String,
    /// base64 of the raw bytes; see the module note.
    data: String,
}

/// Emitted once, when the process behind a session ends.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    id: String,
    code: u32,
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Held for the whole session: ssh may re-read it when a connection is re-keyed or a
    /// second authentication round happens, and the file deletes itself on drop.
    _askpass: Option<ssh::AskPassGuard>,
    recorder: Option<Arc<recording::Recorder>>,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, Session>>,
}

/// What the frontend asked us to open.
pub struct OpenRequest<'a> {
    pub id: String,
    /// None for a local shell.
    pub host: Option<&'a Host>,
    pub cols: u16,
    pub rows: u16,
    /// Starting directory for a local shell; ignored for ssh.
    pub cwd: Option<String>,
}

impl SessionManager {
    pub fn open(
        &self,
        app: &AppHandle,
        request: OpenRequest<'_>,
        settings: &Settings,
    ) -> AppResult<()> {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: request.rows.max(1),
                cols: request.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                AppError::new("Could not open a terminal device.").with_detail(e.to_string())
            })?;

        let (mut command, askpass, title) = match request.host {
            Some(host) => build_ssh_command(host, settings)?,
            None => (
                build_local_command(request.cwd.as_deref()),
                None,
                "Local shell".to_string(),
            ),
        };

        // Everything Mieterm spawns advertises the same terminal type, because that is the
        // one xterm.js actually emulates. Claiming anything else invites escape sequences
        // the frontend would render as garbage.
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let mut child = pair.slave.spawn_command(command).map_err(|e| {
            AppError::new("Could not start the terminal session.").with_detail(e.to_string())
        })?;
        // The slave handle keeps a descriptor open; if it lives on, the reader never sees
        // EOF when the child exits and the tab looks alive forever.
        drop(pair.slave);

        let killer = child.clone_killer();
        let writer = pair.master.take_writer().map_err(|e| {
            AppError::new("Could not write to the terminal device.").with_detail(e.to_string())
        })?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| {
            AppError::new("Could not read from the terminal device.").with_detail(e.to_string())
        })?;

        let recorder = if settings.record_sessions {
            recording::Recorder::start(&request.id, &title)
                .ok()
                .map(Arc::new)
        } else {
            None
        };

        // Reading a pty blocks, so it gets a real thread rather than a task on the async
        // runtime, where it would pin a worker for the life of the session.
        {
            let app = app.clone();
            let id = request.id.clone();
            let recorder = recorder.clone();
            std::thread::spawn(move || {
                let engine = base64::engine::general_purpose::STANDARD;
                let mut buffer = [0u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let chunk = &buffer[..n];
                            if let Some(recorder) = &recorder {
                                recorder.write(chunk);
                            }
                            let event = OutputEvent {
                                id: id.clone(),
                                data: engine.encode(chunk),
                            };
                            if app.emit("session:data", event).is_err() {
                                break; // the window is gone
                            }
                        }
                    }
                }
            });
        }

        // A second thread reaps the child, so the tab can show "exited (1)" instead of
        // just going quiet, and the session is dropped from the map either way.
        {
            let app = app.clone();
            let id = request.id.clone();
            std::thread::spawn(move || {
                let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
                if let Some(manager) = app.try_state::<SessionManager>() {
                    manager.forget(&id);
                }
                let _ = app.emit("session:exit", ExitEvent { id, code });
            });
        }

        let mut sessions = self.lock()?;
        sessions.insert(
            request.id,
            Session {
                writer,
                master: pair.master,
                killer,
                _askpass: askpass,
                recorder,
            },
        );
        Ok(())
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> AppResult<()> {
        let mut sessions = self.lock()?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| AppError::new("That terminal session is no longer open."))?;
        session
            .writer
            .write_all(bytes)
            .and_then(|()| session.writer.flush())
            .map_err(|e| {
                AppError::new("Could not send input to the terminal.").with_detail(e.to_string())
            })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let sessions = self.lock()?;
        // A resize on a tab that just closed is a race, not an error worth showing.
        let Some(session) = sessions.get(id) else {
            return Ok(());
        };
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::new("Could not resize the terminal.").with_detail(e.to_string()))
    }

    pub fn close(&self, id: &str) -> AppResult<()> {
        let mut sessions = self.lock()?;
        if let Some(mut session) = sessions.remove(id) {
            let _ = session.killer.kill();
            if let Some(recorder) = session.recorder.take() {
                recorder.finish();
            }
        }
        Ok(())
    }

    pub fn is_open(&self, id: &str) -> bool {
        self.lock().map(|s| s.contains_key(id)).unwrap_or(false)
    }

    /// Called from the reaper thread once the process is already gone: drops our side of
    /// the pty without trying to kill a pid that no longer exists.
    fn forget(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(mut session) = sessions.remove(id) {
                if let Some(recorder) = session.recorder.take() {
                    recorder.finish();
                }
            }
        }
    }

    /// Kills every session. Called on window close so no ssh process outlives the app.
    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.killer.kill();
                if let Some(recorder) = session.recorder.take() {
                    recorder.finish();
                }
            }
        }
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, Session>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::new("The terminal session list is in an inconsistent state."))
    }
}

fn build_ssh_command(
    host: &Host,
    settings: &Settings,
) -> AppResult<(CommandBuilder, Option<ssh::AskPassGuard>, String)> {
    let program = ssh::require_ssh()?;
    let args = ssh::terminal_args(host, settings.keepalive_seconds)?;

    let mut command = CommandBuilder::new(program);
    for arg in args {
        command.arg(arg);
    }

    let askpass = match host.auth {
        AuthMethod::Password => match secrets::get(secrets::SecretKind::Password, &host.id)? {
            Some(password) if !password.is_empty() => match ssh::write_askpass(&password) {
                Ok(guard) => {
                    command.env("SSH_ASKPASS", guard.path.to_string_lossy().to_string());
                    command.env("SSH_ASKPASS_REQUIRE", "force");
                    // Older clients only consult SSH_ASKPASS when they believe a display
                    // exists; setting this costs nothing where it is not needed.
                    command.env("DISPLAY", ":0");
                    Some(guard)
                }
                // Windows, where ssh ignores SSH_ASKPASS. It will prompt in the pty and
                // the user types it there, which is why this is not fatal.
                Err(_) => None,
            },
            _ => None,
        },
        _ => None,
    };

    if let Some(home) = dirs::home_dir() {
        command.cwd(home);
    }
    Ok((command, askpass, host.label()))
}

fn build_local_command(cwd: Option<&str>) -> CommandBuilder {
    // new_default_prog picks the login shell on unix and the ComSpec/PowerShell on
    // Windows, which is the thing the user expects a "local terminal" to be.
    let mut command = CommandBuilder::new_default_prog();
    match cwd.filter(|p| !p.is_empty()) {
        Some(path) => command.cwd(path),
        None => {
            if let Some(home) = dirs::home_dir() {
                command.cwd(home);
            }
        }
    }
    command
}
