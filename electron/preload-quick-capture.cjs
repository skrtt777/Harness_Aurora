const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harness", {
  save: (content) => ipcRenderer.invoke("quick-capture:save", content),
  close: () => ipcRenderer.send("quick-capture:close"),
});
