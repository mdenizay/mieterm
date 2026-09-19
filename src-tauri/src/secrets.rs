//! Passwords and key passphrases, in the OS store and nowhere else.
//!
//! keyring maps to the login Keychain on macOS, the Credential Manager on Windows and
//! the Secret Service on Linux, so none of this ever reaches `hosts.json`. The account
//! name encodes what the secret is for, which is what lets one host hold both a login
//! password and a key passphrase.

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.mdenizay.mieterm";

#[derive(Debug, Clone, Copy)]
pub enum SecretKind {
    Password,
    Passphrase,
}

impl SecretKind {
    fn account(self, host_id: &str) -> String {
        match self {
            SecretKind::Password => format!("{host_id}/password"),
            SecretKind::Passphrase => format!("{host_id}/passphrase"),
        }
    }

    pub fn parse(raw: &str) -> AppResult<Self> {
        match raw {
            "password" => Ok(SecretKind::Password),
            "passphrase" => Ok(SecretKind::Passphrase),
            other => Err(AppError::new(format!("Unknown secret kind '{other}'."))),
        }
    }
}

fn entry(kind: SecretKind, host_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, &kind.account(host_id)).map_err(|e| {
        AppError::new("Could not reach this computer's credential store.")
            .with_detail(e.to_string())
    })
}

pub fn set(kind: SecretKind, host_id: &str, secret: &str) -> AppResult<()> {
    if secret.is_empty() {
        return delete(kind, host_id);
    }
    entry(kind, host_id)?.set_password(secret).map_err(|e| {
        AppError::new("Could not save the secret to the credential store.")
            .with_detail(e.to_string())
    })
}

/// `None` rather than an error when nothing is stored: "no password saved" is a normal
/// state for an agent-authenticated host, not a failure.
pub fn get(kind: SecretKind, host_id: &str) -> AppResult<Option<String>> {
    match entry(kind, host_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::new("Could not read the saved secret.").with_detail(e.to_string())),
    }
}

pub fn delete(kind: SecretKind, host_id: &str) -> AppResult<()> {
    match entry(kind, host_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => {
            Err(AppError::new("Could not remove the saved secret.").with_detail(e.to_string()))
        }
    }
}

/// Clears everything stored for a host. Called when the host itself is deleted, so a
/// removed server does not leave its password behind in the keychain.
pub fn forget_host(host_id: &str) {
    let _ = delete(SecretKind::Password, host_id);
    let _ = delete(SecretKind::Passphrase, host_id);
}
