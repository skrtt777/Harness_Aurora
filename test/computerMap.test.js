import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-mapa-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
const map = await import("../app/computerMap.js");

const home = join(temp, "Users", "ana");
const put = (rel, n = 1, size = 10) => { const p = join(home, rel); mkdirSync(p.replace(/[\\/][^\\/]+$/, ""), { recursive: true }); for (let i = 0; i < n; i += 1) writeFileSync(n > 1 ? p.replace(/(\.\w+)$/, `-${i}$1`) : p, "x".repeat(size)); };
put("Documentos/Relatório Anual 2026.pdf");
put("Documentos/orçamento.xlsx");
put("Documentos/carta.docx");
put("Documentos/ata.pdf");
put("Fotos/Praia/foto.jpg", 12);
put("Projetos/loja/package.json");
put("Projetos/loja/src/index.js");
put("Projetos/loja/node_modules/lib/index.js", 30);
put("AppData/Local/cache.bin", 5);
put("Contas/nota fiscal 123.pdf");
put("Contas/boleto luz.pdf");
put("Contas/comprovante pix.pdf");
put("Downloads/setup.exe");
mkdirSync(join(temp, "Users", "outro", "Documentos"), { recursive: true });
writeFileSync(join(temp, "Users", "outro", "Documentos", "segredo.txt"), "x");

const scan = () => map.scanComputer({ roots: [home], home, pauseMs: 0 });

test("the map knows what each folder is, skips system and build folders, and finds files by name", async () => {
  const first = await scan();
  assert.equal(first.error, null);
  const top = await map.mapChildren(home);
  const byName = Object.fromEntries(top.map((r) => [r.name, r]));
  assert.equal(byName.Documentos.kind, "documentos");
  assert.equal(byName.Contas.kind, "financeiro");
  assert.equal(byName.Downloads.kind, "downloads");
  assert.ok(!byName.AppData, "AppData is the system's");
  const loja = (await map.mapChildren(join(home, "Projetos")))[0];
  assert.equal(loja.kind, "projeto");
  assert.match(loja.label, /Node/);
  assert.ok(!(await map.mapChildren(loja.path)).some((r) => r.name === "node_modules"), "build folders stay out");
  assert.equal((await map.mapChildren(join(home, "Fotos")))[0].kind, "fotos");
  assert.equal((await map.mapChildren(null))[0].files, 22, "totals count everything under a root (node_modules and AppData not included)");

  const found = await map.mapSearch("relatorio anual");
  assert.equal(found.files[0].path, join(home, "Documentos", "Relatório Anual 2026.pdf"), "accents ignored");
  assert.ok((await map.mapSearch("loja")).folders.some((f) => f.kind === "projeto"));
  const overview = await map.mapOverview();
  assert.match(overview, /Projetos de código: .*loja \[Projeto de código \(Node\/JavaScript\)\]/);
  assert.match(overview, /Fotos: .*Praia/);
});

test("a second pass re-reads only the folders that changed, and drops folders that are gone", async () => {
  const again = await scan();
  assert.equal(again.reread, 0, "nothing changed: no folder is listed again");
  put("Fotos/Praia/nova.jpg");
  const one = await scan();
  assert.equal(one.reread, 1, "only Praia");
  assert.ok((await map.mapSearch("nova")).files.length);
  rmSync(join(home, "Contas"), { recursive: true });
  await scan();
  assert.ok(!(await map.mapChildren(home)).some((r) => r.name === "Contas"));
  assert.equal((await map.mapSearch("boleto")).files.length, 0, "its files leave the search too");
});

test("other people's profiles and secret folders are never mapped", async () => {
  assert.equal(map.skipped(join(temp, "Users"), "Users", { home }), true);
  assert.equal(map.skipped("C:\\Users\\ana\\.ssh", ".ssh", { home }), true);
  assert.equal(map.skipped("D:\\Jogos\\steamapps", "steamapps", { home }), false, "a game library is shown, labeled");
  assert.equal(map.labelFolder({ name: "steamapps" }).kind, "jogos");
});

test("the agent's computer_map tool: off says so; on gives the overview, finds by name and opens a folder", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const store = await import("../app/store.js");
  const ctx = { mode: "auto", approve: async () => false, env: process.env };
  await store.setSetting("computer_map", "false");
  assert.match((await executeTool("computer_map", {}, ctx)).result, /desligado/);
  await store.setSetting("computer_map", "true");
  await scan();
  assert.match((await executeTool("computer_map", {}, ctx)).result, /Mapa do computador .*pastas/);
  assert.match((await executeTool("computer_map", { query: "relatório" }, ctx)).result, /Relatório Anual 2026\.pdf/);
  assert.match((await executeTool("computer_map", { path: home }, ctx)).result, /Documentos \[Documentos/);
});

test("turning the map off through the app forgets it", async () => {
  const { createServer } = await import("../app/server.js");
  process.env.AURORA_MAP_ROOTS = JSON.stringify([home]);
  const server = createServer({ allowDev: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const call = (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...init, headers: { "x-harness-token": server.apiToken, "content-type": "application/json" } }).then((r) => r.json());
  try {
    await call("/api/map", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    for (let i = 0; i < 100 && (await call("/api/map")).status.running; i += 1) await new Promise((r) => setTimeout(r, 50));
    const on = await call("/api/map");
    assert.equal(on.enabled, true);
    assert.equal(on.roots[0].path, home);
    assert.ok((await call(`/api/map/search?q=${encodeURIComponent("orçamento")}`)).files.length);
    const off = await call("/api/map", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    assert.deepEqual(off.roots, [], "off means forgotten");
  } finally {
    delete process.env.AURORA_MAP_ROOTS;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("toolchains and installed games stay out of the file list: their thousands of files are not the person's", async () => {
  put("Projetos/ia/.venv-motion/Lib/site-packages/torch/x.py", 20);
  put("Projetos/ia/treino.py");
  put("Ferramentas/miniforge3/bin/python.exe");
  const games = join(home, "SteamLibrary", "steamapps", "common", "Jogo Legal");
  mkdirSync(join(games, "data"), { recursive: true });
  for (let i = 0; i < 15; i += 1) writeFileSync(join(games, "data", `pack${i}.arc`), "x");
  writeFileSync(join(games, "jogo.exe"), "x");
  await scan();
  assert.ok((await map.mapSearch("treino")).files.length, "the person's script is found");
  assert.equal((await map.mapSearch("torch")).folders.length, 0, "no site-packages folder");
  assert.ok(!(await map.mapChildren(join(home, "Ferramentas"))).some((r) => /miniforge/i.test(r.name)));
  const game = (await map.mapChildren(join(home, "SteamLibrary", "steamapps", "common")))[0];
  assert.equal(game.kind, "jogos");
  assert.equal(game.subdirs, 0, "not walked into");
  assert.equal((await map.mapSearch("pack0")).files.length, 0, "no file from inside the game");
});

test("computer_map with recent_days lists what changed lately, newest first", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const store = await import("../app/store.js");
  await store.setSetting("computer_map", "true");
  const { utimesSync } = await import("node:fs");
  put("Documentos/velho.pdf");
  const old = (Date.now() - 10 * 86_400_000) / 1000;
  utimesSync(join(home, "Documentos", "velho.pdf"), old, old);
  put("Documentos/boleto novo.pdf");
  await scan();
  const out = (await executeTool("computer_map", { recent_days: 1 }, { mode: "auto", approve: async () => false, env: process.env })).result;
  assert.match(out, /boleto novo\.pdf/);
  assert.doesNotMatch(out, /velho\.pdf/);
});
