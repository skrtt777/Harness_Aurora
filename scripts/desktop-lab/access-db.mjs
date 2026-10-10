// access_db on the lab's own database (never the person's files). node scripts/desktop-lab/access-db.mjs <AuroraTeste.accdb>
import { dirname } from "node:path";
const { executeTool } = await import("../../app/agentTools/index.js");
const { stopDesktop } = await import("../../app/desktop.js");
const db = process.argv[2];
const ctx = { mode: "auto", workspace: dirname(db), workspaceRoots: [dirname(db)], approve: async () => true, alwaysAllow: [] };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
try {
  const tables = await executeTool("access_db", { path: db, action: "tables" }, ctx);
  check("lista tabelas e colunas", /Clientes \(\d+ linha\(s\)\): Codigo, Nome, Cidade, VIP, Limite/.test(tables.result), tables.result.split("\n")[1]);
  const query = await executeTool("access_db", { path: db, action: "query", sql: "SELECT Nome, Limite FROM Clientes WHERE Limite > 6000 ORDER BY Limite DESC" }, ctx);
  check("consulta com filtro", /Padaria Pão Dourado \| 15000[\s\S]*Hotel Litoral Norte \| 8000/.test(query.result), query.result.replace(/\n/g, " ¶ "));
  const insert = await executeTool("access_db", { path: db, action: "change", sql: "INSERT INTO Clientes (Nome, Cidade, VIP, Limite) VALUES ('Empório Central (lab)', 'Salvador', True, 12000)" }, ctx);
  check("cadastra", /1 linha/.test(insert.result), insert.result);
  const back = await executeTool("access_db", { path: db, action: "query", sql: "SELECT Nome, VIP FROM Clientes WHERE Nome LIKE 'Empório%'" }, ctx);
  check("lê o cadastro novo", /Empório Central \(lab\) \| True/.test(back.result));
  const cleanup = await executeTool("access_db", { path: db, action: "change", sql: "DELETE FROM Clientes WHERE Nome = 'Empório Central (lab)'" }, ctx);
  check("apaga com WHERE", /1 linha/.test(cleanup.result));
  const noWhere = await executeTool("access_db", { path: db, action: "change", sql: "DELETE FROM Clientes" }, ctx);
  check("recusa apagar tudo sem WHERE", !noWhere.ok && /WHERE/.test(noWhere.result));
  const drop = await executeTool("access_db", { path: db, action: "change", sql: "DROP TABLE Clientes" }, ctx);
  check("recusa apagar a tabela", !drop.ok);
  const sneaky = await executeTool("access_db", { path: db, action: "query", sql: "SELECT * FROM Clientes; DELETE FROM Clientes WHERE 1=1" }, ctx);
  check("recusa comando escondido numa consulta", !sneaky.ok);
  const plan = await executeTool("access_db", { path: db, action: "change", sql: "UPDATE Clientes SET Limite = 0 WHERE Codigo = 1" }, { ...ctx, mode: "plan" });
  check("modo Plano não altera", plan.denied === true);
} finally { stopDesktop(); }
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
