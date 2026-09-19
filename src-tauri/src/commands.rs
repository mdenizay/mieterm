//! Every IPC entry point.
//!
//! These are deliberately thin: validate what came from the webview, hand it to the
//! module that owns the behaviour, and let `AppError` carry a sentence back. Nothing here
//! holds state — the managers in `state` do.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::{forwards, pty, recording, secrets, sftp, ssh, storage};
use base64::Engine;
use std::path::PathBuf;
use tauri::{AppHandle, State};

type Managers<'a> = (
    State<'a, pty::SessionManager>,
    State<'a, forwards::ForwardManager>,
    State<'a, sftp::SftpManager>,
);

// ---------------------------------------------------------------- hosts

#[tauri::command]
pub fn list_hosts() -> AppResult<Vec<Host>> {
    storage::load_hosts()
}

#[tauri::command]
pub fn save_host(mut host: Host) -> AppResult<Host> {
    if host.hostname.trim().is_empty() {
        return Err(AppError::new("A server needs a hostname."));
    }
    if host.id.is_empty() {
        host.id = uuid::Uuid::new_v4().to_string();
    }
    host.tags = host
        .tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    let mut hosts = storage::load_hosts()?;
    match hosts.iter_mut().find(|h| h.id == host.id) {
        Some(existing) => *existing = host.clone(),
        None => hosts.push(host.clone()),
    }
    storage::save_hosts(&hosts)?;
    Ok(host)
}

#[tauri::command]
pub fn delete_host(id: String) -> AppResult<()> {
    let mut hosts = storage::load_hosts()?;
    hosts.retain(|h| h.id != id);
    storage::save_hosts(&hosts)?;

    // A deleted server should not leave its password in the keychain, or its tunnels in
    // the forward list pointing at nothing.
    secrets::forget_host(&id);
    let mut forwards = storage::load_forwards()?;
    forwards.retain(|f| f.host_id != id);
    storage::save_forwards(&forwards)
}

/// Reorders the list to match what the user dragged in the sidebar.
#[tauri::command]
pub fn reorder_hosts(ids: Vec<String>) -> AppResult<Vec<Host>> {
    let hosts = storage::load_hosts()?;
    let mut ordered: Vec<Host> = ids
        .iter()
        .filter_map(|id| hosts.iter().find(|h| &h.id == id).cloned())
        .collect();
    // Anything the frontend did not mention keeps its place at the end, so a stale list
    // cannot silently drop a server.
    ordered.extend(hosts.into_iter().filter(|h| !ids.contains(&h.id)));
    storage::save_hosts(&ordered)?;
    Ok(ordered)
}

// ---------------------------------------------------------------- secrets

#[tauri::command]
pub fn set_secret(host_id: String, kind: String, secret: String) -> AppResult<()> {
    secrets::set(secrets::SecretKind::parse(&kind)?, &host_id, &secret)
}

#[tauri::command]
pub fn has_secret(host_id: String, kind: String) -> AppResult<bool> {
    Ok(secrets::get(secrets::SecretKind::parse(&kind)?, &host_id)?.is_some())
}

#[tauri::command]
pub fn delete_secret(host_id: String, kind: String) -> AppResult<()> {
    secrets::delete(secrets::SecretKind::parse(&kind)?, &host_id)
}

// ---------------------------------------------------------------- snippets

#[tauri::command]
pub fn list_snippets() -> AppResult<Vec<Snippet>> {
    storage::load_snippets()
}

#[tauri::command]
pub fn save_snippet(mut snippet: Snippet) -> AppResult<Snippet> {
    if snippet.command.trim().is_empty() {
        return Err(AppError::new("A snippet needs a command."));
    }
    if snippet.name.trim().is_empty() {
        snippet.name = snippet
            .command
            .lines()
            .next()
            .unwrap_or("Snippet")
            .to_string();
    }
    if snippet.id.is_empty() {
        snippet.id = uuid::Uuid::new_v4().to_string();
    }
    let mut snippets = storage::load_snippets()?;
    match snippets.iter_mut().find(|s| s.id == snippet.id) {
        Some(existing) => *existing = snippet.clone(),
        None => snippets.push(snippet.clone()),
    }
    storage::save_snippets(&snippets)?;
    Ok(snippet)
}

