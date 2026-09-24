import { app, BrowserWindow, dialog, Tray, Menu, globalShortcut, ipcMain, screen, shell } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../app/server.js";
import { createMemory } from "../app/store.js";
import { closeBrowserContext } from "../app/browserAgent.js";
import { terminateOcr } from "../app/ocr.js";

const PORT = Number(process.env.HARNESS_PORT || 8787);
const HOST = "127.0.0.1";
const testing = process.env.HARNESS_TEST_MODE === "1";
// Tried in order until one registers successfully — a single hardcoded
// combo is too likely to already be claimed by some other running program.
const QUICK_CAPTURE_SHORTCUT_CANDIDATES = [
  "CommandOrControl+Shift+H",
  "CommandOrControl+Alt+M",
  "CommandOrControl+Shift+K",
  "Alt+Shift+M",
];
const ICON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "icon.png");
const devUrl = process.env.ELECTRON_START_URL;
let startUrl = devUrl || `http://${HOST}:${PORT}/`;
if (process.env.HARNESS_USER_DATA_DIR) {
  if (!path.isAbsolute(process.env.HARNESS_USER_DATA_DIR)) throw new Error("HARNESS_USER_DATA_DIR deve ser absoluto.");
  app.setPath("userData", process.env.HARNESS_USER_DATA_DIR);
}

let server;
let mainWindow;
let quickCaptureWindow;
let tray;
let isQuitting = false;

// The tray keeps the app running in the background after the window is
// closed, so a user who forgets that and reopens it from the Start
// Menu/desktop would otherwise launch a second instance that crashes trying
// to bind the same port. Without this lock, that second instance's
// server.listen() would fail (EADDRINUSE) and — since node's http.Server
// throws on an unhandled "error" event — take down the whole process with
// an uncaught exception, which is exactly the crash a user reported.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function deriveQuickCaptureTitle(content) {
  const firstLine = content.split("\n")[0].trim();
  if (!firstLine) return "Captura rápida";
  return firstLine.slice(0, 42) + (firstLine.length > 42 ? "…" : "");
}

async function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    show: !testing,
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "preload-main.cjs"),
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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(startUrl).origin || new URL(url).pathname.startsWith("/api/")) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
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

function trustedSender(event, window) {
  return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}

