use crate::file_watcher::FileWatcherState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkFile {
    pub path: String,
    pub content: String,
}

/// Read all TOML files from a network directory.
#[tauri::command]
pub async fn read_network_directory(path: String) -> Result<Vec<NetworkFile>, String> {
    let dir = PathBuf::from(&path);

    if !dir.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut files = Vec::new();

    for entry in
        fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("toml") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            files.push(NetworkFile {
                path: path.to_string_lossy().to_string(),
                content,
            });
        }
    }

    Ok(files)
}

/// Write a single TOML file, marking it as a self-write so the file watcher
/// suppresses the echo event.
#[tauri::command]
pub async fn write_network_file(
    path: String,
    content: String,
    watcher: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    // Mark BEFORE writing to avoid a race where the watcher fires before we
    // can update the guard.
    {
        let watcher_guard = watcher.lock().unwrap();
        watcher_guard.mark_self_write(path_buf.clone());
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

/// Delete a TOML file from a network directory.
#[tauri::command]
pub async fn delete_network_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(())
}

/// Start watching a directory for TOML file changes.
#[tauri::command]
pub async fn start_watching_directory(
    watcher: State<'_, FileWatcherState>,
    path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut watcher_guard = watcher.lock().unwrap();
    watcher_guard
        .start_watching(path.into(), app)
        .map_err(|e| e.to_string())
}

/// Stop watching the current directory.
#[tauri::command]
pub async fn stop_watching_directory(watcher: State<'_, FileWatcherState>) -> Result<(), String> {
    let mut watcher_guard = watcher.lock().unwrap();
    watcher_guard.stop_watching();
    Ok(())
}
