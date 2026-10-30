// The backend in its own process (Electron utilityProcess, started by electron/main.js). A native
// crash here ("bad_optional_access was thrown in -fno-exceptions mode", 29/10/2026) takes only this
// process down: the window and the tray stay, and main starts the backend again.
// Messages to main: ready, error, approval, bi-alert, agent-run, memory. From main: battery, memory, shutdown.
import { createServer } from "../app/server.js";
import { createMemory } from "../app/store.js";
import { closeBrowserContext } from "../app/browserAgent.js";
import { terminateOcr } from "../app/ocr.js";
import { onAutomaticRun } from "../app/agentScheduler.js";
import { biEvents } from "../app/powerbiChanges.js";
import { stopMcpServers } from "../app/mcp.js";
import { approvalEvents } from "../app/pendingTurns.js";
import { setMapPauseCheck } from "../app/computerMap.js";

const parent = process.parentPort;
const post = (message) => parent.postMessage(message);
const PORT = Number(process.env.HARNESS_PORT || 8787);
const HOST = "127.0.0.1";

let onBattery = false;
setMapPauseCheck(() => onBattery);
approvalEvents.on("requested", ({ conversationId, summary }) => post({ type: "approval", conversationId, summary: String(summary || "") }));
biEvents.on("alert", ({ title, body }) => post({ type: "bi-alert", title: String(title || ""), body: String(body || "") }));
onAutomaticRun((agent, run) => post({
  type: "agent-run",
  agent: { name: agent?.name },
  run: { status: run?.status, request: run?.request, error: run?.error, files: run?.files?.length || 0 },
}));

const server = createServer();
server.on("error", (error) => { post({ type: "error", message: error.message }); process.exit(1); });
server.listen(PORT, HOST, () => post({ type: "ready", port: server.address().port }));

async function shutdown() {
  server.close();
  stopMcpServers();
  await Promise.allSettled([closeBrowserContext(), terminateOcr()]);
  process.exit(0);
}

parent.on("message", async ({ data }) => {
  if (data?.type === "battery") onBattery = Boolean(data.value);
  else if (data?.type === "shutdown") await shutdown();
  else if (data?.type === "memory") {
    try { post({ type: "memory", id: data.id, memory: await createMemory(data.memory) }); }
    catch (error) { post({ type: "memory", id: data.id, error: error.message }); }
  }
});
