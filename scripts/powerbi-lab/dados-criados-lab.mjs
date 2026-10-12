// The Power BI of data the Aurora created herself, as on 12/10 ("crie dados de uma empresa com mais de
// 300 funcionários por departamento e carros; faça planilhas e monte um Power BI"): the spreadsheets are
// written by write_document's renderer from exactly what she wrote (tables with | and no pipes at the
// ends, Brazilian numbers), the BI is built and opened in a test Power BI, and every data table must
// have its rows (that day three reports opened empty). Closes only the Power BI it opened.
// node scripts/powerbi-lab/dados-criados-lab.mjs
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { renderDocument } = await import("../../app/documentWriter.js");
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");

if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes."); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "aurora-dados-criados-"));
const files = {
  "Departamentos_RandomCorp.xlsx": "Departamento | Funcionários | Gerente | Orçamento (R$)\nEngenharia | 312 | João Silva | 8.500.000,00\nVendas | 345 | Roberto Costa | 9.200.000,00\nAdministrativo | 320 | Lucas Pereira | 7.800.000,00\nComercial | 357 | André Ferreira | 10.100.000,00\nFinanceiro | 321 | Felipe Rocha | 8.900.000,00\nRecursos Humanos | 315 | Julia Martins | 7.500.000,00\nJurídico | 308 | Eduardo Santos | 6.400.000,00\n",
  "Funcionarios_RandomCorp.xlsx": "Nome | Cargo | Departamento | Admissão\nJoão Silva | Engenheiro Chefe | Engenharia | 05/01/2008\nMaria Santos | Analista de Projetos | Engenharia | 12/03/2010\nCarlos Oliveira | Técnico de Fabricação | Engenharia | 08/06/2011\nRoberto Costa | Gerente de Vendas | Vendas | 01/02/2009\nPatricia Lima | Consultora Comercial | Vendas | 14/05/2010\nLucas Pereira | Coordenador | Administrativo | 22/03/2016\nAndré Ferreira | Diretor Comercial | Comercial | 10/10/2012\nFelipe Rocha | Contador | Financeiro | 12/11/2015\nJulia Martins | Analista de RH | Recursos Humanos | 03/04/2018\nEduardo Santos | Advogado | Jurídico | 19/01/2017\n",
  "Frota_RandomCorp.xlsx": "Modelo | Placa | Cor | Departamento | Valor de Mercado (R$)\nBMW Série 5 | ABC-1234 | Prata | Engenharia | 385000,00\nMercedes Classe C | DEF-5678 | Preto | Vendas | 412000,00\nAudi A6 | GHI-9012 | Cinza | Administrativo | 356000,00\nBMW Série 7 | JKL-3456 | Preto | Comercial | 628000,00\nMercedes Classe S | MNO-7890 | Prata | Financeiro | 695000,00\nToyota Corolla | PQR-2345 | Branco | Recursos Humanos | 158000,00\nHonda Civic | STU-6789 | Prata | Jurídico | 185000,00\nVolkswagen Golf | VWX-0123 | Preto | Administrativo | 142000,00\n",
};
const paths = [];
for (const [name, content] of Object.entries(files)) { const p = join(dir, name); writeFileSync(p, await renderDocument("xlsx", content)); paths.push(p); }

let opened = null; let failed = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "ok " : "FALHOU"} ${label}${detail ? `: ${detail}` : ""}`); if (!ok) failed += 1; };
try {
  const r = await buildReport({ files: paths, folder: join(dir, "Power BI"), name: "RandomCorp", goal: "painel interativo da empresa: departamentos com mais de 300 funcionários, colaboradores e frota de carros", onStage: (s) => console.log(`  … ${s}`) });
  opened = r.opened;
  check("abriu no Power BI", Boolean(r.opened?.port));
  console.log(`  ${r.refreshed}`);
  for (const table of ["Departamentos_RandomCorp", "Funcionarios_RandomCorp", "Frota_RandomCorp"]) {
    const m = new RegExp(`${table.replace(/_/g, "[ _]?")}\\S* (\\d+)`, "i").exec(r.refreshed);
    check(`tabela ${table} com linhas`, !!m && Number(m[1]) > 0, m ? `${m[1]} linhas` : "não apareceu");
  }
  const total = await pbiRequest("query", { dax: "EVALUATE ROW(\"Frota\", SUM('Frota RandomCorp'[Valor de Mercado (R$)]), \"Funcionários\", SUM('Departamentos RandomCorp'[Funcionários]))", max: 3 }).catch((e) => ({ ok: false, error: e.message }));
  check("valores somam como números", total.ok && /2961000/.test(String(total.text).replace(/[.,]/g, "")) && /2278/.test(String(total.text).replace(/[.,]/g, "")), total.ok ? total.text.replace(/\n/g, " / ") : total.error);
  console.log(`  cartões: ${String(r.cards || r.checks).replace(/\n/g, " / ")}`);
} catch (e) { check("montou o BI", false, e.message); }
finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(failed ? `${failed} com problema` : "tudo certo");
process.exit(failed ? 1 : 0);
