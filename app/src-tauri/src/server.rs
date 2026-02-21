use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

pub struct LocalServer {
    process: Option<Child>,
    port: u16,
}

impl LocalServer {
    pub fn new(port: u16) -> Self {
        Self {
            process: None,
            port,
        }
    }

    pub fn start(&mut self, server_path: PathBuf) -> Result<(), String> {
        if self.process.is_some() {
            log::info!("Stopping existing server process before restart");
            let _ = self.stop();
        }

        match TcpListener::bind(format!("127.0.0.1:{}", self.port)) {
            Ok(_) => {}
            Err(_) => {
                log::warn!("Port {} is in use. Attempting to free it...", self.port);

                #[cfg(unix)]
                {
                    let port_arg = format!(":{}", self.port);
                    let output = Command::new("lsof").arg("-ti").arg(&port_arg).output();

                    if let Ok(output) = output {
                        if !output.stdout.is_empty() {
                            let pid_str = String::from_utf8_lossy(&output.stdout);
                            let pid = pid_str.trim();
                            log::info!("Killing process {} using port {}", pid, self.port);
                            let _ = Command::new("kill").arg("-9").arg(pid).output();
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                    }
                }

                match TcpListener::bind(format!("127.0.0.1:{}", self.port)) {
                    Ok(_) => {
                        log::info!("Port {} is now available", self.port);
                    }
                    Err(_) => {
                        return Err(format!(
                            "Port {} is still in use after attempting to free it.",
                            self.port
                        ));
                    }
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(100));

        let script = if cfg!(debug_assertions) { "dev" } else { "start" };
        let mut cmd = Command::new("bun");
        cmd.arg("run")
            .arg(script)
            .current_dir(&server_path)
            .env("PORT", self.port.to_string())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit());

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start server: {}", e))?;

        self.process = Some(child);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.process.take() {
            child
                .kill()
                .map_err(|e| format!("Failed to stop server: {}", e))?;
        }
        Ok(())
    }
}

impl Drop for LocalServer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub struct ServerState(pub Mutex<LocalServer>);

impl ServerState {
    pub fn new(server: LocalServer) -> Self {
        Self(Mutex::new(server))
    }
}
