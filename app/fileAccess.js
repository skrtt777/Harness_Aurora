import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Where Aurora may look without asking, for the two ways of using it:
 * - personal: "full computer access" — read and search any drive, without pointing folders,
 *   except places that hold secrets or the system itself (those still ask);
 * - company: sector folders on the network, SharePoint/OneDrive or a folder the person
 *   names, found automatically and confirmed before they become company knowledge.
 * Writing, deleting and commands keep the Auto-mode rules (inside the project, or ask).
 */

const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Every drive on Windows (C:\, D:\, F:\, mapped network drives); "/" elsewhere. */
export function computerRoots({ exists = existsSync } = {}) {
  if (process.platform !== "win32") return ["/"];
  return "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((root) => { try { return exists(root); } catch { return false; } });
}

// Secrets and the system: reading these always asks, even with full access.
const SENSITIVE = [
  /[\\/]windows[\\/]/i, /^[a-z]:[\\/]windows$/i, /[\\/]program files( \(x86\))?([\\/]|$)/i, /[\\/]programdata[\\/]/i,
  /[\\/]\.ssh([\\/]|$)/i, /[\\/]\.gnupg([\\/]|$)/i, /[\\/]\.aws([\\/]|$)/i, /[\\/]\.azure([\\/]|$)/i, /[\\/]\.docker[\\/]config\.json$/i,
  /[\\/]appdata[\\/]roaming[\\/]microsoft[\\/](credentials|protect|crypto|systemcertificates)/i,
  /[\\/](google[\\/]chrome|microsoft[\\/]edge|bravesoftware[\\/]brave-browser|opera software)[\\/]user data/i,
  /[\\/]mozilla[\\/]firefox[\\/]profiles/i,
  /\.(kdbx|kdb|pfx|p12|pem|key|ovpn|ppk)$/i, /(^|[\\/])\.env(\.[a-z]+)?$/i, /(^|[\\/])(id_rsa|id_ed25519)(\.pub)?$/i,
  /[\\/]\$recycle\.bin([\\/]|$)/i, /[\\/]system volume information([\\/]|$)/i,
];
export const isSensitivePath = (path) => SENSITIVE.some((re) => re.test(String(path)));

/** Sector names as companies write them on folders, with their usual variants. */
export const DEPARTMENTS = {
  RH: ["rh", "recursos humanos", "gente e gestao", "gestao de pessoas", "pessoas", "departamento pessoal", "dp", "hr"],
  Financeiro: ["financeiro", "financas", "tesouraria", "contas a pagar", "contas a receber", "finance"],
  Controladoria: ["controladoria", "controller", "orcamento", "custos", "planejamento financeiro"],
  Fiscal: ["fiscal", "tributario", "impostos", "contabilidade", "contabil", "accounting"],
  "Jurídico": ["juridico", "legal", "contratos"],
  Comercial: ["comercial", "vendas", "sales", "pre-vendas"],
  Marketing: ["marketing", "mkt", "comunicacao", "comunicacao e marketing"],
  Compras: ["compras", "suprimentos", "procurement"],
  "Logística": ["logistica", "expedicao", "transporte", "frota", "estoque", "almoxarifado", "armazem"],
  "Produção": ["producao", "fabrica", "industrial", "operacoes", "manutencao", "pcp"],
  Qualidade: ["qualidade", "sgq", "garantia da qualidade", "controle de qualidade"],
  SSMA: ["ssma", "sesmt", "seguranca do trabalho", "sst", "meio ambiente", "hse", "ehs"],
  TI: ["ti", "tecnologia", "tecnologia da informacao", "informatica", "it", "sistemas"],
  Diretoria: ["diretoria", "presidencia", "conselho", "board"],
  Administrativo: ["administrativo", "adm", "administracao", "facilities", "recepcao", "servicos gerais"],
  Atendimento: ["sac", "atendimento", "suporte ao cliente", "pos-vendas", "customer service"],
};

