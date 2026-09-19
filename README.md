# Mieterm

A fast, native SSH client and terminal for macOS, Windows and Linux. An open-source
alternative to Termius: saved servers, tabbed terminals, split panes, command broadcast,
port forwarding, SFTP and session recording — with credentials in the OS keychain and
nothing sent anywhere.

Built with [Tauri](https://tauri.app), React and Rust. The whole app is around 12 MB.

## Features

**Servers**

- Saved servers with label, host, port, user, colour, tags and free-form notes
- Three authentication methods:
  - **SSH agent / default keys** — works with your existing `~/.ssh` setup, nothing to configure
  - **Private key** — any key file, with an optional passphrase
  - **Password** — injected at connect time via `SSH_ASKPASS`, never written to disk
- Passwords and passphrases live in the macOS Keychain, Windows Credential Manager or the
  Linux Secret Service. `hosts.json` never contains a secret.
- Per-host **run on connect** command and raw **extra ssh options** (`-J jump`, `-L …`, `ProxyCommand`, …)
- Grouped in the sidebar by their first tag, searchable by anything

**Terminal**

- A real pty per tab, so vim, htop, less and tmux behave exactly as they do in a terminal
- Tabs, plus up to four **split panes** per tab, horizontally or vertically
- **Broadcast**: type once, and it goes to every pane in the tab
- Local shells alongside remote ones, in the same window
- Eight themes (One Dark, Dracula, Nord, Tokyo Night, Solarized Dark/Light, Matrix, Paper),
  configurable font and size, GPU-accelerated rendering
- Search inside the scrollback, clickable links, copy on select

**Beyond the terminal**

- **Snippets** — a palette of saved commands, run into the focused pane (or every pane, under broadcast)
- **Command palette** (<kbd>⌘K</kbd>) — servers, snippets and actions, all from the keyboard
- **One-click copies** — hostname, `user@host`, or the full `ssh` command, straight to the clipboard
- **Tunnel manager** — saved `-L`, `-R` and `-D` forwards, started and stopped with one click,
  with live status, and optionally opened when the app starts
- **SFTP file browser** — editable path bar, upload, download, rename, new folder, delete, hidden-file toggle
- **Session recording** — write terminal output to disk, then search across every recording at once

## Install

Download the latest build for your platform from
[Releases](https://github.com/mdenizay/mieterm/releases/latest):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon and Intel) | `.dmg` |
| Windows | `.exe` installer |
| Linux | `.AppImage`, `.deb` or `.rpm` |

Mieterm checks for updates on launch and installs them in place.

### Requirements

Mieterm runs the system `ssh` client for terminals and tunnels. macOS and Linux always
have one. Windows has shipped OpenSSH since Windows 10 — if it is missing, add it from
**Settings › Apps › Optional Features › OpenSSH Client**.

## Build from source

```bash
git clone https://github.com/mdenizay/mieterm.git
cd mieterm
npm install
npm run app:dev      # run it
npm run app:build    # produce an installer for the current platform
```

Needs Node 20+ and a stable Rust toolchain. On Linux, also the WebKitGTK development
headers — see [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

Two design decisions explain most of the codebase.

**Terminals run through the system `ssh`, inside a real pty.** Mieterm does not implement
the SSH protocol for its terminals. It spawns OpenSSH the way a shell would, which means
`~/.ssh/config`, ssh-agent, hardware keys, jump hosts, `ProxyCommand` and `known_hosts`
all apply unchanged — host key verification is OpenSSH's, not a reimplementation of it,
and a key that already works in your terminal works here without being described again.
The pty is what makes full-screen programs behave and lets ssh prompt for a fingerprint
the way it normally would.

**The file browser speaks SFTP itself.** A terminal session is a byte stream; a file list
is not, and OpenSSH offers no structured interface to a host program. So the browser opens
its own connection with [russh](https://github.com/Eugeny/russh) and runs the sftp
subsystem over it. It still checks host keys against the same `~/.ssh/known_hosts`, so the
two stacks agree about which server they trust.

Output crosses the IPC boundary as base64 rather than text, because a pty read can land
in the middle of a UTF-8 or escape sequence; xterm.js takes the bytes and decodes them
itself.

### Where your data lives

| What | Where |
| --- | --- |
| Servers, snippets, tunnels, settings | `hosts.json` and friends, in the app data folder |
| Passwords and key passphrases | The OS credential store, under `com.mdenizay.mieterm` |
| Session recordings | `recordings/` in the app data folder |

The app data folder is `~/Library/Application Support/Mieterm` on macOS,
`%APPDATA%\Mieterm` on Windows and `~/.local/share/Mieterm` on Linux. Settings › About
shows the exact path. Nothing is sent anywhere except to the servers you connect to.

## Keyboard

| | |
| --- | --- |
| <kbd>⌘K</kbd> | Command palette |
| <kbd>⌘T</kbd> | New local terminal |
| <kbd>⌘W</kbd> | Close the focused pane |
| <kbd>⌘D</kbd> / <kbd>⇧⌘D</kbd> | Split right / split down |
| <kbd>⌘F</kbd> | Search the scrollback |
| <kbd>⌘1</kbd>–<kbd>⌘9</kbd> | Switch tab |
| <kbd>⌘+</kbd> / <kbd>⌘−</kbd> | Font size |
| <kbd>⌘,</kbd> | Settings |

Use <kbd>Ctrl</kbd> instead of <kbd>⌘</kbd> on Windows and Linux.

## Known limits

- **Saved passwords on Windows.** `ssh.exe` ignores `SSH_ASKPASS`, so a saved password
  cannot be injected there. Mieterm gives ssh a real pty, so it prompts in the terminal and
  you type it — or use a key, which is better anyway.
- **The file browser needs its own credentials.** It cannot read `~/.ssh/config`, so a host
  that relies on a config-file `IdentityFile` or `User` will connect in the terminal but may
  not in the file browser. Name the key on the server row to fix it.
- **Certificate authentication** works in the terminal (OpenSSH handles it) but not in the
  file browser.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome.

## Licence

MIT — see [LICENSE](LICENSE).
