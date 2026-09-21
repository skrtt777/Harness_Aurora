import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.HARNESS_DB_FILE) throw new Error('Escolha explicitamente HARNESS_DB_FILE.');
const { selectRelevantMemories } = await import('../app/store.js');
const { compactContext } = await import('../app/economy.js');
const { getDb } = await import('../app/db.js');
const { memories } = JSON.parse(await readFile(join(root, 'knowledge/jogos-v1.json'), 'utf8'));
const cases = [
  ['Implemente colisão AABB entre retângulos com teste de bordas e sobreposição.', 'Colisão AABB entre retângulos'],
  ['Meu jogo duplica eventos ao reiniciar. Corrija reset, timers e listeners para cinco partidas.', 'Reiniciar sem estado antigo nem eventos duplicados'],
  ['O AudioContext bloqueia som antes de interação. Quero áudio, música, mute e controle de volume.', 'Áudio iniciado por interação e controle de volume'],
  ['No Godot 4, como mover CharacterBody2D com move_and_slide e colisões de chão e parede?', 'Godot: CharacterBody e movimento controlado'],
  ['Movimento com velocidade em segundos deve funcionar em 30, 60 e 120 FPS; use delta dt.', 'Movimento independente de FPS com delta time'],
];
const checks = [];
for (const [query, title] of cases) {
  const relevant = await selectRelevantMemories(query, {}, 12);
  const context = await compactContext({ input: query, memories: relevant, limit: 12000 });
  const rank = relevant.findIndex(memory => memory.title === title) + 1;
  if (rank < 1 || rank > 5) throw new Error(`Recuperação incorreta para ${title}: posição ${rank}`);
  if (!context.memoryIds.includes(relevant[rank - 1].id)) throw new Error('Memória essencial não entrou no contexto.');
  if (context.prompt.length > 12000 || context.memoryIds.length >= memories.length) throw new Error('Orçamento de contexto inválido.');
  checks.push({ query, expected: title, rank, firstThree: relevant.slice(0, 3).map(m => m.title), memoriesInPrompt: context.memoryIds.length, promptChars: context.prompt.length, estimatedInputTokens: context.estimatedInputTokens });
  console.log(JSON.stringify(checks.at(-1)));
}
const db = await getDb();
const vectors = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS indexed FROM memories WHERE tags LIKE '%biblioteca-jogos-v1%'").get();
const report = { date: new Date().toISOString(), vectors, checks };
await writeFile(join(root, 'app/data/game-knowledge/retrieval-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ vectors, retrievalChecks: checks.length }));
