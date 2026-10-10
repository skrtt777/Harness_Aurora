// How the Access window looks to the Aurora, on the lab's own database (never the person's files).
import { spawn } from "node:child_process";
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
const db = process.argv[2];
const access = spawn("C:\\Program Files\\Microsoft Office\\root\\Office16\\MSACCESS.EXE", [db], { stdio: "ignore", detached: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await wait(9000);
  const list = await desktopRequest("windows");
  console.log(list.text);
  const snap = await desktopRequest("snapshot", { window: process.argv[3] || "msaccess", max: 140 });
  console.log(snap.ok ? snap.text : `ERRO ${snap.error}`);
} finally {
  if (process.argv.includes("--keep")) console.log(`(Access aberto, PID ${access.pid})`); else access.kill();
  stopDesktop();
}
process.exit(0);
