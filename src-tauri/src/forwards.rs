//! The port-forward manager: saved tunnels that start and stop with one click.
//!
//! Each one is an `ssh -N` process. They are deliberately separate from terminal
//! sessions: a forward should survive closing the tab you opened it from, and should be
//! restartable without a shell attached to it.

use crate::error::{AppError, AppResult};
use crate::models::{AuthMethod, ForwardKind, Host, PortForward, Settings};
use crate::{secrets, ssh};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ForwardState {
    Starting,
    Running,
    Failed,
    Stopped,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStatus {
    pub id: String,
    pub state: ForwardState,
    /// Only set for `Failed`: ssh's own complaint, which is usually the useful part.
    pub message: String,
}

struct Running {
    child: Child,
    _askpass: Option<ssh::AskPassGuard>,
}

#[derive(Default)]
pub struct ForwardManager {
    running: Mutex<HashMap<String, Running>>,
    status: Mutex<HashMap<String, ForwardStatus>>,
}

impl ForwardManager {
    pub fn start(
        &self,
        app: &AppHandle,
        host: &Host,
        forward: &PortForward,
        settings: &Settings,
    ) -> AppResult<()> {
        if self.is_running(&forward.id) {
            return Ok(());
        }
        let program = ssh::require_ssh()?;
        let args = ssh::forward_args(host, forward, settings.keepalive_seconds)?;

        let mut command = Command::new(program);
        command.args(&args);

        let askpass = match host.auth {
            AuthMethod::Password => match secrets::get(secrets::SecretKind::Password, &host.id)? {
                Some(password) if !password.is_empty() => match ssh::write_askpass(&password) {
                    Ok(guard) => {
                        command
                            .env("SSH_ASKPASS", &guard.path)
                            .env("SSH_ASKPASS_REQUIRE", "force")
                            .env("DISPLAY", ":0");
                        Some(guard)
                    }
                    Err(_) => None,
                },
                _ => None,
            },
            _ => None,
        };

        // No pty here, so a prompt nobody can answer would hang forever. Without a
        // password to offer, refuse to prompt at all and fail with a readable reason.
        if askpass.is_none() && host.auth == AuthMethod::Password {
            command.arg("-o").arg("BatchMode=yes");
        }

        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| AppError::new("Could not start the tunnel.").with_detail(e.to_string()))?;
        let stderr = child.stderr.take();

        self.set_status(app, &forward.id, ForwardState::Starting, String::new());
        self.running
            .lock()
            .map_err(|_| AppError::new("The tunnel list is in an inconsistent state."))?
            .insert(
                forward.id.clone(),
                Running {
                    child,
                    _askpass: askpass,
                },
            );

        // ssh says nothing on success, so readiness is watched rather than asked for: a
        // local forward is up when its port accepts a connection, and any forward is
        // broken the moment the process exits.
        let app = app.clone();
        let id = forward.id.clone();
        let kind = forward.kind;
        let port = forward.local_port;
        let timeout = Duration::from_secs(settings.keepalive_seconds.clamp(10, 60) as u64);
        std::thread::spawn(move || {
            let complaint = Arc::new(Mutex::new(String::new()));
            if let Some(stderr) = stderr {
                let complaint = complaint.clone();
                std::thread::spawn(move || {
                    let mut collected = Vec::new();
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        collected.push(line);
                        if collected.len() >= 8 {
                            break;
                        }
                    }
                    if let Ok(mut slot) = complaint.lock() {
                        *slot = collected.join("\n");
                    }
                });
            }

            let deadline = Instant::now() + timeout;
            loop {
                let Some(manager) = app.try_state::<ForwardManager>() else {
                    return;
                };

                match manager.reap(&id) {
                    Some(status) => {
                        // Give the stderr reader a moment to land before quoting it.
                        std::thread::sleep(Duration::from_millis(150));
                        let message = complaint.lock().map(|m| m.clone()).unwrap_or_default();
                        let message = if message.trim().is_empty() {
                            format!("ssh exited with status {status}.")
                        } else {
                            message
                        };
                        manager.set_status(&app, &id, ForwardState::Failed, message);
                        return;
                    }
                    None => {
                        let up = match kind {
                            // A remote forward binds on the server, so there is nothing
                            // local to probe. It falls through to the deadline below,
                            // where "still alive" is the only signal available.
                            ForwardKind::Remote => false,
                            _ => std::net::TcpStream::connect_timeout(
                                &([127, 0, 0, 1], port).into(),
                                Duration::from_millis(200),
                            )
                            .is_ok(),
                        };
                        if up {
                            manager.set_status(&app, &id, ForwardState::Running, String::new());
                            return;
                        }
                    }
                }

                if Instant::now() > deadline {
                    // Still alive and still not answering: for a remote forward that is
                    // the expected steady state, for a local one it is as good as it gets.
                    let Some(manager) = app.try_state::<ForwardManager>() else {
                        return;
                    };
                    manager.set_status(&app, &id, ForwardState::Running, String::new());
                    return;
                }
                std::thread::sleep(Duration::from_millis(150));
            }
        });

        Ok(())
    }

    pub fn stop(&self, app: &AppHandle, id: &str) -> AppResult<()> {
        if let Ok(mut running) = self.running.lock() {
            if let Some(mut entry) = running.remove(id) {
                let _ = entry.child.kill();
                let _ = entry.child.wait();
            }
        }
        self.set_status(app, id, ForwardState::Stopped, String::new());
        Ok(())
    }

    pub fn stop_all(&self) {
        if let Ok(mut running) = self.running.lock() {
            for (_, mut entry) in running.drain() {
                let _ = entry.child.kill();
                let _ = entry.child.wait();
            }
        }
    }

    pub fn statuses(&self) -> Vec<ForwardStatus> {
        self.status
            .lock()
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default()
    }

    fn is_running(&self, id: &str) -> bool {
        self.running
            .lock()
            .map(|r| r.contains_key(id))
            .unwrap_or(false)
    }

    /// Returns the exit code if the process has ended, and forgets it. `None` means it is
    /// still running.
    fn reap(&self, id: &str) -> Option<i32> {
        let mut running = self.running.lock().ok()?;
        let entry = running.get_mut(id)?;
        match entry.child.try_wait() {
            Ok(Some(status)) => {
                running.remove(id);
                Some(status.code().unwrap_or(-1))
            }
            _ => None,
        }
    }

    fn set_status(&self, app: &AppHandle, id: &str, state: ForwardState, message: String) {
        let status = ForwardStatus {
            id: id.to_string(),
            state,
            message,
        };
        if let Ok(mut map) = self.status.lock() {
            map.insert(id.to_string(), status.clone());
        }
        let _ = app.emit("forward:status", status);
    }
}
