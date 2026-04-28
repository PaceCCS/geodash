import { contextBridge, ipcRenderer } from "electron";

type FileChangedListener = (paths: string[]) => void;

const desktopApi = {
  startLocalServer: (backendPath: string) =>
    ipcRenderer.invoke("desktop:start-local-server", backendPath) as Promise<string>,
  stopLocalServer: () => ipcRenderer.invoke("desktop:stop-local-server") as Promise<void>,
  pickNetworkDirectory: () =>
    ipcRenderer.invoke("desktop:pick-network-directory") as Promise<string | null>,
  pickShapefileDirectory: () =>
    ipcRenderer.invoke("desktop:pick-shapefile-directory") as Promise<string | null>,
  pickFileSystemPath: (mode?: "directory" | "file") =>
    ipcRenderer.invoke("desktop:pick-file-system-path", mode) as Promise<string | null>,
  browseDirectory: (path?: string, mode?: "directory" | "file") =>
    ipcRenderer.invoke("desktop:browse-directory", path, mode) as Promise<{
      path: string;
      parentPath: string | null;
      entries: Array<{ name: string; path: string; type: "directory" | "file" }>;
    }>,
  createDirectory: (path: string) =>
    ipcRenderer.invoke("desktop:create-directory", path) as Promise<{
      path: string;
      parentPath: string | null;
      entries: Array<{ name: string; path: string; type: "directory" | "file" }>;
    }>,
  openDirectory: (path: string) =>
    ipcRenderer.invoke("desktop:open-directory", path) as Promise<void>,
  readNetworkDirectory: (path: string) =>
    ipcRenderer.invoke("desktop:read-network-directory", path) as Promise<
      Array<{ path: string; content: string }>
    >,
  writeNetworkFile: (path: string, content: string) =>
    ipcRenderer.invoke("desktop:write-network-file", path, content) as Promise<void>,
  deleteNetworkFile: (path: string) =>
    ipcRenderer.invoke("desktop:delete-network-file", path) as Promise<void>,
  writeBinaryFile: (path: string, base64Content: string) =>
    ipcRenderer.invoke("desktop:write-binary-file", path, base64Content) as Promise<void>,
  deleteFile: (path: string) =>
    ipcRenderer.invoke("desktop:delete-file", path) as Promise<void>,
  startWatchingDirectory: (path: string, extensions?: string[]) =>
    ipcRenderer.invoke("desktop:start-watching-directory", path, extensions) as Promise<void>,
  stopWatchingDirectory: () =>
    ipcRenderer.invoke("desktop:stop-watching-directory") as Promise<void>,
  onFileChanged: (listener: FileChangedListener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, paths: string[]) => {
      listener(paths);
    };

    ipcRenderer.on("file-changed", wrappedListener);

    return () => {
      ipcRenderer.removeListener("file-changed", wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
