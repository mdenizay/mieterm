//! Mieterm — a cross-platform SSH client and terminal.
//!
//! The split is deliberate: terminals run through the system `ssh` inside a real pty, so
//! everything in `~/.ssh/config` applies and host keys are OpenSSH's problem; the file
//! browser speaks SFTP itself, because a terminal is a byte stream and a file list is not.
//! See `ssh` and `sftp` for the reasoning behind each.

pub mod commands;
pub mod error;
pub mod forwards;
pub mod models;
pub mod pty;
pub mod recording;
pub mod secrets;
pub mod sftp;
pub mod ssh;
pub mod storage;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(pty::SessionManager::default())
        .manage(forwards::ForwardManager::default())
        .manage(sftp::SftpManager::default())
        .setup(|app| {
            // Tunnels marked auto-start come up with the app, so a machine that is always
            // reached through one is reachable as soon as the window opens.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let Ok(forwards) = storage::load_forwards() else {
                    return;
                };
                let Ok(hosts) = storage::load_hosts() else {
                    return;
                };
                let Ok(settings) = storage::load_settings() else {
                    return;
                };
                let manager = handle.state::<forwards::ForwardManager>();
                for forward in forwards.iter().filter(|f| f.auto_start) {
                    if let Some(host) = hosts.iter().find(|h| h.id == forward.host_id) {
                        let _ = manager.start(&handle, host, forward, &settings);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Without this, an ssh child outlives the window that opened it and the
                // process sticks around holding a tunnel nobody can see.
                let app = window.app_handle();
                app.state::<pty::SessionManager>().close_all();
                app.state::<forwards::ForwardManager>().stop_all();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_hosts,
            commands::save_host,
            commands::delete_host,
            commands::reorder_hosts,
            commands::set_secret,
            commands::has_secret,
            commands::delete_secret,
            commands::list_snippets,
            commands::save_snippet,
            commands::delete_snippet,
            commands::get_settings,
            commands::save_settings,
            commands::open_session,
            commands::write_session,
            commands::broadcast_session,
            commands::resize_session,
            commands::close_session,
            commands::session_is_open,
            commands::list_forwards,
            commands::save_forward,
            commands::delete_forward,
            commands::start_forward,
            commands::stop_forward,
            commands::forward_statuses,
            commands::sftp_connect,
            commands::sftp_disconnect,
            commands::sftp_home,
            commands::sftp_list,
            commands::sftp_download,
            commands::sftp_upload,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_remove,
            commands::list_recordings,
            commands::read_recording,
            commands::delete_recording,
            commands::search_recordings,
            commands::diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("Mieterm failed to start");
}
