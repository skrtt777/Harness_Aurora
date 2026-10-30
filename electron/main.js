import { app, BrowserWindow, dialog, Tray, Menu, Notification, globalShortcut, ipcMain, powerMonitor, screen, shell, utilityProcess } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

let backend;
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
  const memory = {
    scope: "global",
    title: deriveQuickCaptureTitle(trimmed),
    content: trimmed,
    kind: "manual",
    source: "Captura rápida (atalho global)",
  };
  // In development the backend is `npm start`, not a child of this process: same database, written here.
  if (devUrl) return (await import("../app/store.js")).createMemory(memory);
  return backendCall({ type: "memory", memory });
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

// Files the agent delivered ("Criei C:\…\proposta.docx"): open them or show them in
// Explorer from the chat. Only documents open; an executable would run.
const OPENABLE = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".md", ".csv", ".txt", ".html", ".htm", ".json", ".png", ".jpg", ".jpeg", ".svg", ".rtf"]);
ipcMain.handle("shell:open-file", async (event, file, reveal) => {
  if (!trustedSender(event, mainWindow)) throw new Error("Origem IPC inválida.");
  const target = path.resolve(String(file || ""));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error("Arquivo não encontrado.");
  if (reveal) { shell.showItemInFolder(target); return true; }
  if (!OPENABLE.has(path.extname(target).toLowerCase())) throw new Error("Esse tipo de arquivo não é aberto pelo chat.");
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
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

// The backend runs in electron/backend.js, a process of its own. When it dies (a native crash), the
// programs it started (llama-server, MCP servers, CLIs) are closed, it starts again and the window
// reloads on it. Three deaths in a minute: it says so and closes.
const backendCalls = new Map();
let backendCallId = 0;
let backendDeaths = [];

function backendCall(message) {
  if (!backend) return Promise.reject(new Error("O servidor da Aurora está reiniciando. Tente de novo em instantes."));
  const id = ++backendCallId;
  return new Promise((resolve, reject) => {
    backendCalls.set(id, { resolve, reject });
    backend.postMessage({ ...message, id });
  });
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const note = new Notification({ title, body });
  if (onClick) note.on("click", onClick);
  note.show();
}

function onBackendMessage(message) {
  if (message.type === "memory") {
    const call = backendCalls.get(message.id);
    backendCalls.delete(message.id);
    if (message.error) call?.reject(new Error(message.error));
    else call?.resolve(message.memory);
  } else if (message.type === "approval") {
    // An agent (or a chat left working) waiting for a yes while the window is behind: say so, or the
    // request times out unseen. The click opens the conversation with the Permitir/Negar card.
    if (mainWindow?.isVisible() && mainWindow.isFocused()) return;
    notify("A Aurora precisa da sua autorização", message.summary.slice(0, 120), () => {
      mainWindow?.show(); mainWindow?.focus(); mainWindow?.webContents.send("app:open-conversation", message.conversationId);
    });
  } else if (message.type === "bi-alert") {
    // A BI the Aurora keeps current got worse (more late, a number past its limit): say so.
    notify((message.title || "Power BI").slice(0, 90), message.body.slice(0, 160), () => { mainWindow?.show(); mainWindow?.focus(); });
  } else if (message.type === "agent-run") {
    // A scheduled or folder-triggered agent finished: tell the person, even with the window closed.
    const { agent, run } = message;
    const ok = run.status === "done";
    const files = run.files ? ` Entregou ${run.files} arquivo(s).` : "";
    notify(`${agent.name} ${ok ? "terminou" : "não conseguiu terminar"}`, ok ? `${String(run.request || "").slice(0, 80)}${files}` : String(run.error || "Veja o histórico do agente.").slice(0, 120), () => {
      mainWindow?.show(); mainWindow?.focus(); mainWindow?.webContents.send("app:show-agents");
    });
  }
}

const onBattery = () => { try { return powerMonitor.isOnBatteryPower(); } catch { return false; } };

/** What a dead backend left running (its children keep its PID as parent): closed with their trees. */
function closeOrphans(pid, startedAt) {
  if (process.platform !== "win32" || !pid) return Promise.resolve();
  const since = startedAt.toISOString();
  const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Where-Object { $_.CreationDate -ge [datetime]'${since}' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`;
  return new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20_000 }, () => resolve()));
}

function startBackend() {
  const startedAt = new Date(Date.now() - 1000);
  const child = utilityProcess.fork(path.join(path.dirname(fileURLToPath(import.meta.url)), "backend.js"), [], { serviceName: "Harness Aurora (servidor)", stdio: "inherit" });
  backend = child;
  let pid;
  let ready = false;
  child.once("spawn", () => { pid = child.pid; child.postMessage({ type: "battery", value: onBattery() }); });
  const started = new Promise((resolve, reject) => {
    child.on("message", (message) => {
      if (message?.type === "ready") { ready = true; resolve(message.port); }
      else if (message?.type === "error") reject(new Error(message.message));
      else if (message) onBackendMessage(message);
    });
    child.once("exit", (code) => reject(new Error(`o servidor saiu (código ${code})`)));
  });
  child.once("exit", async (code) => {
    if (backend === child) backend = undefined;
    for (const call of backendCalls.values()) call.reject(new Error("O servidor da Aurora reiniciou. Tente de novo."));
    backendCalls.clear();
    if (isQuitting || !ready) return;
    console.error(`[aurora] o servidor caiu (código ${code}); reiniciando.`);
    await closeOrphans(pid, startedAt);
    backendDeaths = [...backendDeaths.filter((t) => Date.now() - t < 60_000), Date.now()];
    if (backendDeaths.length >= 3) {
      dialog.showErrorBox("Harness Aurora", "O servidor local da Aurora caiu três vezes em um minuto. Abra o app de novo; se continuar, avise o suporte.");
      isQuitting = true;
      app.quit();
      return;
    }
    startBackend().then(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }).catch((error) => console.error(`[aurora] o servidor não voltou: ${error.message}`));
  });
  return started;
}

/** Asks the backend to close what it opened (browser, OCR, MCP servers, llama-server); 5 s, then forced. */
function stopBackend() {
  const child = backend;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.postMessage({ type: "shutdown" });
  });
}

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
      try {
        startUrl = `http://${HOST}:${await startBackend()}/`;
      } catch (error) {
        dialog.showErrorBox(
          "Harness Aurora",
          `Não foi possível iniciar o servidor local (${error.message}). Feche outras instâncias do app e tente novamente.`,
        );
        isQuitting = true;
        app.quit();
        return;
      }
    }

    // The computer map waits while the notebook runs on battery.
    powerMonitor.on("on-battery", () => backend?.postMessage({ type: "battery", value: true }));
    powerMonitor.on("on-ac", () => backend?.postMessage({ type: "battery", value: false }));

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

  app.on("before-quit", (event) => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    if (!backend) return;
    // The backend closes what it opened first, then the app quits.
    event.preventDefault();
    stopBackend().then(() => app.quit());
  });
}
