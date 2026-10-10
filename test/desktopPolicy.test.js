import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../app/agentPolicy.js";
import { BLOCKED_PROGRAMS } from "../app/desktop.js";

test("a program on the computer: asked once per program, never in Plan mode, 'Sempre permitir' kept", async () => {
  const access = { kind: "desktop", program: "MSACCESS" };
  assert.equal((await decide(access, { mode: "plan" })).action, "deny");
  const asked = await decide(access, { mode: "auto" });
  assert.equal(asked.action, "ask");
  assert.equal(asked.rule, "msaccess");
  assert.equal((await decide(access, { mode: "auto", desktopApproved: new Set(["msaccess"]) })).action, "allow", "authorized earlier in the turn");
  assert.equal((await decide(access, { mode: "manual", alwaysAllow: [{ tool: "desktop_type", prefix: "msaccess" }] })).action, "allow", "Sempre permitir");
  assert.equal((await decide({ kind: "desktop", program: "EXCEL" }, { mode: "auto", desktopApproved: new Set(["msaccess"]) })).action, "ask", "another program asks again");
});

test("the Aurora never drives itself, a terminal, the task manager, the registry or the password prompts", () => {
  for (const name of ["Harness Aurora", "WindowsTerminal", "powershell", "cmd", "Taskmgr", "regedit", "consent", "CredentialUIBroker", "AuroraUiaHost-1a2b3c4d5e6f"]) assert.ok(BLOCKED_PROGRAMS.test(name), name);
  for (const name of ["MSACCESS", "EXCEL", "WINWORD", "notepad", "ERPSistema"]) assert.ok(!BLOCKED_PROGRAMS.test(name), name);
});

test("a table in markdown becomes typed Excel cells: pt-BR numbers, dates, formulas (local when Portuguese)", async () => {
  const { excelRows } = await import("../app/agentTools/desktop.js");
  const rows = excelRows("| Produto | Qtd | Preço | Total | Validade | Margem |\n|---|---|---|---|---|---|\n| Pão | 120 | R$ 1.234,50 | =B2*C2 | 12/10/2026 | 15% |\n| Total | | | =SOMA(D2:D2) | | |");
  assert.deepEqual(rows[0], ["Produto", "Qtd", "Preço", "Total", "Validade", "Margem"]);
  assert.deepEqual(rows[1], ["Pão", 120, 1234.5, { formula: "=B2*C2", local: false }, { date: "2026-10-12" }, 0.15]);
  assert.deepEqual(rows[2][3], { formula: "=SOMA(D2:D2)", local: true });
});

test("live Excel only when the person asks for the Excel; 'crie uma planilha' alone stays a file", async () => {
  const { excelTools } = await import("../app/agentTools/desktop.js");
  const excel = excelTools.find((t) => t.name === "excel");
  await assert.rejects(excel.run({ action: "open" }, { request: "crie uma planilha com os formatos e preços", conversationId: "c1" }), /write_document/);
  await assert.rejects(excel.run({ action: "write", data: "| a |" }, { request: "faz uma planilha de gastos", conversationId: "c1" }), /write_document/);
});

test("markdown becomes Word blocks: headings, paragraphs, lists, a table", async () => {
  const { wordBlocks } = await import("../app/agentTools/desktop.js");
  const blocks = wordBlocks("# Orçamento\n\nPrezado **Marcos**,\n\n- Sala\n1. Prazo\n\n| Item | Valor |\n|---|---|\n| Sala | R$ 1.200 |");
  assert.deepEqual(blocks, [
    { t: "h1", x: "Orçamento" }, { t: "p", x: "Prezado **Marcos**," }, { t: "li", x: "Sala" }, { t: "ol", x: "Prazo" },
    { t: "table", rows: [["Item", "Valor"], ["Sala", "R$ 1.200"]] },
  ]);
});

test("live Word only when the person asks for the Word", async () => {
  const { wordTools } = await import("../app/agentTools/desktop.js");
  await assert.rejects(wordTools[0].run({ action: "open" }, { request: "crie um documento com a proposta", conversationId: "c1" }), /write_document/);
});

test("Windows settings and security windows are never driven; modern apps authorize by window", async () => {
  const { BLOCKED_WINDOWS, approvalKey } = await import("../app/desktop.js");
  for (const title of ["Configurações", "Segurança do Windows", "Controle de Conta de Usuário", "Settings"]) assert.ok(BLOCKED_WINDOWS.test(title), title);
  assert.ok(!BLOCKED_WINDOWS.test("Calculadora"));
  assert.equal(approvalKey("ApplicationFrameHost", "Calculadora"), "calculadora");
  assert.equal(approvalKey("EXCEL", "Pasta1 - Excel"), "excel");
});
