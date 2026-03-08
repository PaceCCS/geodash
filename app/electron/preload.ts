import { contextBridge, ipcRenderer } from "electron";

type FileChangedListener = (paths: string[]) => void;

const desktopApi = {
  startLocalServer: (backendPath: string) =>
    ipcRenderer.invoke("desktop:start-local-server", backendPath) as Promise<string>,
  stopLocalServer: () => ipcRenderer.invoke("desktop:stop-local-server") as Promise<void>,
  pickNetworkDirectory: () =>
    ipcRenderer.invoke("desktop:pick-network-directory") as Promise<string | null>,
  readNetworkDirectory: (path: string) =>
    ipcRenderer.invoke("desktop:read-network-directory", path) as Promise<
      Array<{ path: string; content: string }>
    >,
  writeNetworkFile: (path: string, content: string) =>
    ipcRenderer.invoke("desktop:write-network-file", path, content) as Promise<void>,
  deleteNetworkFile: (path: string) =>
    ipcRenderer.invoke("desktop:delete-network-file", path) as Promise<void>,
  startWatchingDirectory: (path: string) =>
    ipcRenderer.invoke("desktop:start-watching-directory", path) as Promise<void>,
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