#[tauri::command]
pub fn delete_snippet(id: String) -> AppResult<()> {
    let mut snippets = storage::load_snippets()?;
    snippets.retain(|s| s.id != id);
    storage::save_snippets(&snippets)
}

// ---------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings() -> AppResult<Settings> {
    storage::load_settings()
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> AppResult<Settings> {
    storage::save_settings(&settings)?;
    Ok(settings)
}

// ---------------------------------------------------------------- terminal sessions

#[tauri::command]
pub fn open_session(
    app: AppHandle,
    managers: State<'_, pty::SessionManager>,
    id: String,
    host_id: Option<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> AppResult<()> {
    let settings = storage::load_settings()?;
    match host_id {
        Some(host_id) => {
            let hosts = storage::load_hosts()?;
            let host = hosts
                .into_iter()
                .find(|h| h.id == host_id)
                .ok_or_else(|| AppError::new("That server is no longer saved."))?;
            managers.open(
                &app,
                pty::OpenRequest {
                    id,
                    host: Some(&host),
                    cols,
                    rows,
                    cwd,
                },
                &settings,
            )
        }
        None => managers.open(
            &app,
            pty::OpenRequest {
                id,
                host: None,
                cols,
                rows,
                cwd,
            },
            &settings,
        ),
    }
}

/// Input arrives base64-encoded for the same reason output leaves that way: it is bytes,
/// not text, and a paste can carry anything.
#[tauri::command]
pub fn write_session(
    managers: State<'_, pty::SessionManager>,
    id: String,
    data: String,
) -> AppResult<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| {
            AppError::new("That input could not be decoded.").with_detail(e.to_string())
        })?;
    managers.write(&id, &bytes)
}

/// Sends the same text to several sessions at once — the broadcast feature.
#[tauri::command]
pub fn broadcast_session(
    managers: State<'_, pty::SessionManager>,
    ids: Vec<String>,
    data: String,
) -> AppResult<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| {
            AppError::new("That input could not be decoded.").with_detail(e.to_string())
        })?;
    // A session that closed mid-broadcast should not abort the rest of them.
    for id in ids {
        let _ = managers.write(&id, &bytes);
    }
    Ok(())
}

#[tauri::command]
pub fn resize_session(
    managers: State<'_, pty::SessionManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    managers.resize(&id, cols, rows)
}

#[tauri::command]
pub fn close_session(managers: State<'_, pty::SessionManager>, id: String) -> AppResult<()> {
    managers.close(&id)
}

#[tauri::command]
pub fn session_is_open(managers: State<'_, pty::SessionManager>, id: String) -> bool {
    managers.is_open(&id)
}

// ---------------------------------------------------------------- port forwards

#[tauri::command]
pub fn list_forwards() -> AppResult<Vec<PortForward>> {
    storage::load_forwards()
}

#[tauri::command]
pub fn save_forward(mut forward: PortForward) -> AppResult<PortForward> {
    if forward.local_port == 0 {
        return Err(AppError::new("A tunnel needs a port number."));
    }
    if forward.kind != ForwardKind::Dynamic && forward.remote_host.trim().is_empty() {
        return Err(AppError::new("A tunnel needs a destination host."));
    }
    if forward.id.is_empty() {
        forward.id = uuid::Uuid::new_v4().to_string();
    }
    let mut forwards = storage::load_forwards()?;
    match forwards.iter_mut().find(|f| f.id == forward.id) {
        Some(existing) => *existing = forward.clone(),
        None => forwards.push(forward.clone()),
    }
    storage::save_forwards(&forwards)?;
    Ok(forward)
}

#[tauri::command]
pub fn delete_forward(
    app: AppHandle,
    manager: State<'_, forwards::ForwardManager>,
    id: String,
) -> AppResult<()> {
    manager.stop(&app, &id)?;
    let mut forwards = storage::load_forwards()?;
    forwards.retain(|f| f.id != id);
    storage::save_forwards(&forwards)
}

