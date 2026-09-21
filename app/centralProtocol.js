import { createHash } from 'node:crypto';

export const CENTRAL_REPO = 'skrtt777/Harness_Aurora';
export const CENTRAL_ROOT = `https://raw.githubusercontent.com/${CENTRAL_REPO}/main/central-memories/`;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function publicMemory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Memória pública inválida.');
  if (Object.keys(value).some(k => !['title', 'content', 'tags'].includes(k))) fail('Envie somente título, conteúdo e tags; metadados privados não são aceitos.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) fail('Título: 1 a 160 caracteres.');
  if (typeof value.content !== 'string' || !value.content.trim() || value.content.length > 8000) fail('Conteúdo: 1 a 8.000 caracteres.');
  if (!Array.isArray(value.tags) || value.tags.length > 12 || value.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 40)) fail('Use até 12 tags de até 40 caracteres.');
  return { title: value.title.trim(), content: value.content.trim(), tags: [...new Set(value.tags.map(t => t.trim()))].sort() };
}
export function privacyFindings(memory) {
  const text = [memory.title, memory.content, ...memory.tags].join('\n');
  return [
    ['credencial', /(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|senha|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S{6,})/i],
    ['e-mail', /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i],
    ['caminho pessoal', /(?:[a-z]:[\\/]Users[\\/]|\/home\/|\/Users\/)/i],
    ['documento pessoal', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
    ['telefone', /(?:\+55\s*)?\(\d{2}\)\s*\d{4,5}[- ]?\d{4}\b/],
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
export function contribution(value) {
  const memory = publicMemory(value);
  const findings = privacyFindings(memory);
  if (findings.length) fail('Remova os possíveis dados privados antes de compartilhar: ' + findings.join(', ') + '. A verificação não substitui sua revisão.');
  return { format: 'aurora-memory-contribution', version: 1, id: sha256(JSON.stringify(memory)), memory };
}
export function contributionBody(payload) {
  return `<!-- aurora-central-v1:${payload.id} -->\nContribuição pública de conhecimento para revisão. Não ativar antes de revisão e merge.\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
export function parseContribution(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 32000) fail('Contribuição muito grande.');
  const match = body.match(/^<!-- aurora-central-v1:([a-f0-9]{64}) -->\n[\s\S]*?\n```json\n([\s\S]+)\n```\s*$/);
  if (!match) fail('Formato de contribuição inválido.');
  let parsed; try { parsed = JSON.parse(match[2]); } catch { fail('JSON de contribuição inválido.'); }
  if (parsed.format !== 'aurora-memory-contribution' || parsed.version !== 1 || Object.keys(parsed).some(k => !['format','version','id','memory'].includes(k))) fail('Versão de contribuição inválida.');
  const validated = contribution(parsed.memory);
  if (validated.id !== parsed.id || validated.id !== match[1]) fail('O conteúdo mudou desde a aprovação.');
  return validated;
}
export function centralManifest(bundles) {
  return { format: 'aurora-central-manifest', version: 1, revision: sha256(JSON.stringify(bundles)), bundles };
}
export function validateManifest(value) {
  if (value?.format !== 'aurora-central-manifest' || value.version !== 1 || !Array.isArray(value.bundles) || value.bundles.length > 1000) fail('Manifesto central inválido.');
  const ids = new Set();
  for (const b of value.bundles) {
    if (!b || typeof b.id !== 'string' || !/^[a-z0-9-]{1,90}$/.test(b.id) || b.file !== b.id + '.json' || !/^[a-f0-9]{64}$/.test(b.sha256) || !Number.isInteger(b.count) || b.count < 1 || b.count > 500 || ids.has(b.id)) fail('Pacote central inválido ou duplicado.');
    ids.add(b.id);
  }
  if (centralManifest(value.bundles).revision !== value.revision) fail('Revisão central inválida.');
  return value;
}
export function validateBundle(text, expected) {
  if (sha256(text) !== expected.sha256) fail('Hash do pacote central não confere.');
  let value; try { value = JSON.parse(text); } catch { fail('Pacote central não é JSON.'); }
  if (value?.format !== 'aurora-central-bundle' || value.version !== 1 || !Array.isArray(value.memories) || value.memories.length !== expected.count) fail('Formato de pacote central inválido.');
  return value.memories.map(row => {
    const memory = publicMemory({ title: row.title, content: row.content, tags: row.tags });
    if (row.id !== sha256(JSON.stringify(memory))) fail('Identidade da memória central inválida.');
    if (row.issue !== undefined && (!Number.isSafeInteger(row.issue) || row.issue < 1)) fail('Procedência central inválida.');
    return { id: row.id, ...memory, ...(row.issue ? { issue: row.issue } : {}) };
  });
}