/** The department a folder name stands for ("02 - Recursos Humanos" → RH), or null. */
export function departmentOf(name) {
  const plain = fold(name).replace(/^[\d\s._-]+/, "").replace(/[_]+/g, " ").trim();
  for (const [department, names] of Object.entries(DEPARTMENTS)) {
    for (const n of names) {
      if (plain === n) return department;
      // Whole words inside a longer name: "Pasta do RH", "Financeiro 2026", "RH - Documentos".
      if (n.length >= 3 || n === "rh" || n === "ti" || n === "dp") {
        if (new RegExp(`(^|[^a-z0-9])${n.replace(/[-]/g, "\\-")}([^a-z0-9]|$)`).test(plain)) return department;
      }
    }
  }
  return null;
}

/** Up to `limit` documents under a folder (shallow count, for showing the size of a suggestion). */
function countDocuments(dir, limit = 2000) {
  let n = 0;
  const stack = [dir];
  while (stack.length && n < limit) {
    const current = stack.pop();
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      if (e.isDirectory()) stack.push(join(current, e.name));
      else if (/\.(docx|xlsx|pptx|pdf|txt|md|csv|rtf|png|jpe?g)$/i.test(e.name)) n += 1;
    }
  }
  return n;
}

/** Network drives (Windows), as \\server\share → letter, so suggestions show where they live. */
export function networkDrives() {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => execFile("powershell", ["-NoProfile", "-Command", "Get-PSDrive -PSProvider FileSystem | Where-Object { $_.DisplayRoot -like '\\\\*' } | ForEach-Object { $_.Root + '|' + $_.DisplayRoot }"], { timeout: 15_000, windowsHide: true },
    (error, stdout) => resolve(error ? [] : String(stdout).split(/\r?\n/).filter(Boolean).map((line) => { const [root, share] = line.split("|"); return { root: root.trim(), share: share?.trim() }; }))));
}

/** Folders that usually hold company documents on this computer. */
export async function companyCandidateRoots(env = process.env) {
  const roots = [];
  for (const d of await networkDrives()) roots.push({ path: d.root, origin: `unidade de rede ${d.share}` });
  // OneDrive for Business and SharePoint libraries synced by it ("Empresa - Documentos").
  if (env.OneDriveCommercial && existsSync(env.OneDriveCommercial)) roots.push({ path: env.OneDriveCommercial, origin: "OneDrive da empresa" });
  const home = env.USERPROFILE || homedir();
  try {
    for (const name of readdirSync(home)) {
      const full = join(home, name);
      if (/ - /.test(name) || (env.OneDriveCommercial && fold(basename(env.OneDriveCommercial)).includes(fold(name)))) {
        try { if (statSync(full).isDirectory() && !roots.some((r) => r.path === full)) roots.push({ path: full, origin: "SharePoint sincronizado" }); } catch { /* not a folder */ }
      }
    }
  } catch { /* no home */ }
  return roots;
}

/**
 * Sector folders under the given roots (and their first level of libraries): each with the
 * department its name stands for and how many documents it has. Nothing is registered here;
 * the person confirms the list.
 */
export async function discoverCompanyFolders({ roots = [], env = process.env, depth = 2 } = {}) {
  const candidates = [...roots.map((path) => ({ path, origin: "pasta indicada" })), ...(roots.length ? [] : await companyCandidateRoots(env))];
  const found = [];
  const seen = new Set();
  const visit = (dir, origin, level) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("$")) continue;
      const full = join(dir, e.name);
      const department = departmentOf(e.name);
      if (department) {
        if (!seen.has(fold(full))) { seen.add(fold(full)); found.push({ path: full, department, name: e.name, origin, documents: countDocuments(full) }); }
      } else if (level < depth) visit(full, origin, level + 1);
    }
  };
  for (const c of candidates) if (existsSync(c.path)) visit(c.path, c.origin, 1);
  return found.sort((a, b) => a.department.localeCompare(b.department) || b.documents - a.documents);
}

/** Folders a person usually wants Aurora to know by meaning (personal use). */
export function personalFolders(env = process.env) {
  const home = env.USERPROFILE || homedir();
  const oneDrive = env.OneDrive && existsSync(env.OneDrive) ? env.OneDrive : null;
  const pick = (name, alt) => [oneDrive && join(oneDrive, alt || name), join(home, name)].find((p) => p && existsSync(p));
  return [
    { name: "Documentos", path: pick("Documents", "Documentos") },
    { name: "Área de Trabalho", path: pick("Desktop", "Área de Trabalho") },
    { name: "Downloads", path: pick("Downloads") },
  ].filter((f) => f.path);
}
