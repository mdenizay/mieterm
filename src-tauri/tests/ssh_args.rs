//! The argument builder, checked end to end.
//!
//! These are the arguments that decide whether a connection reaches the right host with
//! the right key — the sort of mistake that is invisible in a screenshot and obvious in a
//! diff, so it is pinned here.

use mieterm_lib::models::{AuthMethod, ForwardKind, Host, PortForward};
use mieterm_lib::ssh::{forward_args, split_args, terminal_args};

fn host() -> Host {
    Host {
        id: "h1".into(),
        hostname: "example.com".into(),
        username: "deploy".into(),
        port: 2222,
        ..Default::default()
    }
}

#[test]
fn a_terminal_session_asks_for_a_pty_and_targets_the_host() {
    let args = terminal_args(&host(), 30).unwrap();
    assert!(
        args.contains(&"-t".to_string()),
        "a terminal needs a pty: {args:?}"
    );
    assert_eq!(args.last().unwrap(), "deploy@example.com");
    assert!(args.windows(2).any(|w| w == ["-p", "2222"]));
}

#[test]
fn a_chosen_key_is_not_silently_replaced_by_another() {
    let host = Host {
        auth: AuthMethod::Key,
        key_path: "/keys/id_ed25519".into(),
        ..host()
    };
    let args = terminal_args(&host, 30).unwrap();
    assert!(args.windows(2).any(|w| w == ["-i", "/keys/id_ed25519"]));
    assert!(args.contains(&"IdentitiesOnly=yes".to_string()));
}

#[test]
fn extra_options_reach_the_command_line() {
    let host = Host {
        extra_args: "-J bastion.example.com".into(),
        ..host()
    };
    let args = terminal_args(&host, 30).unwrap();
    assert!(args.windows(2).any(|w| w == ["-J", "bastion.example.com"]));
}

#[test]
fn a_local_forward_binds_only_the_loopback_address() {
    let forward = PortForward {
        kind: ForwardKind::Local,
        local_port: 5433,
        remote_host: "db.internal".into(),
        remote_port: 5432,
        ..Default::default()
    };
    let args = forward_args(&host(), &forward, 30).unwrap();
    // Binding 0.0.0.0 would expose the tunnel to the whole network.
    assert!(
        args.windows(2)
            .any(|w| w == ["-L", "127.0.0.1:5433:db.internal:5432"]),
        "{args:?}"
    );
    assert!(args.contains(&"-N".to_string()));
    assert!(args.contains(&"ExitOnForwardFailure=yes".to_string()));
}

#[test]
fn a_dynamic_forward_is_a_socks_proxy_with_no_destination() {
    let forward = PortForward {
        kind: ForwardKind::Dynamic,
        local_port: 1080,
        ..Default::default()
    };
    let args = forward_args(&host(), &forward, 30).unwrap();
    assert!(
        args.windows(2).any(|w| w == ["-D", "127.0.0.1:1080"]),
        "{args:?}"
    );
}

#[test]
fn a_remote_forward_reverses_the_direction() {
    let forward = PortForward {
        kind: ForwardKind::Remote,
        local_port: 3000,
        remote_host: "127.0.0.1".into(),
        remote_port: 9000,
        ..Default::default()
    };
    let args = forward_args(&host(), &forward, 30).unwrap();
    assert!(
        args.windows(2).any(|w| w == ["-R", "9000:127.0.0.1:3000"]),
        "{args:?}"
    );
}

#[test]
fn quoted_options_survive_splitting() {
    assert_eq!(
        split_args(r#"-o "ProxyCommand=cloudflared access ssh --hostname %h""#),
        vec!["-o", "ProxyCommand=cloudflared access ssh --hostname %h"]
    );
}
