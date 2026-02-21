use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Paths written by the app itself are suppressed for this long.
const SELF_WRITE_TTL: Duration = Duration::from_secs(2);

/// Pure guard logic: purge expired entries from `self_writes`, then return
/// only the paths from `candidates` that are NOT in the guard.
///
/// Extracted as a free function so it can be unit-tested without a real
/// file-system watcher or Tauri AppHandle.
pub(crate) fn filter_external_paths(
    candidates: Vec<PathBuf>,
    self_writes: &mut HashMap<PathBuf, Instant>,
    ttl: Duration,
) -> Vec<PathBuf> {
    // Remove entries whose TTL has expired.
    self_writes.retain(|_, written_at| written_at.elapsed() < ttl);
    // Keep only paths the app did NOT write itself.
    candidates
        .into_iter()
        .filter(|p| !self_writes.contains_key(p))
        .collect()
}

pub struct FileWatcher {
    watcher: Option<RecommendedWatcher>,
    path: Option<PathBuf>,
    app_handle: Option<tauri::AppHandle>,
    /// Paths that the app itself wrote, keyed to the time of the write.
    /// Events matching these paths within SELF_WRITE_TTL are suppressed so
    /// canvas edits don't echo back as external reloads.
    self_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            path: None,
            app_handle: None,
            self_writes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Mark a path as having been written by the app.
    /// Must be called BEFORE writing the file to avoid a race with the watcher.
    pub fn mark_self_write(&self, path: PathBuf) {
        let mut sw = self.self_writes.lock().unwrap();
        sw.insert(path, Instant::now());
    }

    pub fn start_watching(
        &mut self,
        path: PathBuf,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        self.stop_watching();

        let self_writes = Arc::clone(&self.self_writes);
        let (tx, rx) = mpsc::channel();

        let mut watcher =
            notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    if let Err(e) = tx.send(event) {
                        log::error!("Error sending file watch event: {}", e);
                    }
                }
            })
            .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        let app_handle_clone = app_handle.clone();
        std::thread::spawn(move || {
            for event in rx {
                if let EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) =
                    event.kind
                {
                    // Filter to TOML files only.
                    let toml_paths: Vec<PathBuf> = event
                        .paths
                        .iter()
                        .filter(|p| {
                            p.extension()
                                .and_then(|s| s.to_str())
                                .map(|s| s == "toml")
                                .unwrap_or(false)
                        })
                        .cloned()
                        .collect();

                    if toml_paths.is_empty() {
                        continue;
                    }

                    // Self-write guard: purge expired entries and filter out
                    // paths the app just wrote.
                    let mut sw = self_writes.lock().unwrap();
                    let external_paths =
                        filter_external_paths(toml_paths, &mut sw, SELF_WRITE_TTL);
                    drop(sw);

                    if external_paths.is_empty() {
                        log::debug!("Suppressed self-write echo for {:?}", event.paths);
                        continue;
                    }

                    log::info!("External TOML change detected: {:?}", external_paths);
                    let paths: Vec<String> = external_paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    let _ = app_handle_clone.emit("file-changed", paths);
                }
            }
        });

        self.watcher = Some(watcher);
        self.path = Some(path);
        self.app_handle = Some(app_handle);

        Ok(())
    }

    pub fn stop_watching(&mut self) {
        if let Some(mut watcher) = self.watcher.take() {
            if let Some(path) = &self.path {
                let _ = watcher.unwatch(path);
            }
        }
        self.path = None;
        self.app_handle = None;
    }
}

impl Drop for FileWatcher {
    fn drop(&mut self) {
        self.stop_watching();
    }
}

