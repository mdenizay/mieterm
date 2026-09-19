# Contributing to Mieterm

Thanks for taking a look. Issues and pull requests are both welcome.

## Getting set up

You need Node 20+ and a stable Rust toolchain.

```bash
npm install
npm run app:dev
```

On Linux, Tauri also needs the WebKitGTK development headers:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

## Before you open a pull request

CI runs these on macOS, Linux and Windows, so running them first saves a round trip:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run build        # type-checks with tsc, then bundles
```

## Layout

```
src/                  React UI
  components/         One file per panel or dialog
  lib/                IPC wrapper, types, themes, i18n, the session event bus
src-tauri/src/
  ssh.rs              Builds the argument list for the system ssh
  pty.rs              Terminal sessions: a pty per tab, streamed to the webview
  sftp.rs             The file browser's own SSH connection
  forwards.rs         Saved tunnels, started and stopped as ssh -N processes
  recording.rs        Session logs, and the search across them
  secrets.rs          The OS credential store
  storage.rs          The JSON files in the app data folder
  commands.rs         Every IPC entry point
```

## Things worth knowing

- **Terminals go through the system `ssh`, not a Rust SSH library.** That is deliberate, and
  the reasoning is in the module comment at the top of `ssh.rs`. It is what makes
  `~/.ssh/config`, agents, jump hosts and `known_hosts` work without being reimplemented.
- **Secrets never touch `hosts.json`.** If you add a field that could hold one, put it in
  `secrets.rs` instead.
- **Terminal bytes are not text.** Output crosses IPC as base64 in both directions; decoding
  it anywhere in between corrupts multi-byte and escape sequences.
- **Error messages are shown verbatim to users.** A new `AppError` should read as a sentence
  someone can act on, with the underlying cause in `with_detail`.
- **Comments explain why, not what.** If a line needs a comment to say what it does, the line
  is probably the thing to change.

## Adding a language

`src/lib/i18n.ts` holds one flat dictionary per language. Copy the `en` object, translate
the values, and add it to `DICTIONARIES` and to the language picker in `SettingsDialog`.
A missing key falls back to English rather than rendering blank.

## Releasing

Tag a version and the release workflow builds and publishes for all three platforms:

```bash
# Bump the version in package.json and src-tauri/tauri.conf.json first — CI checks they match.
git tag v1.1.0 && git push origin v1.1.0
```

The release is drafted until every platform's artifacts land, then published automatically.
