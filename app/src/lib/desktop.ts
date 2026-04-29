export type NetworkFile = {
  path: string;
  content: string;
};

export type BrowseMode = "directory" | "file";

export type FileSystemBrowseResult = {
  path: string;
  parentPath: string | null;
  entries: Array<{
    name: string;
    path: string;
    type: BrowseMode;
  }>;
};

export type DirectoryBrowseResult = FileSystemBrowseResult;

export type FileTreeReadResult = {
  paths: string[];
  shapefileDirectories: string[];
  truncated: boolean;
};

type FileChangedListener = (paths: string[]) => void;

type DesktopApi = {
  startLocalServer: (backendPath: string) => Promise<string>;
  stopLocalServer: () => Promise<void>;
  pickNetworkDirectory: () => Promise<string | null>;
  pickShapefileDirectory: () => Promise<string | null>;
  pickFileSystemPath: (
    mode?: BrowseMode,
    defaultPath?: string,
  ) => Promise<string | null>;
  browseDirectory: (path?: string, mode?: BrowseMode) => Promise<FileSystemBrowseResult>;
  readFileTree: (path: string) => Promise<FileTreeReadResult>;
  createDirectory: (path: string) => Promise<DirectoryBrowseResult>;
  openDirectory: (path: string) => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  readNetworkDirectory: (path: string) => Promise<NetworkFile[]>;
  moveFileSystemEntry: (sourcePath: string, destinationPath: string) => Promise<void>;
  writeNetworkFile: (path: string, content: string) => Promise<void>;
  deleteNetworkFile: (path: string) => Promise<void>;
  writeBinaryFile: (path: string, base64Content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  startWatchingDirectory: (path: string, extensions?: string[]) => Promise<void>;
  stopWatchingDirectory: () => Promise<void>;
  onFileChanged: (listener: FileChangedListener) => () => void;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

function getDesktopApi(): DesktopApi {
  if (typeof window !== "undefined" && window.desktop) {
    return window.desktop;
  }

  throw new Error("Desktop APIs are only available inside the Electron app.");
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop !== undefined;
}

export async function startLocalServer(backendPath: string): Promise<string> {
  return getDesktopApi().startLocalServer(backendPath);
}

export async function stopLocalServer(): Promise<void> {
  return getDesktopApi().stopLocalServer();
}

export async function pickNetworkDirectory(): Promise<string | null> {
  return getDesktopApi().pickNetworkDirectory();
}

export async function pickShapefileDirectory(): Promise<string | null> {
  return getDesktopApi().pickShapefileDirectory();
}

export async function pickFileSystemPath(
  mode: BrowseMode = "directory",
  defaultPath?: string,
): Promise<string | null> {
  return getDesktopApi().pickFileSystemPath(mode, defaultPath);
}

export async function browseDirectory(
  path?: string,
  mode?: BrowseMode,
): Promise<FileSystemBrowseResult> {
  return getDesktopApi().browseDirectory(path, mode);
}

export async function readFileTree(path: string): Promise<FileTreeReadResult> {
  return getDesktopApi().readFileTree(path);
}

export async function createDirectory(path: string): Promise<DirectoryBrowseResult> {
  return getDesktopApi().createDirectory(path);
}

export async function openDirectory(path: string): Promise<void> {
  return getDesktopApi().openDirectory(path);
}

export async function revealPath(path: string): Promise<void> {
  return getDesktopApi().revealPath(path);
}

export async function readNetworkDirectory(path: string): Promise<NetworkFile[]> {
  return getDesktopApi().readNetworkDirectory(path);
}

export async function moveFileSystemEntry(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  return getDesktopApi().moveFileSystemEntry(sourcePath, destinationPath);
}

export async function writeNetworkFile(
  path: string,
  content: string,
): Promise<void> {
  return getDesktopApi().writeNetworkFile(path, content);
}

export async function deleteNetworkFile(path: string): Promise<void> {
  return getDesktopApi().deleteNetworkFile(path);
}

export async function writeBinaryFile(
  path: string,
  base64Content: string,
): Promise<void> {
  return getDesktopApi().writeBinaryFile(path, base64Content);
}

export async function deleteFile(path: string): Promise<void> {
  return getDesktopApi().deleteFile(path);
}

export async function startWatchingDirectory(
  path: string,
  extensions?: string[],
): Promise<void> {
  return getDesktopApi().startWatchingDirectory(path, extensions);
}

export async function stopWatchingDirectory(): Promise<void> {
  return getDesktopApi().stopWatchingDirectory();
}

export function onFileChanged(listener: FileChangedListener): () => void {
  if (!isDesktop()) {
    return () => {};
  }

  return getDesktopApi().onFileChanged(listener);
}
