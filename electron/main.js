import { app, BrowserWindow, dialog } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { execFile } from "node:child_process";
import path from "node:path";
import { createServer } from "../app/server.js";

const PORT = 8787;
const HOST = "127.0.0.1";

let server;
let mainWindow;

function checkCodexCli() {
  return new Promise((resolve) => {
    execFile(process.env.CODEX_BIN || "codex", ["--version"], { windowsHide: true }, (error) => {
      resolve(!error || error.code !== "ENOENT");
    });
  });
}

async function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await mainWindow.loadURL(startUrl);
}

app.whenReady().then(async () => {
  process.env.HARNESS_DB_FILE = process.env.HARNESS_DB_FILE || path.join(app.getPath("userData"), "harness.db");
  process.env.CODEX_CWD = process.env.CODEX_CWD || app.getPath("userData");

  const devUrl = process.env.ELECTRON_START_URL;
  if (!devUrl) {
    server = createServer();
    await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  }

  const codexAvailable = await checkCodexCli();
  if (!codexAvailable) {
    dialog.showMessageBox({
      type: "warning",
      title: "Codex CLI não encontrado",
      message: "O Harness Aurora precisa do Codex CLI instalado e autenticado para conversar com a IA.",
      detail:
        "Instale o Codex CLI, autentique com \"codex login\" e reabra o app. Você ainda pode navegar pela interface, mas o chat não vai responder até isso ser resolvido.",
    });
  }

  await createWindow(devUrl || `http://${HOST}:${PORT}/`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(devUrl || `http://${HOST}:${PORT}/`);
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Sem internet ou sem release publicada ainda: não impede o uso do app.
    });
  }
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server) server.close();
});
