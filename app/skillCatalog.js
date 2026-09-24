import { getDb } from './db.js';
import { digest, importSkill } from './skills.js';
import { httpError } from './httpSecurity.js';

export const CATALOG_URL = 'https://hermes-agent.nousresearch.com/docs/api/skills-index.json';
// Canonical destination of the documentation site's redirect; arbitrary redirects stay disabled.
const CATALOG_DOWNLOAD_URL = 'https://nousresearch.github.io/hermes-agent/docs/api/skills-index.json';
// clawhub and skills.sh are unmoderated bulk mirrors (76k + 20k entries, ~98% of the index,
// many non-Latin-script or off-topic) that drown out the small curated sources when browsing
// with no search term. Default browsing (no query, no explicit source) sticks to the curated
// set; picking a source explicitly, or typing a search, still reaches the full index.
export const CURATED_CATALOG_SOURCES = ['official', 'github', 'lobehub', 'browse-sh'];
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const safePath = p => typeof p === 'string' && p.length < 600 && /^[A-Za-z0-9_./-]+$/.test(p) && !p.split('/').some(s=>!s || s==='.' || s==='..');
const short = (v,n) => typeof v==='string' ? v.slice(0,n) : '';
let syncing;
async function ready() {
  const db=await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS skill_catalog(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,source TEXT NOT NULL,identifier TEXT NOT NULL,repo TEXT NOT NULL,path TEXT NOT NULL,tags TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS skill_catalog_source ON skill_catalog(source,name);
    CREATE VIRTUAL TABLE IF NOT EXISTS skill_catalog_fts USING fts5(id UNINDEXED,name,description,tags,tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS skill_catalog_meta(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL);`);
  return db;
}
export async function catalogRemoteText(url, limit=65536, fetcher=fetch) {
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(limit>65536?60000:20000),headers:{'User-Agent':'Harness-Aurora'}});
  if(!response.ok) throw httpError(response.status===409?409:502,response.status===409?'A origem contém nomes ambíguos. Confira o autor e importe o SKILL.md correspondente.':response.status===404?'O arquivo ou repositório desta entrada não está mais disponível na origem. Escolha outra skill ou importe o SKILL.md manualmente.':`Fonte de skills respondeu ${response.status}. Tente novamente mais tarde.`);
  const chunks=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>limit)throw httpError(413,'Catálogo ou skill excede o limite de download.');chunks.push(part);}
  return Buffer.concat(chunks).toString('utf8');
}
export async function replaceCatalog(payload) {
  if(payload?.version!==1 || !Array.isArray(payload.skills) || !payload.skills.length || payload.skills.length>250000)throw httpError(502,'Índice de skills inválido; catálogo anterior preservado.');
  const db=await ready(),rows=[];let rejected=0;
  for(const s of payload.skills){
    if(!s || typeof s.name!=='string'||!s.name.trim()||typeof s.identifier!=='string'||!s.identifier||s.identifier.length>1200||typeof s.source!=='string'||!s.source||s.source.length>80){rejected++;continue;}
    rows.push({id:digest(s.source+'\0'+s.identifier),name:short(s.name,240),description:short(s.description,2400),source:s.source,identifier:s.identifier,repo:short(s.repo,200),path:short(s.path,600),tags:(Array.isArray(s.tags)?s.tags:[]).filter(t=>typeof t==='string').slice(0,24).map(t=>t.slice(0,80)).join(' ')});
  }
  if(!rows.length)throw httpError(502,'Índice sem entradas válidas; catálogo anterior preservado.');
  const insert=db.prepare('INSERT OR IGNORE INTO skill_catalog VALUES(?,?,?,?,?,?,?,?)');
  const ft=db.prepare('INSERT INTO skill_catalog_fts(id,name,description,tags) VALUES(?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM skill_catalog; DELETE FROM skill_catalog_fts;');
    for(const r of rows){if(insert.run(r.id,r.name,r.description,r.source,r.identifier,r.repo,r.path,r.tags).changes)ft.run(r.id,r.name,r.description,r.tags);}
    const total=db.prepare('SELECT count(*) n FROM skill_catalog').get().n;
    const meta={total,upstreamCount:payload.skills.length,rejected,duplicates:rows.length-total,generatedAt:short(payload.generated_at,100),syncedAt:new Date().toISOString(),url:CATALOG_URL};
    db.prepare('INSERT OR REPLACE INTO skill_catalog_meta VALUES(1,?)').run(JSON.stringify(meta));db.exec('COMMIT');return meta;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export async function syncSkillCatalog({fetcher=fetch}={}) {
  if(syncing)return syncing;
  syncing=(async()=>replaceCatalog(JSON.parse(await catalogRemoteText(CATALOG_DOWNLOAD_URL,128*1024*1024,fetcher))))();
  try{return await syncing;}finally{syncing=null;}
}
export async function searchSkillCatalog({query='',source='',page=0,limit=30,includeAll=false}={}) {
  if(typeof query!=='string'||query.length>160||typeof source!=='string'||source.length>80||!Number.isInteger(page)||page<0||page>10000||!Number.isInteger(limit)||limit<1||limit>50)throw httpError(400,'Busca de skills inválida.');
  const db=await ready(),meta=db.prepare('SELECT document FROM skill_catalog_meta WHERE id=1').get();
  const words=(query.match(/[\p{L}\p{N}_]+/gu)||[]).slice(0,8),args=[],where=[];
  if(words.length){where.push('skill_catalog_fts MATCH ?');args.push(words.map(w=>'"'+w+'"*').join(' AND '));}
  const restrictedToCurated=!source&&!words.length&&!includeAll;
  if(source){where.push('c.source=?');args.push(source);}
  else if(restrictedToCurated){where.push('c.source IN ('+CURATED_CATALOG_SOURCES.map(()=>'?').join(',')+')');args.push(...CURATED_CATALOG_SOURCES);}
  const from='FROM skill_catalog c '+(words.length?'JOIN skill_catalog_fts ON skill_catalog_fts.id=c.id ':'')+(where.length?'WHERE '+where.join(' AND '):'');
  const total=db.prepare('SELECT count(*) n '+from).get(...args).n;
  const skills=db.prepare('SELECT c.* '+from+' ORDER BY '+(words.length?'bm25(skill_catalog_fts,0,8,1,2),':'')+'c.name,c.id LIMIT ? OFFSET ?').all(...args,limit,page*limit).map(row=>({...row,importable:['official','github','skills.sh','clawhub','browse-sh','lobehub'].includes(row.source)}));
  const overallTotal=db.prepare('SELECT count(*) n FROM skill_catalog').get().n;
  return {meta:meta?JSON.parse(meta.document):null,total,overallTotal,restrictedToCurated,page,limit,skills,
    sources:db.prepare('SELECT source,count(*) count FROM skill_catalog GROUP BY source ORDER BY count DESC').all().map(s=>({...s,curated:CURATED_CATALOG_SOURCES.includes(s.source)}))};
}
async function githubSkill(repo,path,name,fetcher) {
  if(!repoPattern.test(repo)||!safePath(path))throw httpError(400,'Repositório ou caminho inválido na origem.');
  const tree=JSON.parse(await catalogRemoteText(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,16*1024*1024,fetcher));
  if(!/^[a-f0-9]{40}$/.test(tree.sha)||!Array.isArray(tree.tree))throw httpError(502,'Não foi possível fixar a revisão da skill.');
  const target=path.endsWith('/SKILL.md')?path:path+'/SKILL.md';
  const exact=tree.tree.find(f=>f.type==='blob'&&f.path===target);
  if(tree.truncated && !exact)throw httpError(409,'A origem retornou uma lista incompleta. Importe o SKILL.md pelo caminho exato.');
  const candidates=exact?[exact]:tree.tree.filter(f=>f.type==='blob'&&f.path.split('/').at(-1)==='SKILL.md'&&[name,path.split('/').at(-1)].includes(f.path.split('/').at(-2)));
  if(candidates.length!==1)throw httpError(409,'Não foi encontrado um único SKILL.md para esta entrada. Consulte a origem e importe o arquivo correto.');
  const file=candidates[0].path;if(!safePath(file))throw httpError(400,'Caminho remoto inválido.');
  return {content:await catalogRemoteText(`https://raw.githubusercontent.com/${repo}/${tree.sha}/${file}`,65536,fetcher),source:`catalog:github:${repo}:${tree.sha}:${file}`};
}
export async function importCatalogSkill(id,{fetcher=fetch}={}) {
  const db=await ready(),entry=db.prepare('SELECT * FROM skill_catalog WHERE id=?').get(id);
  if(!entry)throw httpError(404,'Entrada não encontrada no catálogo local.');
  let result;
  if(['official','github','skills.sh'].includes(entry.source)) result=await githubSkill(entry.repo,entry.path,entry.name,fetcher);
  else if(entry.source==='browse-sh') result=await githubSkill('browserbase/browse.sh','skills/'+entry.identifier.replace(/^browse-sh\//,''),entry.name,fetcher);
  else if(entry.source==='clawhub') {
    const slug=entry.identifier.replace(/^clawhub\//,'');
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(slug))throw httpError(400,'Identificador ClawHub não suportado.');
    const base='https://clawhub.ai/api/v1/skills/'+encodeURIComponent(slug);
    const meta=JSON.parse(await catalogRemoteText(base,262144,fetcher));
    const version=meta.latestVersion?.version;
    if(typeof version!=='string'||version.length>100)throw httpError(502,'Versão indisponível na origem.');
    result={content:await catalogRemoteText(`${base}/file?path=SKILL.md&version=${encodeURIComponent(version)}`,65536,fetcher),source:`catalog:clawhub:${slug}:${version}`};
    // Some ClawHub files are plain Markdown. Preserve the instructions verbatim,
    // adding only the required index header; the converted copy remains inactive.
    if(!result.content.replace(/^\uFEFF/,'').trimStart().startsWith('---')) {
      const name=slug.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,64);
      result.content=`---\nname: ${name}\ndescription: ${JSON.stringify(entry.description.slice(0,1200)||entry.name)}\n---\n${result.content}`;
      result.source+=':wrapped';
    }
  } else if(entry.source==='lobehub') {
    const slug=entry.identifier.replace(/^lobehub\//,'');
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))throw httpError(400,'Identificador LobeHub não suportado.');
    const data=JSON.parse(await catalogRemoteText(`https://chat-agents.lobehub.com/${slug}.json`,65536,fetcher));
    const body=data.config?.systemRole;
    if(typeof body!=='string'||!body.trim())throw httpError(502,'A origem não forneceu instruções para converter.');
    result={content:`---\nname: ${slug}\ndescription: ${JSON.stringify(entry.description.slice(0,1200)||entry.name)}\n---\n${body}`,source:`catalog:lobehub:${slug}:converted`};
  } else throw httpError(400,'Esta fonte permite consulta; importe seu SKILL.md manualmente.');
  // Snapshots are inert until enabled in the existing review flow. No remote scripts run.
  return importSkill(result.content,result.source);
}