pub type FileWatcherState = Arc<Mutex<FileWatcher>>;

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    /// A TTL of zero means every entry is already expired before the next check.
    const ZERO_TTL: Duration = Duration::ZERO;
    /// A TTL of 1 hour means nothing expires during the test.
    const LONG_TTL: Duration = Duration::from_secs(3600);

    // ── filter_external_paths ─────────────────────────────────────────────────

    #[test]
    fn unmarked_path_is_passed_through() {
        let mut sw: HashMap<PathBuf, Instant> = HashMap::new();
        let result = filter_external_paths(vec![p("/net/branch-1.toml")], &mut sw, LONG_TTL);
        assert_eq!(result, vec![p("/net/branch-1.toml")]);
    }

    #[test]
    fn marked_path_is_suppressed() {
        let mut sw: HashMap<PathBuf, Instant> = HashMap::new();
        sw.insert(p("/net/branch-1.toml"), Instant::now());
        let result = filter_external_paths(vec![p("/net/branch-1.toml")], &mut sw, LONG_TTL);
        assert!(result.is_empty());
    }

    #[test]
    fn only_marked_path_is_suppressed_in_mixed_batch() {
        let mut sw: HashMap<PathBuf, Instant> = HashMap::new();
        sw.insert(p("/net/branch-1.toml"), Instant::now());

        let candidates = vec![
            p("/net/branch-1.toml"), // marked → suppressed
            p("/net/branch-2.toml"), // not marked → passes through
        ];
        let result = filter_external_paths(candidates, &mut sw, LONG_TTL);
        assert_eq!(result, vec![p("/net/branch-2.toml")]);
    }

    #[test]
    fn expired_entry_is_purged_and_path_passes_through() {
        let mut sw: HashMap<PathBuf, Instant> = HashMap::new();
        // Insert with an instant far enough in the past that ZERO_TTL considers it expired.
        sw.insert(p("/net/branch-1.toml"), Instant::now() - Duration::from_secs(1));

        let result = filter_external_paths(vec![p("/net/branch-1.toml")], &mut sw, ZERO_TTL);
        // Entry is expired → treated as external → not suppressed.
        assert_eq!(result, vec![p("/net/branch-1.toml")]);
        // Side-effect: expired entry was removed from the map.
        assert!(sw.is_empty());
    }

    #[test]
    fn empty_candidates_returns_empty() {
        let mut sw: HashMap<PathBuf, Instant> = HashMap::new();
        sw.insert(p("/net/branch-1.toml"), Instant::now());
        let result = filter_external_paths(vec![], &mut sw, LONG_TTL);
        assert!(result.is_empty());
    }

    #[test]
    fn all_marked_returns_empty() {
        let mut sw: HashMap<PathBuf, Instant> = HashMap::new();
        sw.insert(p("/net/a.toml"), Instant::now());
        sw.insert(p("/net/b.toml"), Instant::now());
        sw.insert(p("/net/c.toml"), Instant::now());

        let candidates = vec![p("/net/a.toml"), p("/net/b.toml"), p("/net/c.toml")];
        let result = filter_external_paths(candidates, &mut sw, LONG_TTL);
        assert!(result.is_empty());
    }

    // ── mark_self_write ───────────────────────────────────────────────────────

    #[test]
    fn mark_self_write_adds_path_to_guard() {
        let watcher = FileWatcher::new();
        let path = p("/net/branch-1.toml");
        watcher.mark_self_write(path.clone());

        let sw = watcher.self_writes.lock().unwrap();
        assert!(sw.contains_key(&path));
    }

    #[test]
    fn mark_self_write_overwrites_existing_entry() {
        let watcher = FileWatcher::new();
        let path = p("/net/branch-1.toml");

        // Mark twice; the second call resets the TTL clock.
        watcher.mark_self_write(path.clone());
        watcher.mark_self_write(path.clone());

        let sw = watcher.self_writes.lock().unwrap();
        assert_eq!(sw.len(), 1);
    }

    #[test]
    fn multiple_marks_all_suppress() {
        let watcher = FileWatcher::new();
        let paths: Vec<PathBuf> = (1..=5).map(|i| p(&format!("/net/b{i}.toml"))).collect();
        for p in &paths {
            watcher.mark_self_write(p.clone());
        }

        let mut sw = watcher.self_writes.lock().unwrap();
        let result = filter_external_paths(paths.clone(), &mut sw, LONG_TTL);
        assert!(result.is_empty());
    }
}
