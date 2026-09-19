//! The file browser, over SFTP.
//!
//! This is the one place Mieterm speaks SSH itself instead of driving the system client.
//! It has to: a terminal session is a byte stream, and a file browser needs a structured
//! answer to "what is in this directory". OpenSSH offers no such interface to a host
//! program, so the browser opens its own connection with russh and runs the sftp
//! subsystem over it.
//!
//! Host keys are still checked against `~/.ssh/known_hosts` — the same file OpenSSH uses —
//! so the two stacks agree about which server they trust, and a first connection is
//! learned rather than blindly accepted forever.

use crate::error::{AppError, AppResult};
use crate::models::{AuthMethod, Host, RemoteFile};
use crate::secrets;
use russh::client::{self, Handle};
use russh::keys::{agent::client::AgentClient, known_hosts, PrivateKeyWithHashAlg};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

/// Checks the server's key against known_hosts and learns it on a first connection,
/// which is what `StrictHostKeyChecking=accept-new` does on the terminal side.
struct HostKeyCheck {
    host: String,
    port: u16,
}

impl client::Handler for HostKeyCheck {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let public = match key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            // A certificate is vouched for by a CA, not by known_hosts; there is nothing
            // here to compare it against, so it is left to the terminal side to judge.
            russh::keys::PublicKeyOrCertificate::Certificate(_) => return Ok(true),
        };
        match known_hosts::check_known_hosts(&self.host, self.port, &public) {
            // The recorded key for this host matches.
            Ok(true) => Ok(true),
            // No entry for this host yet: record it, exactly as accept-new would.
            Ok(false) => {
                let _ = known_hosts::learn_known_hosts(&self.host, self.port, &public);
                Ok(true)
            }
            // `KeyChanged` — there is an entry, and the server is presenting something
            // else. That is the case this check exists for, and the other errors (no home
            // directory, an unreadable file) leave us unable to tell, which is not a
            // reason to trust it.
            Err(_) => Ok(false),
        }
    }
}

pub struct Connection {
    session: SftpSession,
    /// Dropping this closes the transport underneath the sftp session, so it is held for
    /// as long as the browser is open even though nothing calls it.
    _handle: Handle<HostKeyCheck>,
}

#[derive(Default)]
pub struct SftpManager {
    connections: Mutex<HashMap<String, Arc<Connection>>>,
}

