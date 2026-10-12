import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderDocument, cellNumber } from "../app/documentWriter.js";
import { readSources } from "../app/powerbiDesign.js";
import { makeXlsx } from "../app/sampleDocs.js";
import { emptySourceTables } from "../app/powerbi.js";
import { requestedFormat } from "../app/agentTools/files.js";

// What the Aurora really wrote on 12/10 (the conversation "crie dados sobre uma empresa…" whose
// Power BI opened empty three times).
const dir = mkdtempSync(join(tmpdir(), "bi-data-"));
const save = async (name, format, content) => { const p = join(dir, name); writeFileSync(p, await renderDocument(format, content)); return p; };

test("BI data: a table written without the pipes at the ends is a real spreadsheet, with Brazilian numbers as numbers", async () => {
  const path = await save("Departamentos.xlsx", "xlsx", "Departamento | Funcionários | Gerente | Orçamento (R$)\nEngenharia | 312 | João Silva | 8.500.000,00\nVendas | 345 | Roberto Costa | 9.200.000,00\nJurídico | 287 | Eduardo Santos | 6.400.000,00\n");
  const [t] = readSources(path);
  assert.deepEqual(t.header, ["Departamento", "Funcionários", "Gerente", "Orçamento (R$)"]);
  assert.equal(t.rows.length, 3);
  assert.equal(Number(String(t.rows[0][3]).replace(/\./g, "").replace(",", ".")), 8500000);
  // Markdown tables and headings: one sheet per table, named by its heading.
  const two = await save("Empresa.xlsx", "xlsx", "# Empresa\n\n## Frota\n| Modelo | Placa | Valor |\n|---|---|---|\n| BMW Série 5 | ABC-1234 | R$ 385.000,00 |\n| Audi A6 | GHI-9012 | 356000,00 |\n| Golf | VWX-0123 | 142.000 |\n\n## Departamentos\n| Departamento | Funcionários |\n|---|---|\n| Vendas | 345 |\n| RH | 315 |\n| Jurídico | 301 |\n");
  assert.deepEqual(readSources(two).map((x) => x.sheet), ["Frota", "Departamentos"]);
});

test("BI data: what is not a table is refused with what to fix (a report as a spreadsheet, rows of other widths)", async () => {
  await assert.rejects(save("Relatorio.xlsx", "xlsx", "# Dados Aleatórios - Empresa RandomCorp\n\n## Informações Gerais\n- **Nome da Empresa**: RandomCorp Industries\n- **Setor**: Varejo\n"), /precisa de tabela/);
  // The CSV with 8 columns in the header and 7 in the rows (and a "Fonte:" line at the end).
  await assert.rejects(save("Frota.csv", "csv", "Placa,Modelo,Cor,Departamento,Valeto,Vitória,Fabricação,Valor\nABC-3P34,Honda Civic Branco,Prata,Tecnologia,2025,2025,198.000\nDEF-7K89,Nissan Terra Azul,Cinza,RH,2024,2026,215.000\n\nFonte: Gerado por Aurora\n"), /8 colunas no cabeçalho/);
  // A good CSV with "Fonte:" after it: the source line is not a row.
  const csv = await save("Deptos.csv", "csv", "Departamento,Funcionários\nVendas,345\nRH,315\nJurídico,301\n\nFonte: Gerado por Aurora\n");
  assert.equal(readSources(csv)[0].rows.length, 3);
});

test("BI data: a sheet with each whole row in one cell is not read as a table (it loaded empty in Power BI)", () => {
  const path = join(dir, "Quebrada.xlsx");
  writeFileSync(path, makeXlsx({ Planilha: [["Departamento | Funcionários | Gerente"], ["Engenharia | 312 | João Silva"], ["Vendas | 345 | Roberto Costa"]] }));
  assert.throws(() => readSources(path), /cada linha inteira numa célula só/);
});

test("BI data: an empty data table after the refresh is caught; numbers and the Excel as people write it", () => {
  assert.deepEqual(emptySourceTables("Atualizei os dados. Linhas por tabela: Planilha , Planilha 2 , Resumo 1.", ["Planilha", "Planilha 2"]), ["Planilha", "Planilha 2"]);
  assert.deepEqual(emptySourceTables("Atualizei os dados. Linhas por tabela: Frota 8, Departamentos 7.", ["Frota", "Departamentos"]), []);
  assert.equal(cellNumber("R$ 1.234,56"), 1234.56); assert.equal(cellNumber("8.500.000"), 8500000); assert.equal(cellNumber("385000,00"), 385000);
  assert.equal(cellNumber("12,5%"), 12.5); assert.equal(cellNumber("0001"), null); assert.equal(cellNumber("05/01/2008"), null); assert.equal(cellNumber("14.892.763/0001-85"), null);
  assert.equal(requestedFormat("certo faça planilhas em execel e use os dados para montar um POWERBI"), "xlsx");
});
