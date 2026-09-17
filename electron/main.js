import { app, BrowserWindow, dialog, Tray, Menu, globalShortcut, ipcMain, screen } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../app/server.js";
import { createMemory } from "../app/store.js";

const PORT = 8787;
const HOST = "127.0.0.1";
// Tried in order until one registers successfully — a single hardcoded
// combo is too likely to already be claimed by some other running program.
const QUICK_CAPTURE_SHORTCUT_CANDIDATES = [
  "CommandOrControl+Shift+H",
  "CommandOrControl+Alt+M",
  "CommandOrControl+Shift+K",
  "Alt+Shift+M",
];
const ICON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "icon.png");

let server;
let mainWindow;
let quickCaptureWindow;
let tray;
let isQuitting = false;

function checkCodexCli() {
  return new Promise((resolve) => {
    execFile(process.env.CODEX_BIN || "codex", ["--version"], { windowsHide: true }, (error) => {
      resolve(!error || error.code !== "ENOENT");
    });
  });
}

function deriveQuickCaptureTitle(content) {
  const firstLine = content.split("\n")[0].trim();
  if (!firstLine) return "Captura rápida";
  return firstLine.slice(0, 42) + (firstLine.length > 42 ? "…" : "");
}

async function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Closing the window (X) minimizes to the tray instead of quitting — the
  // app keeps listening for the global capture shortcut in the background.
  // Only the tray's "Sair" (or before-quit) sets isQuitting to let it through.
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  await mainWindow.loadURL(startUrl);
}

function openQuickCapture() {
  if (quickCaptureWindow) {
    quickCaptureWindow.focus();
    return;
  }
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const width = 420;
  const height = 220;
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const y = Math.round(display.bounds.y + (display.bounds.height - height) / 2);

  quickCaptureWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "preload-quick-capture.cjs"),
    },
  });
  quickCaptureWindow.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "quick-capture.html"));
  quickCaptureWindow.on("closed", () => {
    quickCaptureWindow = undefined;
  });
}

function showMainWindow(startUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(startUrl);
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray(startUrl, shortcut) {
  tray = new Tray(ICON_PATH);
  tray.setToolTip("Harness Aurora");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Harness Aurora", click: () => showMainWindow(startUrl) },
      { label: shortcut ? `Capturar memória rápida (${shortcut})` : "Capturar memória rápida", click: openQuickCapture },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showMainWindow(startUrl));
}

ipcMain.handle("quick-capture:save", async (_event, content) => {
  const trimmed = String(content || "").trim();
  if (!trimmed) return null;
  const memory = await createMemory({
    scope: "global",
    title: deriveQuickCaptureTitle(trimmed),
    content: trimmed,
    kind: "manual",
    source: "Captura rápida (atalho global)",
  });
  return memory;
});

ipcMain.on("quick-capture:close", () => {
  quickCaptureWindow?.close();
});

app.whenReady().then(async () => {
  process.env.HARNESS_DB_FILE = process.env.HARNESS_DB_FILE || path.join(app.getPath("userData"), "harness.db");
  process.env.CODEX_CWD = process.env.CODEX_CWD || app.getPath("userData");
  process.env.CLAUDE_CWD = process.env.CLAUDE_CWD || app.getPath("userData");

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

  const startUrl = devUrl || `http://${HOST}:${PORT}/`;
  await createWindow(startUrl);

  const registeredShortcut = QUICK_CAPTURE_SHORTCUT_CANDIDATES.find((combo) => globalShortcut.register(combo, openQuickCapture));
  if (registeredShortcut) {
    console.log(`Atalho de captura rápida registrado: ${registeredShortcut}`);
  } else {
    console.warn("Nenhum atalho global de captura rápida pôde ser registrado (todos já em uso por outros programas).");
  }

  createTray(startUrl, registeredShortcut);

  app.on("activate", () => showMainWindow(startUrl));

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Sem internet ou sem release publicada ainda: não impede o uso do app.
    });
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (server) server.close();
});