ipcMain.handle("quick-capture:save", async (event, content) => {
  if (!trustedSender(event, quickCaptureWindow)) throw new Error("Origem IPC inválida.");
  if (typeof content !== "string" || content.length > 100000) throw new Error("Captura inválida.");
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

ipcMain.on("quick-capture:close", (event) => {
  if (!trustedSender(event, quickCaptureWindow)) return;
  quickCaptureWindow?.close();
});

// Sandbox de execução (rodar código gerado pelo modelo local): abrir no
// navegador de verdade do sistema (não outra janela Electron) e escolher a
// pasta onde os arquivos gerados são salvos — as duas únicas coisas dessa
// funcionalidade que precisam do processo principal, o resto (extrair o
// código, salvar o arquivo, servir o preview) já é feito no backend HTTP
// comum, alcançável de qualquer jeito que a UI rode (Electron ou navegador).
ipcMain.handle("shell:open-external", async (event, url) => {
  if (!trustedSender(event, mainWindow)) throw new Error("Origem IPC inválida.");
  const trimmed = String(url || "").trim();
  if (!trimmed) return false;
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Somente links HTTP/HTTPS são permitidos.");
  await shell.openExternal(parsed.href);
  return true;
});

ipcMain.handle("dialog:pick-folder", async (event) => {
  if (!trustedSender(event, mainWindow)) throw new Error("Origem IPC inválida.");
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Auto-update (via GitHub Releases — see build.publish in package.json).
// Previously this was one checkForUpdatesAndNotify() call at startup whose
// failures were silently swallowed (no logging, no UI) — if it ever broke,
// nobody would know, and the only feedback the user ever got was a native
// OS toast on success, easy to miss and gone before Configurações could
// show anything useful. This keeps a running `updaterState` the renderer
// can always read (updater:state) plus live events (updater:status), and a
// manual updater:check the Settings screen can trigger itself.
let updaterState = { status: "idle" };
function setUpdaterState(next) {
  updaterState = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:status", updaterState);
}
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = console;
autoUpdater.on("checking-for-update", () => setUpdaterState({ status: "checking" }));
autoUpdater.on("update-available", (info) => setUpdaterState({ status: "downloading", version: info.version, percent: 0 }));
autoUpdater.on("update-not-available", () => setUpdaterState({ status: "up-to-date", checkedAt: new Date().toISOString() }));
autoUpdater.on("download-progress", (progress) => setUpdaterState({ status: "downloading", percent: Math.round(progress.percent) }));
autoUpdater.on("update-downloaded", (info) => setUpdaterState({ status: "ready", version: info.version }));
autoUpdater.on("error", (error) => setUpdaterState({ status: "error", message: error?.message || "Falha ao verificar atualizações." }));

ipcMain.handle("updater:state", (event) => {
  if (!trustedSender(event, mainWindow)) throw new Error("Origem IPC inválida.");
  return { ...updaterState, packaged: app.isPackaged, currentVersion: app.getVersion() };
});
ipcMain.handle("updater:check", (event) => {
  if (!trustedSender(event, mainWindow)) throw new Error("Origem IPC inválida.");
  if (!app.isPackaged) return { ...updaterState, packaged: false, currentVersion: app.getVersion() };
  autoUpdater.checkForUpdates().catch((error) => setUpdaterState({ status: "error", message: error?.message || "Falha ao verificar atualizações." }));
  return { ...updaterState, packaged: true, currentVersion: app.getVersion() };
});
ipcMain.handle("updater:install", (event) => {
  if (!trustedSender(event, mainWindow)) throw new Error("Origem IPC inválida.");
  if (updaterState.status !== "ready") return false;
  isQuitting = true;
  autoUpdater.quitAndInstall();
  return true;
});

if (hasSingleInstanceLock) {
  // A second launch attempt (e.g. the user double-clicking the shortcut
  // while the app is already running in the tray) shows/focuses the
  // existing window instead of trying to start a second instance.
  app.on("second-instance", () => showMainWindow(startUrl));

  app.whenReady().then(async () => {
    process.env.HARNESS_DB_FILE = process.env.HARNESS_DB_FILE || path.join(app.getPath("userData"), "harness.db");
    process.env.CODEX_CWD = process.env.CODEX_CWD || app.getPath("userData");
    process.env.CLAUDE_CWD = process.env.CLAUDE_CWD || app.getPath("userData");
    process.env.BROWSER_AGENT_PROFILE_DIR ||= path.join(app.getPath("userData"), "browser-profile");
    process.env.OCR_CACHE_PATH ||= path.join(app.getPath("userData"), "ocr-cache");

    if (!devUrl) {
      server = createServer();
      server.on("error", (error) => {
        dialog.showErrorBox(
          "Harness Aurora",
          `Não foi possível iniciar o servidor local (${error.message}). Feche outras instâncias do app e tente novamente.`,
        );
        app.quit();
      });
      await new Promise((resolve) => server.listen(PORT, HOST, resolve));
      startUrl = `http://${HOST}:${server.address().port}/`;
    }

    await createWindow(startUrl);

    const registeredShortcut = !testing && QUICK_CAPTURE_SHORTCUT_CANDIDATES.find((combo) => globalShortcut.register(combo, openQuickCapture));
    if (registeredShortcut) {
      console.log(`Atalho de captura rápida registrado: ${registeredShortcut}`);
    } else {
      console.warn("Nenhum atalho global de captura rápida pôde ser registrado (todos já em uso por outros programas).");
    }

    if (!testing) createTray(startUrl, registeredShortcut);

    app.on("activate", () => showMainWindow(startUrl));

    if (app.isPackaged && !testing) {
      autoUpdater.checkForUpdates().catch((error) => {
        // Sem internet ou sem release publicada ainda: não impede o uso do
        // app — mas agora fica registrado em updaterState (visível em
        // Configurações) em vez de desaparecer sem deixar rastro.
        setUpdaterState({ status: "error", message: error?.message || "Falha ao verificar atualizações." });
      });
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    if (server) server.close();
    void closeBrowserContext();
    void terminateOcr();
  });
}
