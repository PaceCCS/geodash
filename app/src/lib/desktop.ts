export type NetworkFile = {
  path: string;
  content: string;
};

type FileChangedListener = (paths: string[]) => void;

type DesktopApi = {
  startLocalServer: (backendPath: string) => Promise<string>;
  stopLocalServer: () => Promise<void>;
  pickNetworkDirectory: () => Promise<string | null>;
  readNetworkDirectory: (path: string) => Promise<NetworkFile[]>;
  writeNetworkFile: (path: string, content: string) => Promise<void>;
  deleteNetworkFile: (path: string) => Promise<void>;
  startWatchingDirectory: (path: string) => Promise<void>;
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

export async function readNetworkDirectory(path: string): Promise<NetworkFile[]> {
  return getDesktopApi().readNetworkDirectory(path);
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

export async function startWatchingDirectory(path: string): Promise<void> {
  return getDesktopApi().startWatchingDirectory(path);
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
