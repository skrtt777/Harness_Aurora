// The table "Clientes" of the lab's own Access database, opened, as the Aurora sees it.
import { spawn } from "node:child_process";
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
const access = spawn("C:\\Program Files\\Microsoft Office\\root\\Office16\\MSACCESS.EXE", [process.argv[2]], { stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await wait(8000);
  const snap = await desktopRequest("snapshot", { window: "msaccess", max: 60 });
  const table = /\[(d\d+)\] Button "Clientes"/.exec(snap.text)?.[1];
  console.log("tabela:", table, JSON.stringify(await desktopRequest("click", { ref: table })));
  await desktopRequest("key", { keys: "{ENTER}", window: "msaccess" });
  await wait(2000);
  const opened = await desktopRequest("snapshot", { window: "msaccess", max: 120 });
  console.log(opened.text.split("\n").filter((l) => !/Faixa|Ribbon|TabItem|Button "(Recortar|Copiar)/.test(l)).slice(0, 70).join("\n"));
} finally { access.kill(); stopDesktop(); }
process.exit(0);