#[tauri::command]
pub fn start_forward(
    app: AppHandle,
    manager: State<'_, forwards::ForwardManager>,
    id: String,
) -> AppResult<()> {
    let forward = storage::load_forwards()?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| AppError::new("That tunnel is no longer saved."))?;
    let host = storage::load_hosts()?
        .into_iter()
        .find(|h| h.id == forward.host_id)
        .ok_or_else(|| AppError::new("The server this tunnel belongs to is gone."))?;
    let settings = storage::load_settings()?;
    manager.start(&app, &host, &forward, &settings)
}

#[tauri::command]
pub fn stop_forward(
    app: AppHandle,
    manager: State<'_, forwards::ForwardManager>,
    id: String,
) -> AppResult<()> {
    manager.stop(&app, &id)
}

#[tauri::command]
pub fn forward_statuses(
    manager: State<'_, forwards::ForwardManager>,
) -> Vec<forwards::ForwardStatus> {
    manager.statuses()
}

// ---------------------------------------------------------------- SFTP

#[tauri::command]
pub async fn sftp_connect(
    manager: State<'_, sftp::SftpManager>,
    host_id: String,
) -> AppResult<String> {
    let host = storage::load_hosts()?
        .into_iter()
        .find(|h| h.id == host_id)
        .ok_or_else(|| AppError::new("That server is no longer saved."))?;
    manager.connect(&host).await
}

#[tauri::command]
pub async fn sftp_disconnect(manager: State<'_, sftp::SftpManager>, id: String) -> AppResult<()> {
    manager.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_home(manager: State<'_, sftp::SftpManager>, id: String) -> AppResult<String> {
    manager.home(&id).await
}

#[tauri::command]
pub async fn sftp_list(
    manager: State<'_, sftp::SftpManager>,
    id: String,
    path: String,
) -> AppResult<Vec<RemoteFile>> {
    manager.list(&id, &path).await
}

#[tauri::command]
pub async fn sftp_download(
    manager: State<'_, sftp::SftpManager>,
    id: String,
    remote: String,
    local: String,
) -> AppResult<u64> {
    manager.download(&id, &remote, &PathBuf::from(local)).await
}

#[tauri::command]
pub async fn sftp_upload(
    manager: State<'_, sftp::SftpManager>,
    id: String,
    local: String,
    remote: String,
) -> AppResult<u64> {
    manager.upload(&id, &PathBuf::from(local), &remote).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    manager: State<'_, sftp::SftpManager>,
    id: String,
    path: String,
) -> AppResult<()> {
    manager.make_dir(&id, &path).await
}

#[tauri::command]
pub async fn sftp_rename(
    manager: State<'_, sftp::SftpManager>,
    id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    manager.rename(&id, &from, &to).await
}

#[tauri::command]
pub async fn sftp_remove(
    manager: State<'_, sftp::SftpManager>,
    id: String,
    path: String,
    is_dir: bool,
) -> AppResult<()> {
    manager.remove(&id, &path, is_dir).await
}

// ---------------------------------------------------------------- recordings

#[tauri::command]
pub fn list_recordings() -> AppResult<Vec<Recording>> {
    recording::list()
}

#[tauri::command]
pub fn read_recording(id: String) -> AppResult<String> {
    recording::read(&id)
}

#[tauri::command]
pub fn delete_recording(id: String) -> AppResult<()> {
    recording::delete(&id)
}

#[tauri::command]
pub fn search_recordings(query: String) -> AppResult<Vec<RecordingMatch>> {
    recording::search(&query, 500)
}

// ---------------------------------------------------------------- diagnostics

/// What the About panel shows, and the first thing to check when a connection will not
/// open: whether an ssh client exists at all, and where the app keeps its files.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub version: String,
    pub data_dir: String,
    pub ssh_path: String,
    pub platform: String,
}

#[tauri::command]
pub fn diagnostics() -> AppResult<Diagnostics> {
    Ok(Diagnostics {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: storage::data_dir()?.to_string_lossy().into_owned(),
        ssh_path: ssh::find_ssh()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "not found".into()),
        platform: std::env::consts::OS.to_string(),
    })
}

/// Closes everything. Called when the window goes away so no ssh outlives the app.
pub fn shutdown(managers: Managers<'_>) {
    managers.0.close_all();
    managers.1.stop_all();
}
