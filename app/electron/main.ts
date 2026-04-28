import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs, type Stats } from "node:fs";
import { homedir } from "node:os";
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
const MAX_WATCH_DIRECTORIES = 200;
const MAX_WATCH_FILES = 2_000;
const MAX_RELEVANT_WATCH_FILES = 500;
const WATCH_PREFLIGHT_CONCURRENCY = 8;
const shouldOpenDevTools =
  !app.isPackaged && process.env.GEODASH_DISABLE_DEVTOOLS !== "1";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let watcher: FSWatcher | null = null;
const recentOwnWrites = new Map<string, number>();

type BrowseMode = "directory" | "file";

type FileSystemBrowseResult = {
  path: string;
  parentPath: string | null;
  entries: Array<{
    name: string;
    path: string;
    type: "directory" | "file";
  }>;
};

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
    if (shouldOpenDevTools) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
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

function normalizeWatchedExtensions(extensions?: string[]): string[] {
  if (!extensions || extensions.length === 0) {
    return [".toml"];
  }

  return extensions.map((extension) =>
    extension.startsWith(".")
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`,
  );
}

function hasAllowedExtension(filePath: string, extensions: string[]): boolean {
  return extensions.includes(extname(filePath).toLowerCase());
}

function isIgnoredWatchDirectoryName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName === "node_modules" ||
    normalizedName === ".git" ||
    normalizedName === "$recycle.bin" ||
    normalizedName === "recycler" ||
    normalizedName === "system volume information"
  );
}

function isHiddenDirectoryName(name: string): boolean {
  return name.startsWith(".");
}

function resolveBrowsePath(inputPath?: string): string {
  const trimmedPath = inputPath?.trim();
  if (!trimmedPath || trimmedPath === "~") {
    return app.getPath("documents");
  }

  if (trimmedPath.startsWith(`~${sep}`)) {
    return resolve(homedir(), trimmedPath.slice(2));
  }

  return isAbsolute(trimmedPath) ? resolve(trimmedPath) : resolve(homedir(), trimmedPath);
}

async function browseFileSystem(
  inputPath?: string,
  mode: BrowseMode = "directory",
): Promise<FileSystemBrowseResult> {
  const directoryPath = resolveBrowsePath(inputPath);
  const stats = await fs.stat(directoryPath);

  if (!stats.isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const browsableEntries = entries
    .filter(
      (entry) =>
        (entry.isDirectory() || (mode === "file" && entry.isFile())) &&
        !isIgnoredWatchDirectoryName(entry.name) &&
        !isHiddenDirectoryName(entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      path: join(directoryPath, entry.name),
      type: entry.isDirectory() ? "directory" as const : "file" as const,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  const parentPath = resolve(directoryPath, "..");

  return {
    path: directoryPath,
    parentPath: parentPath === directoryPath ? null : parentPath,
    entries: browsableEntries,
  };
}

async function createDirectory(inputPath: string): Promise<FileSystemBrowseResult> {
  const directoryPath = resolveBrowsePath(inputPath);
  await fs.mkdir(directoryPath, { recursive: true });
  return browseFileSystem(directoryPath);
}

async function assertWatchableDirectory(
  directoryPath: string,
  extensions: string[],
): Promise<void> {
  const rootStats = await fs.stat(directoryPath);
  if (!rootStats.isDirectory()) {
    throw new Error("Select a directory to watch.");
  }

  const pendingDirectories = [directoryPath];
  let directoryCount = 0;
  let fileCount = 0;
  let relevantFileCount = 0;

  while (pendingDirectories.length > 0) {
    const batch = pendingDirectories.splice(0, WATCH_PREFLIGHT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (currentDirectory) => ({
        currentDirectory,
        entries: await fs.readdir(currentDirectory, { withFileTypes: true }),
      })),
    );

    for (const { currentDirectory, entries } of results) {
      directoryCount += 1;
      if (directoryCount > MAX_WATCH_DIRECTORIES) {
        throw new Error(
          `Directory is too large to watch safely (${MAX_WATCH_DIRECTORIES}+ folders). Choose a smaller data folder.`,
        );
      }

      for (const entry of entries) {
        if (isIgnoredWatchDirectoryName(entry.name)) {
          continue;
        }

        const entryPath = join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        fileCount += 1;
        if (fileCount > MAX_WATCH_FILES) {
          throw new Error(
            `Directory is too large to watch safely (${MAX_WATCH_FILES}+ files). Choose a smaller data folder.`,
          );
        }

        if (hasAllowedExtension(entryPath, extensions)) {
          relevantFileCount += 1;
          if (relevantFileCount > MAX_RELEVANT_WATCH_FILES) {
            throw new Error(
              `Directory contains too many watchable files (${MAX_RELEVANT_WATCH_FILES}+). Choose a smaller data folder.`,
            );
          }
        }
      }
    }
  }
}

function shouldIgnoreWatchedPath(
  watchedPath: string,
  extensions: string[],
  stats?: Stats,
): boolean {
  if (stats?.isDirectory()) {
    return isIgnoredWatchDirectoryName(watchedPath.split(/[\\/]/).at(-1) ?? "");
  }

  if (stats?.isFile()) {
    return !hasAllowedExtension(watchedPath, extensions);
  }

  return false;
}

async function startWatchingDirectory(
  directoryPath: string,
  extensions?: string[],
): Promise<void> {
  await stopWatchingDirectory();
  const watchedExtensions = normalizeWatchedExtensions(extensions);
  await assertWatchableDirectory(directoryPath, watchedExtensions);

  const nextWatcher = chokidar.watch(directoryPath, {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50,
    },
    ignored: (watchedPath, stats) =>
      shouldIgnoreWatchedPath(watchedPath, watchedExtensions, stats),
  });

  const handleChange = (changedPath: string) => {
    const resolvedPath = resolve(changedPath);
    if (!hasAllowedExtension(resolvedPath, watchedExtensions)) {
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
    const testDirectory = process.env.GEODASH_TEST_PICK_DIRECTORY;
    if (testDirectory) {
      return testDirectory;
    }

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

  ipcMain.handle("desktop:pick-shapefile-directory", async () => {
    const testDirectory = process.env.GEODASH_TEST_PICK_DIRECTORY;
    if (testDirectory) {
      return testDirectory;
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory"],
          title: "Select Shapefile Directory",
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
          title: "Select Shapefile Directory",
        });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("desktop:pick-file-system-path", async (_event, mode?: BrowseMode, defaultPath?: string) => {
    const testDirectory = process.env.GEODASH_TEST_PICK_DIRECTORY;
    if (testDirectory) {
      return testDirectory;
    }

    const browseMode = mode ?? "directory";
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: [browseMode === "file" ? "openFile" : "openDirectory"],
          title: browseMode === "file" ? "Select File" : "Select Directory",
          defaultPath: defaultPath || undefined,
        })
      : await dialog.showOpenDialog({
          properties: [browseMode === "file" ? "openFile" : "openDirectory"],
          title: browseMode === "file" ? "Select File" : "Select Directory",
          defaultPath: defaultPath || undefined,
        });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "desktop:browse-directory",
    async (_event, directoryPath?: string, mode?: BrowseMode) => {
      return browseFileSystem(directoryPath, mode);
    },
  );

  ipcMain.handle("desktop:create-directory", async (_event, directoryPath: string) => {
    return createDirectory(directoryPath);
  });

  ipcMain.handle("desktop:open-directory", async (_event, directoryPath: string) => {
    const resolvedPath = resolveBrowsePath(directoryPath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory.");
    }

    const errorMessage = await shell.openPath(resolvedPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
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

  ipcMain.handle(
    "desktop:write-binary-file",
    async (_event, filePath: string, base64Content: string) => {
      recordOwnWrite(filePath);
      try {
        await fs.writeFile(filePath, Buffer.from(base64Content, "base64"));
      } catch (error) {
        clearOwnWrite(filePath);
        throw error;
      }
    },
  );

  ipcMain.handle("desktop:delete-file", async (_event, filePath: string) => {
    recordOwnWrite(filePath);
    try {
      await fs.rm(filePath);
    } catch (error) {
      clearOwnWrite(filePath);
      throw error;
    }
  });

  ipcMain.handle(
    "desktop:start-watching-directory",
    async (_event, directoryPath: string, extensions?: string[]) => {
      await startWatchingDirectory(directoryPath, extensions);
    },
  );

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
