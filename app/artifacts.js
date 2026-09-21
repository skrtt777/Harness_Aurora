import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensions = { html: 'html', css: 'css', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx', json: 'json', csv: 'csv', markdown: 'md', md: 'md', python: 'py', py: 'py', sql: 'sql', yaml: 'yaml', yml: 'yaml', xml: 'xml', svg: 'svg', text: 'txt', txt: 'txt', bash: 'sh', sh: 'sh', powershell: 'ps1' };
const root = dirname(fileURLToPath(import.meta.url));

export function extractArtifacts(message) {
  if (message.role !== 'assistant' || message.provider === 'Sistema') return [];
  const text = message.content || '';
  const blocks = [];
  // Preserve offsets so prose stays in the chat and the exact code becomes a card.
  const fence = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)^ {0,3}\1[ \t]*(?:\r?\n|$)/gm;
  for (const match of text.matchAll(fence)) {
    const info = match[2].trim();
    let language = info.split(/[\s:]/)[0].toLowerCase();
    const bareFilename = /^[\w.-]+\.[a-z0-9]+$/i.test(info);
    if (!Object.hasOwn(extensions, language) && !bareFilename) continue;
    if (bareFilename) language = info.split('.').pop().toLowerCase();
    if (!Object.hasOwn(extensions, language)) language = 'text';
    const named = info.match(/(?:filename=|file=|title=|:)["']?([^\s"']+)/i)?.[1]
      || (bareFilename ? info : info.match(/\s+([\w./\\-]+\.[a-z0-9]+)$/i)?.[1] || null);
    blocks.push({ start: match.index, end: match.index + match[0].length, content: match[3].replace(/\r?\n$/, ''), language, named });
  }
  if (!blocks.length) {
    const raw = text.match(/(?:<!doctype html[^>]*>\s*)?<html[\s>][\s\S]*?<\/html\s*>/i);
    if (raw) blocks.push({ start: raw.index, end: raw.index + raw[0].length, content: raw[0], language: 'html', named: null });
  }
  const used = new Set();
  return blocks.map((block, index) => {
    const ext = extensions[block.language] || 'txt';
    let name = block.named?.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80);
    // Treat model names as labels, never as a filesystem path or executable extension.
    if (!name || /^\.+$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `arquivo.${ext}`;
    if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name.replace(/\.[^.]*$/, '')}.${ext}`;
    const originalName = name;
    let suffix = index + 1;
    while (used.has(name.toLowerCase())) name = `${suffix++}-${originalName}`;
    used.add(name.toLowerCase());
    const hash = createHash('sha256').update(block.content).digest('hex').slice(0, 12);
    return { id: `${message.id}-${index}-${hash}`, messageId: message.id, name, language: block.language || 'text', previewable: ext === 'html', relativePath: `${message.id}/${name}`, createdAt: message.createdAt, start: block.start, end: block.end, content: block.content };
  });
}

export function listArtifacts(messages) {
  return messages.flatMap(extractArtifacts).map(({ content, ...metadata }) => metadata);
}

export function artifactsDirectory() {
  // Resolved lazily: Electron sets the writable database directory at startup.
  return join(dirname(process.env.HARNESS_DB_FILE || join(root, 'data', 'harness.db')), 'artifacts');
}

export async function materializeArtifact(conversationId, artifact, directory = artifactsDirectory()) {
  if (![conversationId, artifact.messageId].every(id => /^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Identificador de arquivo inválido.');
  if (!/^[a-zA-Z0-9_.-]+$/.test(artifact.name) || /^\.+$/.test(artifact.name)) throw new Error('Nome de arquivo inválido.');
  const base = resolve(directory);
  await mkdir(base, { recursive: true });
  const canonicalBase = await realpath(base);
  const filePath = join(base, conversationId, artifact.messageId, artifact.name);
  const rel = relative(base, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Caminho inválido.');
  // Refuse existing symlink/junction ancestors before creating or writing files.
  let parent = base;
  for (const component of [conversationId, artifact.messageId]) {
    parent = join(parent, component);
    try { await mkdir(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(parent);
    const canonical = relative(canonicalBase, await realpath(parent));
    if (info.isSymbolicLink() || !info.isDirectory() || canonical.startsWith('..') || isAbsolute(canonical)) throw new Error('Pasta de arquivo inválida.');
  }
  try { await writeFile(filePath, artifact.content, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await lstat(filePath)).isSymbolicLink()) throw new Error('Arquivo inválido.');
    // Never overwrite an exported file the user edited outside Aurora.
    if (await readFile(filePath, 'utf8') !== artifact.content) throw new Error('O arquivo salvo foi editado fora do Aurora. Preserve sua cópia antes de abrir novamente.');
  }
  return { ...artifact, filePath };
}
