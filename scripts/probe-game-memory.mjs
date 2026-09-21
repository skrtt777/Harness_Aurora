// Manual integration probe. Uses the real local chat; does not edit generated code.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const directory = 'app/data/game-memory-probe';
await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:8788';
const { token } = await (await fetch(base + '/api/session')).json();
async function api(path, body) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-harness-token': token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(240000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || response.status);
  return result;
}
const phase = process.argv[2] || 'create';
const previous = phase === 'create' ? null : JSON.parse(await readFile(`${directory}/create.json`, 'utf8'));
const conversation = previous ? { id: previous.conversationId } : await api('/conversations', { title: 'Teste real — jogo e memórias', provider: 'local' });
const prompt = phase === 'create'
  ? 'Crie um minijogo de clicar no alvo em um único HTML autocontido, em português, sem dependências. Um botão Iniciar começa a partida. Cada clique no botão Alvo vale 1 ponto; com 3 pontos aparece Vitória e o alvo deixa de pontuar. Um botão Reiniciar permite jogar novamente a partir de 0. Mostre o placar como número. Entregue apenas o HTML completo em bloco html. Para verificar a interface, use estes IDs: start, target, score, status, restart. Mantenha simples, sem áudio nem cronômetro. Consulte as memórias pertinentes de estados, pontuação e reinício.'
  : await readFile(`${directory}/next-prompt.txt`, 'utf8');
console.log(JSON.stringify({ phase, conversationId: conversation.id, stage: 'generating' }));
const response = await api(`/conversations/${conversation.id}/messages`, { message: prompt, contextLimit: 12000 });
const all = await api(`/conversations/${conversation.id}/artifacts`);
const artifact = all.artifacts.filter(file => file.messageId === response.message?.id && file.previewable).at(-1);
const file = artifact ? await api(`/conversations/${conversation.id}/artifacts/${artifact.id}/open`, {}) : null;
if (file) await writeFile(`${directory}/${phase}.html`, file.content);
const evidence = {
  phase, conversationId: conversation.id, prompt, provider: response.message?.provider,
  ok: response.ok, messageId: response.message?.id, memoryAccess: response.memoryAccess?.map(m => ({ id: m.id, title: m.title })),
  usage: response.usage, artifact, filePath: file?.filePath, response: response.message?.content,
};
await writeFile(`${directory}/${phase}.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, response: undefined }));
