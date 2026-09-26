import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { getDb } from './db.js';
import { httpError } from './httpSecurity.js';
import { skillRelevance, selectiveContext } from './contextSelection.js';

const bundled = join(dirname(fileURLToPath(import.meta.url)), 'skills');
export const digest = text => createHash('sha256').update(text).digest('hex');
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stop = new Set('para com como uma criar crie fazer faca este esta esse essa quero preciso usar use pelo pela dos das por que the and for with from create make'.split(' '));
export const terms = text => [...new Set(normalize(text).match(/[a-z0-9-]{2,}/g) || [])].filter(w=>!stop.has(w));

export function parseSkill(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw httpError(400, 'Skill excede 64 KB.');
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw httpError(400, 'SKILL.md precisa de frontmatter YAML.');
  let meta;
  try { const doc = parseDocument(match[1]); if (doc.errors.length) throw doc.errors[0]; meta = doc.toJS({ maxAliasCount: 20 }); }
  catch { throw httpError(400, 'Frontmatter YAML inválido.'); }
  if (!meta || typeof meta.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.name) || typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 1200 || !match[2].trim()) throw httpError(400, 'Skill precisa de nome, descrição e instruções válidos.');
  return { name: meta.name, description: meta.description.trim(), body: match[2].trim(), metadata: meta.metadata || {}, platforms:meta.platforms, requiredEnvironment:meta.required_environment_variables, hash: digest(text), text };
}

export const SKILL_CAPABILITIES=['html','json','javascript','markdown','csv','browser_validation','skill_reference','browser_agent'];
export function skillCompatibility(skill,{platform=process.platform,env=process.env}={}) {
  const reasons=[],os={win32:'windows',darwin:'macos',linux:'linux'}[platform]||platform;
  if(skill.platforms!==undefined && (!Array.isArray(skill.platforms)||!skill.platforms.includes(os)))reasons.push('Plataforma exigida não corresponde a '+os+'.');
  const metadata=skill.metadata?.hermes||{};
  for(const key of ['requires_tools','requires_toolsets']) {
    if(metadata[key]!==undefined && !Array.isArray(metadata[key]))reasons.push('Declaração de ferramentas inválida.');
    for(const tool of Array.isArray(metadata[key])?metadata[key]:[])if(!SKILL_CAPABILITIES.includes(tool))reasons.push('Ferramenta não disponível nesta engine: '+String(tool).slice(0,80));
  }
  for(const requirement of Array.isArray(skill.requiredEnvironment)?skill.requiredEnvironment:[]){
    const name=typeof requirement==='string'?requirement:requirement?.name;
    if(typeof name!=='string'||!env[name])reasons.push('Configuração de ambiente ausente: '+String(name||'não identificada').slice(0,80));
  }
  return {status:reasons.length?'blocked':skill.source==='bundled'||skill.source?.startsWith('engine:')?'compatible':'undeclared',reasons:reasons.length?reasons:['Requisitos declarados conferidos; dependências descritas somente no texto exigem revisão.']};
}
export function skillInScope(skill,scope={}) {
  const boundary=skill.metadata?.aurora?.scope;
  if(!boundary)return true;
  return boundary.projectId ? boundary.projectId===scope.projectId : Boolean(boundary.conversationId&&boundary.conversationId===scope.conversationId);
}
export const skillReferences=skill=>[...new Set(skill.body.match(/(?:references|scripts|assets|templates|examples)\/[a-zA-Z0-9_./-]+\.(?:md|txt|json|yaml|yml|js|py|html|css|sql)/g)||[])];

async function dbReady() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS skill_library (id TEXT PRIMARY KEY, content TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`);
  return db;
}

async function scan(root, source, depth = 0, out = []) {
  if (depth > 4 || out.length >= 500) return out;
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') {
      try { const skill = parseSkill(await readFile(path, 'utf8')); out.push({ ...skill, id: `${source}:${digest(path).slice(0,16)}`, source, folder: root, enabled: source === 'bundled' }); } catch { /* Invalid entries never enter model context. */ }
    } else if (entry.isDirectory()) await scan(path, source, depth + 1, out);
  }
  return out;
}

export async function allSkills() {
  const db = await dbReady();
  const [local, external] = await Promise.all([scan(bundled, 'bundled'), scan(join(homedir(), '.hermes', 'skills'), 'hermes-local')]);
  const imported = db.prepare('SELECT * FROM skill_library').all().map(row => ({ ...parseSkill(row.content), id: row.id, source: row.source, enabled: !!row.enabled }));
  // Imported copies are versioned snapshots; external originals are never changed.
  return [...local, ...external, ...imported];
}

export async function listSkills() {
  return (await allSkills()).map(({ body, text, folder, ...index }) => ({ ...index, compatibility:skillCompatibility(index), estimatedTokens: Math.ceil(body.length / 3) }));
}

export async function importSkill(content, source = 'manual') {
  const parsed = parseSkill(content);
  const db = await dbReady();
  const id = `import:${parsed.hash.slice(0,24)}`;
  db.prepare('INSERT OR IGNORE INTO skill_library(id, content, source, updated_at) VALUES(?,?,?,?)').run(id, content, source.slice(0,500), new Date().toISOString());
  return (await listSkills()).find(s => s.id === id);
}

export async function enableSkill(id, enabled) {
  if (typeof enabled !== 'boolean') throw httpError(400, 'Estado da skill inválido.');
  const db = await dbReady();
  if(enabled){const skill=(await allSkills()).find(s=>s.id===id);if(skill&&skillCompatibility(skill).status==='blocked')throw httpError(409,'Skill incompatível: '+skillCompatibility(skill).reasons.join(' '));}
  const changed = db.prepare('UPDATE skill_library SET enabled=?, updated_at=? WHERE id=?').run(+enabled, new Date().toISOString(), id);
  if (!changed.changes) throw httpError(404, 'Importe uma cópia da skill antes de ativar.');
  return { ok: true };
}

export async function readSkill(id, resource) {
  const skill = (await allSkills()).find(s => s.id === id);
  if (!skill) throw httpError(404, 'Skill não encontrada.');
  if (!resource) return { ...skill, compatibility:skillCompatibility(skill), resources:skillReferences(skill) };
  if (typeof resource !== 'string' || resource.includes('\\') || resource.split('/').some(p => p === '..') || !/^(references|templates|examples|assets|scripts)\/[a-zA-Z0-9_./-]+\.(md|txt|json|yaml|yml|js|py|html|css|sql)$/i.test(resource)) throw httpError(400, 'Referência inválida.');
  if (skill.folder) {
    const base = await realpath(skill.folder);
    const path = await realpath(resolve(base, resource)).catch(() => null);
    if (!path || !path.startsWith(base + sep)) throw httpError(404, 'Referência não encontrada.');
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > 65536) throw httpError(400, 'Referência excede 64 KB.');
    return { id, resource, text };
  }
  const match = skill.source.match(/^hermes:([a-f0-9]{40}):(skills\/.+)$/);
  const catalogMatch=skill.source.match(/^catalog:github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):([a-f0-9]{40}):([A-Za-z0-9_./-]+)\/SKILL\.md$/);
  if(catalogMatch && !catalogMatch[3].split('/').some(p=>p==='..'))return {id,resource,text:await remoteText(`https://raw.githubusercontent.com/${catalogMatch[1]}/${catalogMatch[2]}/${catalogMatch[3]}/${resource}`)};
  if (!match) throw httpError(404, 'Esta importação contém somente SKILL.md.');
  return { id, resource, text: await remoteText(`https://raw.githubusercontent.com/NousResearch/hermes-agent/${match[1]}/${match[2]}/${resource}`) };
}

