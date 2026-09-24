const { contextBridge, ipcRenderer } = require("electron");

/**
 * Bridges two things the sandbox-execution feature needs that only the
 * Electron main process can do: opening a URL in the user's actual default
 * browser (not another Chromium window inside the app) and showing a native
 * folder-picker dialog. Both are optional from the renderer's point of view
 * — window.harness is undefined when the app runs as a plain webpage (e.g.
 * `npm start` in a browser during development, or this project's own test
 * suite), and the frontend falls back to window.open()/a text field there.
 */
contextBridge.exposeInMainWorld("harness", {
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
  getUpdateState: () => ipcRenderer.invoke("updater:state"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("updater:status", handler);
    return () => ipcRenderer.removeListener("updater:status", handler);
  },
});
