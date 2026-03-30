import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs, type Stats } from "node:fs";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, "..");
const projectRoot = resolve(appRoot, "..");
const serverRoot = resolve(projectRoot, "server");
const preloadPath = join(appRoot, "dist-electron", "preload.js");
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:3000";
const rendererProdPath = join(appRoot, "dist", "client", "index.html");
const backendPort = 3001;
const OWN_WRITE_IGNORE_WINDOW_MS = 1500;

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let watcher: FSWatcher | null = null;
const recentOwnWrites = new Map<string, number>();

function pruneOwnWrites(now = Date.now()): void {
  for (const [path, timestamp] of recentOwnWrites.entries()) {
    if (now - timestamp > OWN_WRITE_IGNORE_WINDOW_MS) {
      recentOwnWrites.delete(path);
    }
  }
}

function recordOwnWrite(path: string): void {
  pruneOwnWrites();
  recentOwnWrites.set(resolve(path), Date.now());
}

function clearOwnWrite(path: string): void {
  recentOwnWrites.delete(resolve(path));
}

function shouldIgnoreOwnWrite(path: string): boolean {
  pruneOwnWrites();
  const resolvedPath = resolve(path);
  const timestamp = recentOwnWrites.get(resolvedPath);
  if (timestamp === undefined) {
    return false;
  }

  if (Date.now() - timestamp > OWN_WRITE_IGNORE_WINDOW_MS) {
    recentOwnWrites.delete(resolvedPath);
    return false;
  }

  return true;
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = net.createServer();

    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

async function isBackendHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isBackendHealthy()) {
      return;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(`Backend did not become healthy on port ${backendPort}`);
}

async function startBackend(backendPath = serverRoot): Promise<string> {
  if (await isBackendHealthy()) {
    return `http://127.0.0.1:${backendPort}`;
  }

  if (!(await isPortOpen(backendPort))) {
    throw new Error(
      `Port ${backendPort} is already in use by a non-responsive process.`,
    );
  }

  if (backendProcess) {
    return `http://127.0.0.1:${backendPort}`;
  }

  const child = spawn("bun", ["run", "dev"], {
    cwd: backendPath,
    env: {
      ...process.env,
      PORT: String(backendPort),
    },
    stdio: "inherit",
  });

  backendProcess = child;

  child.once("exit", () => {
    backendProcess = null;
  });

  await waitForBackend();

  return `http://127.0.0.1:${backendPort}`;
}

async function stopBackend(): Promise<void> {
  if (!backendProcess) {
    return;
  }

  const child = backendProcess;
  backendProcess = null;

  await new Promise<void>((resolveStop) => {
    child.once("exit", () => resolveStop());
    child.kill();

    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolveStop();
    }, 2000);
  });
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "geodash",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(rendererProdPath);
  } else {
    await mainWindow.loadURL(rendererDevUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function emitFileChanged(paths: string[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("file-changed", paths);
  }
}

function isTomlFilePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".toml");
}

function shouldIgnoreWatchedPath(watchedPath: string, stats?: Stats): boolean {
  if (stats?.isDirectory()) {
    return false;
  }

  if (stats?.isFile()) {
    return !isTomlFilePath(watchedPath);
  }

  return false;
}

async function startWatchingDirectory(directoryPath: string): Promise<void> {
  await stopWatchingDirectory();

  const nextWatcher = chokidar.watch(directoryPath, {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50,
    },
    ignored: shouldIgnoreWatchedPath,
  });

  const handleChange = (changedPath: string) => {
    const resolvedPath = resolve(changedPath);
    if (!isTomlFilePath(resolvedPath)) {
      return;
    }

    if (shouldIgnoreOwnWrite(resolvedPath)) {
      return;
    }

    emitFileChanged([resolvedPath]);
  };

  nextWatcher.on("add", handleChange);
  nextWatcher.on("change", handleChange);
  nextWatcher.on("unlink", handleChange);
  nextWatcher.on("error", (error) => {
    console.error("[watch] File watcher error:", error);
  });

  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      nextWatcher.once("ready", () => {
        console.log("[watch] Watching directory:", directoryPath);
        resolveReady();
      });
      nextWatcher.once("error", rejectReady);
    });
  } catch (error) {
    await nextWatcher.close();
    throw error;
  }

  watcher = nextWatcher;
}

async function stopWatchingDirectory(): Promise<void> {
  if (!watcher) {
    recentOwnWrites.clear();
    return;
  }

  const currentWatcher = watcher;
  watcher = null;
  recentOwnWrites.clear();
  await currentWatcher.close();
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:start-local-server", async (_event, backendPath?: string) => {
    return startBackend(backendPath ?? serverRoot);
  });

  ipcMain.handle("desktop:stop-local-server", async () => {
    await stopBackend();
  });

  ipcMain.handle("desktop:pick-network-directory", async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory"],
          title: "Select Network Directory",
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
          title: "Select Network Directory",
        });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("desktop:read-network-directory", async (_event, directoryPath: string) => {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
        .map(async (entry) => {
          const path = join(directoryPath, entry.name);
          return {
            path,
            content: await fs.readFile(path, "utf8"),
          };
        }),
    );
  });

  ipcMain.handle("desktop:write-network-file", async (_event, filePath: string, content: string) => {
    recordOwnWrite(filePath);
    try {
      await fs.writeFile(filePath, content, "utf8");
    } catch (error) {
      clearOwnWrite(filePath);
      throw error;
    }
  });

  ipcMain.handle("desktop:delete-network-file", async (_event, filePath: string) => {
    recordOwnWrite(filePath);
    try {
      await fs.rm(filePath);
    } catch (error) {
      clearOwnWrite(filePath);
      throw error;
    }
  });

  ipcMain.handle("desktop:start-watching-directory", async (_event, directoryPath: string) => {
    await startWatchingDirectory(directoryPath);
  });

  ipcMain.handle("desktop:stop-watching-directory", async () => {
    await stopWatchingDirectory();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void stopWatchingDirectory();
  void stopBackend();
});

app.whenReady().then(async () => {
  registerIpcHandlers();
  await startBackend();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});