export function skillExcerpt(skill, query, budget) {
  if(skill.body.length <= budget) return {body:skill.body, partial:false};
  const words=terms(query);
  const sections=skill.body.split(/(?=^#{1,4} )/m);
  const index=sections.map(section=>section.split('\n')[0]).filter(line=>line.startsWith('#')).join('\n');
  let result='Trechos relevantes; skill completa disponível na biblioteca.\n'+index.slice(0,600)+'\n';
  const ranked=sections.map((text,i)=>({text,i,score:words.reduce((n,w)=>n+(normalize(text).includes(w)?1:0),0)+(i===0?2:0)})).sort((a,b)=>b.score-a.score||a.i-b.i);
  let added=0;
  for(const section of ranked) {
    if(result.length+section.text.length+2>budget) continue;
    result+='\n'+section.text;added++;
  }
  return added?{body:result,partial:true}:null;
}

export async function selectSkills(query, budget = 3600, max = 3, scope = {}) {
  const words=terms(query);
  const candidates = (await allSkills()).filter(s => s.enabled && skillInScope(s,scope) && skillCompatibility(s).status!=='blocked').map(s => ({ ...s, score: selectiveContext()?skillRelevance(s,query):words.reduce((n,w)=>n+(terms(s.name+' '+s.description).some(t=>t===w||(w.length>2&&t.startsWith(w)))?1:0),0) })).filter(s => s.score > 0).sort((a,b) => b.score - a.score || a.name.localeCompare(b.name));
  const selected = []; const names = new Set(); let used = 0;
  for (const skill of candidates) {
    const excerpt = skillExcerpt(skill,query,Math.min(3000,budget-used-100));
    if(!excerpt) continue;
    const block = `Skill ${skill.name}:\n${excerpt.body}`;
    if (names.has(skill.name) || used + block.length + 2 > budget) continue;
    selected.push({ ...skill, block, partial:excerpt.partial }); names.add(skill.name); used += block.length + 2;
    if (selected.length === max) break;
  }
  return selected;
}

async function remoteText(url, limit = 65536) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { 'User-Agent': 'Harness-Aurora' } });
  if (!response.ok) throw httpError(502, `Catálogo Hermes respondeu ${response.status}.`);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) throw httpError(413, 'Recurso remoto excede o limite.'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

let catalogue;
export async function hermesCatalogue() {
  if (catalogue && Date.now() - catalogue.time < 3600000) return catalogue.value;
  const tree = JSON.parse(await remoteText('https://api.github.com/repos/NousResearch/hermes-agent/git/trees/main?recursive=1', 8_000_000));
  if (!/^[a-f0-9]{40}$/.test(tree.sha) || !Array.isArray(tree.tree)) throw httpError(502, 'Catálogo inválido.');
  const skills = tree.tree.filter(f => f.type === 'blob' && /^skills\/[a-zA-Z0-9_./-]+\/SKILL\.md$/.test(f.path)).map(f => ({ path: f.path, name: f.path.split('/').at(-2) })).slice(0,1000);
  catalogue = { time: Date.now(), value: { revision: tree.sha, skills } }; return catalogue.value;
}

export async function importHermesSkill(path) {
  const catalog = await hermesCatalogue();
  if (!catalog.skills.some(s => s.path === path)) throw httpError(400, 'Skill fora do catálogo oficial.');
  const content = await remoteText(`https://raw.githubusercontent.com/NousResearch/hermes-agent/${catalog.revision}/${path}`);
  return importSkill(content, `hermes:${catalog.revision}:${path.replace(/\/SKILL\.md$/, '')}`);
}
