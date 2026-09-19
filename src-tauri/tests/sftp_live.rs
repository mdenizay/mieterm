//! The SFTP client, against a real server.
//!
//! Skipped unless `MIETERM_TEST_SSH_HOST` names one, so a plain `cargo test` on a laptop
//! stays self-contained. CI sets it to a runner-local sshd, which is enough to tell a
//! working handshake, listing and transfer from a broken one — the parts of this module
//! that cannot be judged without a server on the other end.
//!
//! The account must authenticate with a key the agent holds or with a default
//! `~/.ssh/id_*`, which is how the CI job sets it up. `MIETERM_TEST_SSH_KEY` names an
//! explicit key file instead, which is what makes the test usable against a throwaway
//! sshd on a development machine.

use mieterm_lib::models::{AuthMethod, Host};
use mieterm_lib::sftp::SftpManager;

fn test_host() -> Option<Host> {
    let hostname = std::env::var("MIETERM_TEST_SSH_HOST").ok()?;
    Some(Host {
        id: "test".into(),
        hostname,
        port: std::env::var("MIETERM_TEST_SSH_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(22),
        username: std::env::var("MIETERM_TEST_SSH_USER")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_default(),
        auth: match std::env::var("MIETERM_TEST_SSH_KEY") {
            Ok(_) => AuthMethod::Key,
            Err(_) => AuthMethod::Agent,
        },
        key_path: std::env::var("MIETERM_TEST_SSH_KEY").unwrap_or_default(),
        ..Default::default()
    })
}

#[test]
fn browses_and_transfers_over_sftp() {
    let Some(host) = test_host() else {
        eprintln!("MIETERM_TEST_SSH_HOST is not set; skipping the live SFTP test.");
        return;
    };

    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let manager = SftpManager::default();
        let id = manager.connect(&host).await.expect("connect");

        let home = manager.home(&id).await.expect("home directory");
        assert!(home.starts_with('/'), "home should be absolute, got {home}");

        // A directory of our own, so the test never touches anything it did not create.
        let dir = format!("{home}/.mieterm-test-{}", std::process::id());
        manager.make_dir(&id, &dir).await.expect("mkdir");

        let listing = manager.list(&id, &home).await.expect("list home");
        assert!(
            listing.iter().any(|f| f.path == dir && f.is_dir),
            "the new directory should appear in the listing"
        );

        // Upload, read back, and compare: a transfer that truncates or mangles bytes is the
        // failure worth catching, so the payload spans a chunk boundary and is not text.
        let payload: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
        let local = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(local.path(), &payload).unwrap();

        let remote = format!("{dir}/payload.bin");
        let written = manager
            .upload(&id, local.path(), &remote)
            .await
            .expect("upload");
        assert_eq!(written, payload.len() as u64);

        let back = tempfile::NamedTempFile::new().unwrap();
        let read = manager
            .download(&id, &remote, back.path())
            .await
            .expect("download");
        assert_eq!(read, payload.len() as u64);
        assert_eq!(
            std::fs::read(back.path()).unwrap(),
            payload,
            "round trip must be byte-exact"
        );

        let renamed = format!("{dir}/payload-renamed.bin");
        manager
            .rename(&id, &remote, &renamed)
            .await
            .expect("rename");
        let entries = manager.list(&id, &dir).await.expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "payload-renamed.bin");
        assert_eq!(entries[0].size, payload.len() as u64);

        manager
            .remove(&id, &renamed, false)
            .await
            .expect("remove file");
        manager
            .remove(&id, &dir, true)
            .await
            .expect("remove directory");

        manager.disconnect(&id).await;
    });
}

#[test]
fn a_closed_connection_is_reported_rather_than_panicking() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let manager = SftpManager::default();
        // Nothing was ever connected under this id.
        let error = manager.list("no-such-connection", "/").await.unwrap_err();
        assert!(error.message.contains("closed"), "got: {}", error.message);
    });
}
