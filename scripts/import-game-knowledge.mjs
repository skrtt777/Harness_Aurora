import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const payload = JSON.parse(await readFile(join(root, 'knowledge/jogos-v1.json'), 'utf8'));
const ports = process.argv.slice(2).filter(x => /^\d+$/.test(x)).map(Number);
if (!ports.length) throw new Error('Informe as portas locais explicitamente, por exemplo: 8788 8787 --index');
const index = process.argv.includes('--index');
const folder = resolve(root, 'app/data/game-knowledge');
await mkdir(folder, { recursive: true });
const report = [];
for (const port of ports) {
  if (port < 1 || port > 65535) throw new Error('Porta inválida.');
  const base = `http://127.0.0.1:${port}`;
  const session = await fetch(base + '/api/session').then(r => r.json());
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(base + '/api' + path, { method,
      headers: { 'x-harness-token': session.token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${port} ${method} ${path}: ${result.error || response.status}`);
    return result;
  };
  const before = (await api('/memories')).memories;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(folder, `before-${port}-${stamp}.json`), JSON.stringify({ format: 'harness-aurora-memories', version: 1, memories: before }, null, 2));
  const result = await api('/memories/import', 'POST', payload);
  console.log(JSON.stringify({ port, phase: 'import', ...result }));
  const after = (await api('/memories')).memories;
  const imported = after.filter(m => m.tags.includes('biblioteca-jogos-v1'));
  if (imported.length !== payload.memories.length) throw new Error('Quantidade importada inesperada.');
  for (const previous of before.filter(m => !m.tags.includes('biblioteca-jogos-v1'))) {
    if (JSON.stringify(after.find(m => m.id === previous.id)) !== JSON.stringify(previous)) throw new Error('Uma memória anterior mudou.');
  }
  const ids = new Set(imported.map(m => m.id));
  let relations = 0;
  for (const memory of imported) for (const target of memory.relations) {
    if (!ids.has(target)) throw new Error('Relação fora do pacote.');
    relations++;
  }
  if (relations !== 117) throw new Error(`Relações inesperadas: ${relations}`);
  // Exercise the importer's existing deduplication, without adding duplicate nodes.
  const duplicate = await api('/memories/import', 'POST', payload);
  if (duplicate.imported !== 0 || duplicate.relationsCreated !== 0 || duplicate.skipped !== 73) throw new Error('Importação não foi idempotente.');
  if (index) {
    for (let offset = 0; offset < imported.length; offset++) {
      const memory = imported[offset];
      // Existing API computes local embeddings on save; content stays identical.
      await api(`/memories/${memory.id}`, 'PATCH', { content: memory.content });
      if ((offset + 1) % 15 === 0) console.log(JSON.stringify({ port, phase: 'index', processed: offset + 1, total: imported.length }));
    }
  }
  const row = { port, before: before.length, after: after.length, ...result, relations, duplicate, indexedViaSave: index, preservedPreviousMemories: true };
  report.push(row);
  console.log(JSON.stringify(row));
  await writeFile(join(folder, 'import-report.json'), JSON.stringify(report, null, 2));
}
