mod commands;
mod file_watcher;
mod server;

use file_watcher::{FileWatcher, FileWatcherState};
use server::ServerState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[tauri::command]
fn start_local_server(state: tauri::State<ServerState>) -> Result<String, String> {
    let mut server = state.0.lock().map_err(|e| e.to_string())?;
    let server_path = std::env::current_dir()
        .ok()
        .and_then(|mut p| {
            p.pop(); // src-tauri -> app
            p.pop(); // app -> project root
            p.push("server");
            Some(p)
        })
        .unwrap_or_else(|| std::path::PathBuf::from("../../server"));

    server.start(server_path)?;
    Ok("Server started".to_string())
}

#[tauri::command]
fn stop_local_server(state: tauri::State<ServerState>) -> Result<String, String> {
    let mut server = state.0.lock().map_err(|e| e.to_string())?;
    server.stop()?;
    Ok("Server stopped".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // ── Server state ──────────────────────────────────────────────────
            let server_state = ServerState::new(server::LocalServer::new(3001));
            app.handle().manage(server_state);

            // ── File watcher state ────────────────────────────────────────────
            let watcher_state: FileWatcherState =
                Arc::new(Mutex::new(FileWatcher::new()));
            app.handle().manage(watcher_state);

            // ── Auto-start Hono server ────────────────────────────────────────
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let server_path = std::env::current_dir()
                    .ok()
                    .and_then(|mut p| {
                        p.pop();
                        p.pop();
                        p.push("server");
                        Some(p)
                    })
                    .unwrap_or_else(|| std::path::PathBuf::from("../../server"));

                std::thread::sleep(std::time::Duration::from_millis(1000));

                if let Some(server_state) = app_handle.try_state::<ServerState>() {
                    let mut server = server_state.0.lock().unwrap();
                    match server.start(server_path) {
                        Ok(()) => {
                            log::info!("Attempting to start Hono server on port 3001...");
                        }
                        Err(e) => {
                            if e.contains("already running") || e.contains("already in use") {
                                log::info!("Hono server already running on port 3001");
                            } else {
                                log::error!("Failed to auto-start Hono server: {}", e);
                            }
                        }
                    }
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_local_server,
            stop_local_server,
            commands::read_network_directory,
            commands::write_network_file,
            commands::delete_network_file,
            commands::start_watching_directory,
            commands::stop_watching_directory,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Server and watcher cleanup handled by Drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