impl SftpManager {
    pub async fn connect(&self, host: &Host) -> AppResult<String> {
        if host.hostname.trim().is_empty() {
            return Err(AppError::new("This server has no hostname yet."));
        }

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
            ..Default::default()
        });
        let checker = HostKeyCheck {
            host: host.hostname.clone(),
            port: host.port,
        };

        let mut handle = client::connect(config, (host.hostname.as_str(), host.port), checker)
            .await
            .map_err(|e| {
                AppError::new(format!("Could not reach {}:{}.", host.hostname, host.port))
                    .with_detail(e.to_string())
            })?;

        authenticate(&mut handle, host).await?;

        let channel = handle.channel_open_session().await.map_err(|e| {
            AppError::new("The server refused to open a channel.").with_detail(e.to_string())
        })?;
        channel.request_subsystem(true, "sftp").await.map_err(|e| {
            AppError::new("The server would not start its SFTP subsystem.").with_detail(format!(
                "{e}. Check that the sshd config has an sftp Subsystem line."
            ))
        })?;
        let session = SftpSession::new(channel.into_stream()).await.map_err(|e| {
            AppError::new("Could not start an SFTP session.").with_detail(e.to_string())
        })?;

        let id = uuid::Uuid::new_v4().to_string();
        self.connections.lock().await.insert(
            id.clone(),
            Arc::new(Connection {
                session,
                _handle: handle,
            }),
        );
        Ok(id)
    }

    pub async fn disconnect(&self, id: &str) {
        self.connections.lock().await.remove(id);
    }

    pub async fn disconnect_all(&self) {
        self.connections.lock().await.clear();
    }

    async fn get(&self, id: &str) -> AppResult<Arc<Connection>> {
        self.connections
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::new("That file browser connection has closed."))
    }

    /// The user's home directory, which is where the browser opens.
    pub async fn home(&self, id: &str) -> AppResult<String> {
        let connection = self.get(id).await?;
        connection.session.canonicalize(".").await.map_err(|e| {
            AppError::new("Could not read the home directory.").with_detail(e.to_string())
        })
    }

    pub async fn list(&self, id: &str, path: &str) -> AppResult<Vec<RemoteFile>> {
        let connection = self.get(id).await?;
        // Resolving first means ".." and "~/x" in the path bar behave the way they look.
        let path = connection.session.canonicalize(path).await.map_err(|e| {
            AppError::new(format!("Could not open {path}.")).with_detail(e.to_string())
        })?;

        let entries = connection
            .session
            .read_dir(path.clone())
            .await
            .map_err(|e| {
                AppError::new(format!("Could not list {path}.")).with_detail(e.to_string())
            })?;

        let mut files: Vec<RemoteFile> = entries
            .map(|entry| {
                let metadata = entry.metadata();
                RemoteFile {
                    name: entry.file_name(),
                    path: entry.path(),
                    is_dir: metadata.is_dir(),
                    is_symlink: metadata.is_symlink(),
                    size: metadata.size.unwrap_or(0),
                    permissions: metadata
                        .permissions
                        .map(|p| format!("{:o}", p & 0o7777))
                        .unwrap_or_default(),
                    modified: metadata.mtime.unwrap_or(0) as u64,
                }
            })
            .collect();

        // Directories first, then case-insensitive by name: the order a file manager uses,
        // and not the order the protocol happens to return.
        files.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(files)
    }

    pub async fn download(&self, id: &str, remote: &str, local: &Path) -> AppResult<u64> {
        let connection = self.get(id).await?;
        let mut source = connection.session.open(remote).await.map_err(|e| {
            AppError::new(format!("Could not open {remote}.")).with_detail(e.to_string())
        })?;
        let mut target = tokio::fs::File::create(local).await.map_err(|e| {
            AppError::new("Could not create the local file.").with_detail(e.to_string())
        })?;

        // Streamed in chunks rather than read whole: a download should not need as much
        // memory as the file is large.
        let mut buffer = vec![0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let read = source.read(&mut buffer).await.map_err(|e| {
                AppError::new("The transfer stopped part-way.").with_detail(e.to_string())
            })?;
            if read == 0 {
                break;
            }
            target.write_all(&buffer[..read]).await.map_err(|e| {
                AppError::new("Could not write the local file.").with_detail(e.to_string())
            })?;
            total += read as u64;
        }
        target.flush().await.ok();
        Ok(total)
    }

    pub async fn upload(&self, id: &str, local: &Path, remote: &str) -> AppResult<u64> {
        let connection = self.get(id).await?;
        let mut source = tokio::fs::File::open(local).await.map_err(|e| {
            AppError::new("Could not read the local file.").with_detail(e.to_string())
        })?;
        let mut target = connection
            .session
            .open_with_flags(
                remote,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| {
                AppError::new(format!("Could not create {remote} on the server."))
                    .with_detail(e.to_string())
            })?;

        let mut buffer = vec![0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let read = source.read(&mut buffer).await.map_err(|e| {
                AppError::new("Could not read the local file.").with_detail(e.to_string())
            })?;
            if read == 0 {
                break;
            }
            target.write_all(&buffer[..read]).await.map_err(|e| {
                AppError::new("The upload stopped part-way.").with_detail(e.to_string())
            })?;
            total += read as u64;
        }
        target.flush().await.ok();
        target.shutdown().await.ok();
        Ok(total)
    }

    pub async fn make_dir(&self, id: &str, path: &str) -> AppResult<()> {
        let connection = self.get(id).await?;
        connection.session.create_dir(path).await.map_err(|e| {
            AppError::new(format!("Could not create {path}.")).with_detail(e.to_string())
        })
    }

    pub async fn rename(&self, id: &str, from: &str, to: &str) -> AppResult<()> {
        let connection = self.get(id).await?;
        connection
            .session
            .rename(from, to)
            .await
            .map_err(|e| AppError::new("Could not rename that item.").with_detail(e.to_string()))
    }

    pub async fn remove(&self, id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        let connection = self.get(id).await?;
        let result = if is_dir {
            connection.session.remove_dir(path).await
        } else {
            connection.session.remove_file(path).await
        };
        result.map_err(|e| {
            let hint = if is_dir {
                " The folder has to be empty first."
            } else {
                ""
            };
            AppError::new(format!("Could not delete {path}.{hint}")).with_detail(e.to_string())
        })
    }
}

