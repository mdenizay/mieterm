//! Builds the argument list for the system `ssh`, and the helper that feeds it a password.
//!
//! Mieterm drives OpenSSH rather than speaking the protocol itself for the terminal. That
//! means `~/.ssh/config`, ssh-agent, hardware keys, jump hosts, ProxyCommand and
//! known_hosts all apply exactly as they do in a shell: host key verification is
//! OpenSSH's, not a reimplementation of it, and a key that already works in a terminal
//! works here without being described a second time.
//!
//! The cost is a dependency on an `ssh` binary. macOS and Linux always have one, Windows
//! has shipped OpenSSH since Windows 10, and a missing one is reported plainly.

use crate::error::{AppError, AppResult};
use crate::models::{AuthMethod, ForwardKind, Host, PortForward};
use std::path::PathBuf;

pub fn find_ssh() -> Option<PathBuf> {
    let name = if cfg!(windows) { "ssh.exe" } else { "ssh" };
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.is_file())
    })
}

pub fn require_ssh() -> AppResult<PathBuf> {
    find_ssh().ok_or_else(|| {
        AppError::new("No ssh client was found on this computer.").with_detail(
            "Mieterm runs the system ssh command. macOS and Linux include one; on Windows, \
             install the OpenSSH Client from Settings › Apps › Optional Features.",
        )
    })
}

/// Splits a raw extra-arguments string the way a shell would, honouring quotes so a
/// ProxyCommand with spaces survives. Not a full shell parser — there is no expansion
/// here, deliberately: these arguments go straight to exec, never through a shell.
pub fn split_args(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut has_token = false;

    for ch in raw.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                has_token = true;
            }
            None if ch.is_whitespace() => {
                if has_token {
                    out.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            None => {
                current.push(ch);
                has_token = true;
            }
        }
    }
    if has_token {
        out.push(current);
    }
    out
}

/// The arguments common to every connection Mieterm makes to a host.
fn base_args(host: &Host, keepalive: u32) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        host.port.to_string(),
        "-o".into(),
        format!("ServerAliveInterval={}", keepalive.max(5)),
        // A first connection should not stop on a fingerprint question nobody can answer
        // from a GUI; afterwards the key is pinned and a change is refused as usual.
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
    ];

    match host.auth {
        AuthMethod::Key if !host.key_path.is_empty() => {
            args.push("-i".into());
            args.push(host.key_path.clone());
            // With an explicit key chosen, do not quietly succeed with a different one.
            args.push("-o".into());
            args.push("IdentitiesOnly=yes".into());
        }
        AuthMethod::Password => {
            // Offering keys first makes ssh burn through the agent's identities before it
            // reaches the password the user actually configured.
            args.push("-o".into());
            args.push("PreferredAuthentications=password,keyboard-interactive".into());
            args.push("-o".into());
            args.push("PubkeyAuthentication=no".into());
        }
        _ => {}
    }

    args.extend(split_args(&host.extra_args));
    args
}

/// Argument list for an interactive terminal session.
pub fn terminal_args(host: &Host, keepalive: u32) -> AppResult<Vec<String>> {
    if host.hostname.trim().is_empty() {
        return Err(AppError::new("This server has no hostname yet."));
    }
    let mut args = base_args(host, keepalive);
    // Force a PTY: without it, `ssh host command` runs without one and full-screen
    // programs misbehave. We always have a real PTY on our side to give it.
    args.push("-t".into());
    args.push(host.target());
    Ok(args)
}

/// Argument list for a port forward: no remote command, no PTY, and a loud failure if the
/// port cannot be bound rather than a tunnel that silently forwards nothing.
pub fn forward_args(host: &Host, forward: &PortForward, keepalive: u32) -> AppResult<Vec<String>> {
    if host.hostname.trim().is_empty() {
        return Err(AppError::new("This server has no hostname yet."));
    }
    let mut args = base_args(host, keepalive);
    args.push("-N".into());
    args.push("-T".into());
    args.push("-o".into());
    args.push("ExitOnForwardFailure=yes".into());

    match forward.kind {
        ForwardKind::Local => {
            args.push("-L".into());
            args.push(format!(
                "127.0.0.1:{}:{}:{}",
                forward.local_port, forward.remote_host, forward.remote_port
            ));
        }
        ForwardKind::Remote => {
            args.push("-R".into());
            args.push(format!(
                "{}:{}:{}",
                forward.remote_port, forward.remote_host, forward.local_port
            ));
        }
        ForwardKind::Dynamic => {
            args.push("-D".into());
            args.push(format!("127.0.0.1:{}", forward.local_port));
        }
    }

    args.push(host.target());
    Ok(args)
}

/// A file that prints the password when ssh runs it as SSH_ASKPASS.
///
/// The alternative — typing into the pty when a prompt appears — means pattern-matching
/// server-controlled output and racing it. SSH_ASKPASS is the supported path, the file is
/// readable only by this user, and `AskPassGuard` deletes it as soon as the session that
/// needed it is up.
pub struct AskPassGuard {
    pub path: PathBuf,
}

impl Drop for AskPassGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(unix)]
pub fn write_askpass(password: &str) -> AppResult<AskPassGuard> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let path = std::env::temp_dir().join(format!("mieterm-askpass-{}", uuid::Uuid::new_v4()));
    let mut file = std::fs::File::create(&path).map_err(|e| {
        AppError::new("Could not prepare the SSH password helper.").with_detail(e.to_string())
    })?;
    // Single-quoted with any embedded quote escaped, so a password containing shell
    // metacharacters is data rather than a command.
    let escaped = password.replace('\'', "'\\''");
    writeln!(file, "#!/bin/sh\nprintf '%s\\n' '{escaped}'").map_err(|e| {
        AppError::new("Could not write the SSH password helper.").with_detail(e.to_string())
    })?;
    drop(file);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).map_err(|e| {
        AppError::new("Could not secure the SSH password helper.").with_detail(e.to_string())
    })?;
    Ok(AskPassGuard { path })
}

#[cfg(windows)]
pub fn write_askpass(_password: &str) -> AppResult<AskPassGuard> {
    // Windows ssh.exe ignores SSH_ASKPASS. It does prompt inside the pty, though, and
    // Mieterm gives it a real one — so the password is typed in the terminal instead of
    // injected. Callers treat this error as "let it prompt", not as a failure.
    Err(AppError::new(
        "Saved passwords cannot be injected on Windows; ssh will ask in the terminal.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_plain_arguments() {
        assert_eq!(
            split_args("-J jump -L 8080:localhost:80"),
            vec!["-J", "jump", "-L", "8080:localhost:80"]
        );
    }

    #[test]
    fn keeps_quoted_arguments_whole() {
        assert_eq!(
            split_args(r#"-o "ProxyCommand=nc -X 5 %h %p""#),
            vec!["-o", "ProxyCommand=nc -X 5 %h %p"]
        );
    }

    #[test]
    fn empty_input_yields_no_arguments() {
        assert!(split_args("   ").is_empty());
    }

    #[test]
    fn password_hosts_do_not_offer_keys_first() {
        let host = Host {
            hostname: "example.com".into(),
            username: "root".into(),
            auth: AuthMethod::Password,
            ..Default::default()
        };
        let args = terminal_args(&host, 30).unwrap();
        assert!(args.iter().any(|a| a == "PubkeyAuthentication=no"));
        assert_eq!(args.last().unwrap(), "root@example.com");
    }

    #[test]
    fn a_host_without_a_hostname_is_rejected() {
        assert!(terminal_args(&Host::default(), 30).is_err());
    }
}
