//! Pins the three known_hosts outcomes the file browser's host-key check depends on.
//!
//! These are russh's semantics, not Mieterm's, and they are easy to get backwards — the
//! first version of `check_server_key` did, which meant a *changed* host key was accepted
//! and a first connection refused. That is the failure this file exists to prevent
//! recurring, so it asserts the library's behaviour rather than our wrapper's.

use russh::keys::known_hosts::check_known_hosts_path;
use russh::keys::PublicKey;
use std::io::Write;

// Two throwaway public keys, written out rather than generated, so the test needs no
// random-number crate and a failing run is always the same run.
const RECORDED: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINjAB7TGpyDkVcK8+9sHbu8wKAPOnti9oADf65LNAc3k";
const PRESENTED: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMnesGoG/NNxMZubeKqptR/zJPc/YXY3bpOx4GbsOh+g";

fn public(openssh: &str) -> PublicKey {
    PublicKey::from_openssh(openssh).expect("test key should parse")
}

fn known_hosts_file(entries: &[(&str, &str)]) -> tempfile::NamedTempFile {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    for (host, key) in entries {
        writeln!(file, "{host} {key}").unwrap();
    }
    file.flush().unwrap();
    file
}

#[test]
fn a_matching_key_is_ok_true() {
    let file = known_hosts_file(&[("[127.0.0.1]:22222", RECORDED)]);
    let result = check_known_hosts_path("127.0.0.1", 22222, &public(RECORDED), file.path());
    assert!(result.unwrap(), "a recorded, matching key must be trusted");
}

#[test]
fn an_unknown_host_is_ok_false_not_an_error() {
    // This is the case Mieterm treats as accept-new. Reading it as an error instead is
    // what broke the first implementation.
    let file = known_hosts_file(&[]);
    let result = check_known_hosts_path("127.0.0.1", 22222, &public(RECORDED), file.path());
    assert!(
        !result.unwrap(),
        "an unseen host must report false, not error"
    );
}

#[test]
fn a_changed_key_is_an_error_not_ok_false() {
    // And this is the case that must be refused.
    let file = known_hosts_file(&[("[127.0.0.1]:22222", RECORDED)]);
    let result = check_known_hosts_path("127.0.0.1", 22222, &public(PRESENTED), file.path());
    assert!(
        result.is_err(),
        "a host key that changed must not be reported as merely unknown"
    );
}

#[test]
fn a_port_is_part_of_the_identity() {
    // known_hosts records a non-default port as [host]:port, so an entry for one port must
    // not vouch for another.
    let file = known_hosts_file(&[("[127.0.0.1]:22222", RECORDED)]);
    let result = check_known_hosts_path("127.0.0.1", 33333, &public(RECORDED), file.path());
    assert!(
        !result.unwrap(),
        "an entry for a different port must not match"
    );
}
