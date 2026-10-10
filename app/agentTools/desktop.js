// Ferramentas para programas do Windows (Access, Excel, sistemas da empresa): ver a janela como texto
// e agir pelos refs, como no navegador. Ver é livre; clicar, digitar e apertar teclas pede
// autorização por programa (app/agentPolicy.js, kind "desktop").
import { BLOCKED_PROGRAMS, desktopRequest, programOf, programOfRef, rememberRefs } from "../desktop.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = (reply, sql = "") => {
  if (reply.ok) return reply.text;
  // A yes/no column compared with 'Sim'/'Não': said how, instead of a bare type error.
  if (/tipo de dados|type mismatch|incompat/i.test(reply.error || "") && /'(sim|não|nao|s|n|yes|no)'/i.test(sql)) throw new Error(`${reply.error} Colunas sim/não do Access usam True ou False (ex.: WHERE VIP = True), não 'Sim'.`);
  throw new Error(reply.error);
};
// A relative path is the project's (like the file tools); "Documentos/x.accdb" works too.
const accessPath = (path, ctx = {}) => {
  const value = String(path || "").trim();
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")) return value;
  const folders = ctx.knownFolders || {};
  const named = /^(documentos|documents)[\\/](.*)$/i.exec(value) || /^(downloads)[\\/](.*)$/i.exec(value) || /^(desktop|área de trabalho|area de trabalho)[\\/](.*)$/i.exec(value);
  if (named) {
    const base = /^doc/i.test(named[1]) ? folders.documents : /^down/i.test(named[1]) ? folders.downloads : folders.desktop;
    if (base) return `${base}\\${named[2]}`.replace(/\//g, "\\");
  }
  return ctx.workspace ? `${ctx.workspace}\\${value}`.replace(/\//g, "\\") : value;
};
// The lab's own test window (scripts/desktop-lab) is a PowerShell form: allowed only there.
const labWindow = (title) => process.env.AURORA_DESKTOP_LAB === "1" && /^Aurora Teste [a-z0-9]{6}$/.test(String(title || ""));

async function snapshot(window, max = 250) {
  const reply = await desktopRequest("snapshot", { window, max });
  if (!reply.ok) throw new Error(reply.error);
  const program = programOf(reply.text);
  if (program && BLOCKED_PROGRAMS.test(program) && !labWindow(reply.window)) throw new Error(`A Aurora não controla ${program} (programa protegido).`);
  rememberRefs(reply.text, program, reply.window);
  return reply.text;
}

// After an action, the window again: the refs that are there now (a menu opened, a dialog appeared).
async function after(message, window) {
  await wait(450);
  const next = await snapshot(window, 160).catch((error) => `(não consegui ver a janela de novo: ${error.message})`);
  return `${message}\n\n${next}`;
}

function guard(ref) {
  const owner = programOfRef(ref);
  if (!owner) throw new Error(`Não conheço o ref "${ref}". Veja a janela com desktop_snapshot e use um ref da lista.`);
  if (owner.program && BLOCKED_PROGRAMS.test(owner.program) && !labWindow(owner.window)) throw new Error(`A Aurora não controla ${owner.program} (programa protegido).`);
  return owner;
}

const describeAction = (verb) => (args) => {
  const owner = programOfRef(args.ref) || (args.window ? { program: args.window, window: args.window } : null);
  return { kind: "desktop", program: owner?.program || "programa", summary: `${verb} em ${owner?.window || owner?.program || "um programa"}${args.text ? `: "${String(args.text).slice(0, 60)}"` : args.keys ? `: ${args.keys}` : ""}` };
};

export const desktopTools = [
  {
    name: "desktop_windows",
    description: "Lista as janelas de programas abertas no computador (Access, Excel, Word, sistemas…). Use antes de desktop_snapshot quando não souber o nome da janela.",
    parameters: { type: "object", properties: {} },
    stage: () => "Vendo os programas abertos…",
    describe: () => ({ kind: "meta" }),
    async run() {
      const reply = await desktopRequest("windows");
      if (!reply.ok) throw new Error(reply.error);
      return reply.text;
    },
  },
  {
    name: "desktop_snapshot",
    description: "Mostra uma janela de programa como texto: botões, menus, campos, abas, listas e tabelas, cada um com um ref (ex.: d12). window: parte do título ou o nome do programa (ex.: \"Access\", \"Excel\", \"Pedidos\"). Use antes de clicar ou digitar. Para abrir o programa, use open.",
    parameters: { type: "object", properties: { window: { type: "string", description: "parte do título da janela ou nome do programa" } } },
    stage: (a) => `Olhando a janela ${a.window || ""}…`,
    describe: () => ({ kind: "meta" }),
    async run({ window }) {
      return snapshot(window);
    },
  },
  {
    name: "desktop_click",
    description: "Clica num elemento de um programa pelo ref do desktop_snapshot (botão, menu, aba, item de lista, célula). Devolve a janela atualizada.",
    parameters: { type: "object", properties: { ref: { type: "string", description: "ref do desktop_snapshot, ex.: d12" } }, required: ["ref"] },
    stage: (a) => `Clicando em ${a.ref}…`,
    describe: describeAction("Clicar"),
    async run({ ref }) {
      const owner = guard(ref);
      const reply = await desktopRequest("click", { ref });
      if (!reply.ok) throw new Error(reply.error);
      return after(reply.text, owner.window);
    },
  },
  {
    name: "desktop_type",
    description: "Escreve num campo de um programa pelo ref do desktop_snapshot. Num campo de formulário, substitui o que havia; num editor de texto, insere no cursor. submit=true aperta Enter depois.",
    parameters: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } }, required: ["ref", "text"] },
    stage: (a) => `Digitando "${String(a.text).slice(0, 40)}"…`,
    describe: describeAction("Digitar"),
    async run({ ref, text, submit }) {
      const owner = guard(ref);
      const reply = await desktopRequest("type", { ref, text: String(text), submit: Boolean(submit) });
      if (!reply.ok) throw new Error(reply.error);
      return after(reply.text, owner.window);
    },
  },
  {
    name: "desktop_copy",
    description: "Lê o conteúdo de uma grade ou tabela que o desktop_snapshot não mostra (a folha de dados do Access, grades de sistemas): seleciona tudo e copia, como uma pessoa faria, e devolve as linhas em texto. Clique antes na grade (desktop_click) se ela não estiver em foco. A área de transferência da pessoa é restaurada.",
    parameters: { type: "object", properties: { window: { type: "string" } }, required: ["window"] },
    stage: (a) => `Copiando o conteúdo de ${a.window}…`,
    describe: describeAction("Copiar o conteúdo"),
    async run({ window }) {
      await snapshot(window, 1);
      const reply = await desktopRequest("copy", { window, all: true });
      if (!reply.ok) throw new Error(reply.error);
      return reply.text;
    },
  },
  {
    name: "access_db",
    description: "Lê e altera um banco do Access (.accdb/.mdb) direto no arquivo, sem a tela: mais rápido e certo que clicar. action=tables lista as tabelas e colunas; action=query roda um SELECT (ex.: SELECT Nome, Limite FROM Clientes WHERE Cidade='Salvador'); action=change roda INSERT ou UPDATE (pede autorização). path: o arquivo .accdb.",
    parameters: { type: "object", properties: { path: { type: "string" }, action: { type: "string", enum: ["tables", "query", "change"] }, sql: { type: "string" } }, required: ["path", "action"] },
    stage: (a) => (a.action === "change" ? "Alterando o banco do Access…" : "Lendo o banco do Access…"),
    describe: (a, ctx) => {
      const path = accessPath(a.path, ctx);
      return a.action === "change" ? { kind: "write", paths: [path], summary: `Alterar ${path}: ${String(a.sql || "").slice(0, 120)}` } : { kind: "read", paths: [path] };
    },
    async run({ path, action, sql }, ctx) {
      const file = accessPath(path, ctx);
      if (!/\.(accdb|mdb)$/i.test(file)) throw new Error("access_db é para arquivos do Access (.accdb ou .mdb).");
      if (action === "tables") return answer(await desktopRequest("db_tables", { path: file }));
      const text = String(sql || "").trim();
      if (!text) throw new Error("Diga o SQL (sql).");
      if (action === "query") {
        if (!/^\s*select\b/i.test(text) || /;\s*\S/.test(text)) throw new Error("Em action=query use um SELECT só. Para alterar, action=change.");
        return answer(await desktopRequest("db_query", { path: file, sql: text }), text);
      }
      // Changes: one INSERT or UPDATE; never a table dropped or altered, never every row deleted or
      // updated by a statement with no WHERE.
      if (/;\s*\S/.test(text) || /^\s*(drop|alter|create|truncate)\b/i.test(text)) throw new Error("Só INSERT, UPDATE ou DELETE com WHERE, um comando por vez. Apagar ou mudar a estrutura de tabelas é com a pessoa.");
      if (/^\s*(update|delete)\b/i.test(text) && !/\bwhere\b/i.test(text)) throw new Error("UPDATE ou DELETE sem WHERE mexe em todas as linhas: diga quais (WHERE).");
      if (!/^\s*(insert|update|delete)\b/i.test(text)) throw new Error("Em action=change use INSERT, UPDATE ou DELETE com WHERE.");
      return answer(await desktopRequest("db_exec", { path: file, sql: text }), text);
    },
  },
  {
    name: "desktop_key",
    description: "Aperta teclas num programa (window: parte do título). Formato: ^s (Ctrl+S), %f (Alt+F), {ENTER}, {TAB}, {ESC}, {F5}, {DOWN}. Use para atalhos e para confirmar diálogos.",
    parameters: { type: "object", properties: { keys: { type: "string" }, window: { type: "string" } }, required: ["keys", "window"] },
    stage: (a) => `Apertando ${a.keys}…`,
    describe: describeAction("Apertar teclas"),
    async run({ keys, window }) {
      // The window first: its program is checked against the protected list before any key goes out.
      await snapshot(window, 1);
      // Closing a window or the computer is not a shortcut the Aurora sends.
      if (/%\{?F4\}?|\^%\{?(DEL|DELETE)\}?/i.test(String(keys))) throw new Error("A Aurora não fecha janelas nem aciona o Ctrl+Alt+Del por atalho; peça à pessoa.");
      const reply = await desktopRequest("key", { keys: String(keys), window });
      if (!reply.ok) throw new Error(reply.error);
      return after(reply.text, window);
    },
  },
];