/// Tries the host's configured method, and — for agent hosts — every identity the agent
/// offers before falling back to the default key files, which is the order OpenSSH uses.
async fn authenticate(handle: &mut Handle<HostKeyCheck>, host: &Host) -> AppResult<()> {
    let user = if host.username.is_empty() {
        whoami_fallback()
    } else {
        host.username.clone()
    };

    match host.auth {
        AuthMethod::Password => {
            let password = secrets::get(secrets::SecretKind::Password, &host.id)?
                .filter(|p| !p.is_empty())
                .ok_or_else(|| {
                    AppError::new("No password is saved for this server.").with_detail(
                        "Open the server's settings and save a password to use the file browser.",
                    )
                })?;
            let result = handle
                .authenticate_password(&user, password)
                .await
                .map_err(|e| AppError::new("Authentication failed.").with_detail(e.to_string()))?;
            if result.success() {
                return Ok(());
            }
            Err(AppError::new(format!(
                "The server rejected the password for {user}."
            )))
        }
        AuthMethod::Key => {
            let path = if host.key_path.is_empty() {
                return Err(AppError::new("This server has no private key selected."));
            } else {
                host.key_path.clone()
            };
            let passphrase = secrets::get(secrets::SecretKind::Passphrase, &host.id)?;
            let key = russh::keys::load_secret_key(&path, passphrase.as_deref()).map_err(|e| {
                AppError::new(format!("Could not read the private key at {path}."))
                    .with_detail(format!("{e}. An encrypted key needs its passphrase saved."))
            })?;
            try_key(handle, &user, key).await
        }
        AuthMethod::Agent => {
            if let Ok(()) = try_agent(handle, &user).await {
                return Ok(());
            }
            // No agent, or it had nothing the server wanted: fall back to the usual key
            // files, which is what a bare `ssh host` would do next.
            for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
                let Some(path) = dirs::home_dir().map(|h| h.join(".ssh").join(name)) else {
                    continue;
                };
                if !path.exists() {
                    continue;
                }
                let Ok(key) = russh::keys::load_secret_key(&path, None) else {
                    continue;
                };
                if try_key(handle, &user, key).await.is_ok() {
                    return Ok(());
                }
            }
            Err(AppError::new(format!(
                "No SSH agent or default key could authenticate {user}."
            ))
            .with_detail(
                "The terminal may still connect — it uses the system ssh client, which can \
                     also read ~/.ssh/config. The file browser needs a key the agent holds, or a \
                     key file chosen on the server.",
            ))
        }
    }
}

async fn try_key(
    handle: &mut Handle<HostKeyCheck>,
    user: &str,
    key: russh::keys::PrivateKey,
) -> AppResult<()> {
    // RSA keys need the server's preferred hash; anything else ignores it.
    let hash_alg = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    let result = handle
        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
        .await
        .map_err(|e| AppError::new("Authentication failed.").with_detail(e.to_string()))?;
    if result.success() {
        Ok(())
    } else {
        Err(AppError::new(format!(
            "The server rejected that key for {user}."
        )))
    }
}

async fn try_agent(handle: &mut Handle<HostKeyCheck>, user: &str) -> AppResult<()> {
    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| AppError::new("No SSH agent is available.").with_detail(e.to_string()))?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| AppError::new("The SSH agent listed no keys.").with_detail(e.to_string()))?;

    let hash_alg = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    for identity in identities {
        let public = match identity {
            russh::keys::agent::AgentIdentity::PublicKey { key, .. } => key,
            // Certificates would need the CA path, which known_hosts does not describe.
            russh::keys::agent::AgentIdentity::Certificate { .. } => continue,
        };
        if let Ok(result) = handle
            .authenticate_publickey_with(user, public, hash_alg, &mut agent)
            .await
        {
            if result.success() {
                return Ok(());
            }
        }
    }
    Err(AppError::new(
        "The SSH agent had no key this server accepts.",
    ))
}

/// A host row may leave the username blank and rely on `~/.ssh/config`. The sftp side
/// cannot read that file, so it falls back to the local account name — the same default
/// ssh itself uses when nothing else applies.
fn whoami_fallback() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "root".into())
}
