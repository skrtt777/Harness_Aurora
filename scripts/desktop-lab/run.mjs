// Laboratório das ferramentas de programas do Windows, numa janela de teste própria (nunca nos
// programas da pessoa). node scripts/desktop-lab/run.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
process.env.AURORA_DESKTOP_LAB = "1";
const { executeTool } = await import("../../app/agentTools/index.js");
const { stopDesktop } = await import("../../app/desktop.js");

const title = `Aurora Teste ${Math.random().toString(36).slice(2, 8)}`;
const form = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./test-window.ps1", import.meta.url)), "-Title", title], { stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const asked = [];
const ctx = { mode: "auto", approve: async (request) => { asked.push(request.summary); return true; }, alwaysAllow: [] };
const tool = async (name, args) => { const out = await executeTool(name, args, ctx); return out; };
const refOf = (text, pattern) => new RegExp(`\\[(d\\d+)\\] ${pattern}`).exec(text)?.[1];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

try {
  await wait(2500);
  const list = await tool("desktop_windows", {});
  check("lista a janela de teste", list.result.includes(title));
  const snap = await tool("desktop_snapshot", { window: title });
  console.log(snap.result.split("\n").slice(0, 14).join("\n"));
  const nameRef = refOf(snap.result, 'Edit "Nome do cliente"');
  const cityRef = refOf(snap.result, 'ComboBox "Cidade"');
  const vipRef = refOf(snap.result, 'CheckBox "Cliente VIP"');
  const saveRef = refOf(snap.result, 'Button "Salvar"');
  check("vê campo, seleção, opção e botão com refs", Boolean(nameRef && cityRef && vipRef && saveRef), [nameRef, cityRef, vipRef, saveRef].join(" "));
  const typed = await tool("desktop_type", { ref: nameRef, text: "Empório Central (teste)" });
  check("digita no campo", typed.ok && /Empório Central \(teste\)/.test(typed.result), typed.result.split("\n")[0]);
  check("pediu autorização uma vez para o programa", asked.length === 1, asked[0]);
  const vip = await tool("desktop_click", { ref: vipRef });
  check("marca a opção", vip.ok && /Cliente VIP" \([^)]*marcado/.test(vip.result), vip.result.split("\n")[0]);
  const opened = await tool("desktop_click", { ref: cityRef });
  const recife = refOf(opened.result, 'ListItem "Recife"');
  check("abre a caixa de seleção e vê as opções", Boolean(recife), opened.result.split("\n").filter((l) => /ListItem/.test(l)).join(" ").slice(0, 120));
  if (recife) await tool("desktop_click", { ref: recife });
  const saveNow = refOf((await tool("desktop_snapshot", { window: title })).result, 'Button "Salvar"');
  const saved = await tool("desktop_click", { ref: saveNow });
  check("salva e lê o resultado na tela", /Salvo: Empório Central \(teste\) \| Recife \| VIP=True/.test(saved.result), (/Salvo:[^"\n]*/.exec(saved.result) || ["?"])[0]);
  check("não pediu de novo depois de autorizado", asked.length === 1, `${asked.length} pedido(s)`);
  const blocked = await tool("desktop_snapshot", { window: "Aurora" }).catch((e) => ({ ok: false, result: e.message }));
  check("recusa controlar a própria Aurora", !blocked.ok || /protegido|Nenhuma janela/.test(blocked.result), blocked.result.split("\n")[0]);
  const plan = await executeTool("desktop_click", { ref: saveNow }, { ...ctx, mode: "plan", desktopApproved: new Set() });
  check("modo Plano não clica", plan.denied === true);
} finally {
  form.kill();
  stopDesktop();
}
const ok = results.filter((r) => r.ok).length;
console.log(`\nNota: ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
