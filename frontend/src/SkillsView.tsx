import { useEffect,useState } from 'react';
import EnginePanel from './EnginePanel';
import { listSkills,readSkill,readSkillResource,importSkill,enableSkill,getHermesSkills,getRuntimePolicy,searchSkillCatalog,syncSkillCatalog,importCatalogSkill,type SkillCatalogResult,type SkillInfo } from './api';
export default function SkillsView() {
  const [skills,setSkills]=useState<SkillInfo[]>([]),[query,setQuery]=useState(''),[selected,setSelected]=useState<SkillInfo & {body?:string,text?:string,resources?:string[]}|null>(null);
  const [reference,setReference]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[content,setContent]=useState('');
  const [catalog,setCatalog]=useState<{revision:string,skills:{name:string,path:string}[]}|null>(null);
  const [rules,setRules]=useState<Record<string,string>>({});
  const [hub,setHub]=useState<SkillCatalogResult|null>(null),[hubQuery,setHubQuery]=useState(''),[hubSource,setHubSource]=useState('');
  const [hubFilter,setHubFilter]=useState({q:'',source:'',includeAll:false});
  useEffect(()=>{if(selected)document.getElementById('skill-review')?.scrollIntoView({behavior:'smooth',block:'start'});},[selected]);
  useEffect(()=>{void searchSkillCatalog().then(setHub).catch(e=>setError(e.message));},[]);
  const curatedSources=hub?.sources.filter(s=>s.curated)??[],bulkSources=hub?.sources.filter(s=>!s.curated)??[];
  useEffect(()=>{void listSkills().then(setSkills).catch(e=>setError(e.message));void getRuntimePolicy().then(r=>setRules(r.rules)).catch(e=>setError(e.message));},[]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();setSkills(await listSkills());}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar skills.');}finally{setBusy(false);}};
  return <section className="skills-view"><h1>Skills e regras</h1>
    <p>Procedimentos reutilizáveis, carregados conforme a tarefa. Importações ficam inativas até você revisar e ativar. Ler uma skill não instala ferramentas nem executa seus scripts.</p>
    {error&&<p role="alert" className="memory-form-error">{error}</p>}
    <EnginePanel onChange={()=>void listSkills().then(setSkills).catch(e=>setError(e.message))}/>
    <section className="skills-hub" aria-label="Catálogo de skills"><div className="skills-hub-heading"><div><h2>Explore o catálogo Hermes</h2><p>{hub?.meta?`${hub.meta.total.toLocaleString('pt-BR')} entradas no índice`:'Carregue o índice para descobrir skills de várias fontes.'}</p></div><button disabled={busy} onClick={()=>void action(async()=>{await syncSkillCatalog();setHub(await searchSkillCatalog(hubFilter.q,hubFilter.source,0,hubFilter.includeAll));})}>{busy?'Aguarde…':'Atualizar catálogo'}</button></div>
      <p>Busque na lista e importe apenas o que precisa. O catálogo não entra no contexto da IA. A skill selecionada é salva para revisão; nenhuma ferramenta é instalada.</p>
      <form className="skills-hub-search" onSubmit={e=>{e.preventDefault();void action(async()=>{const filter={q:hubQuery,source:hubSource,includeAll:hubFilter.includeAll};setHub(await searchSkillCatalog(filter.q,filter.source,0,filter.includeAll));setHubFilter(filter);});}}>
        <label>Buscar no catálogo<input value={hubQuery} onChange={e=>setHubQuery(e.target.value)} placeholder="react, excel, game, testing…" maxLength={160}/></label>
        <label>Fonte<select value={hubSource} onChange={e=>setHubSource(e.target.value)}>
          <option value="">Fontes curadas ({curatedSources.reduce((n,s)=>n+s.count,0).toLocaleString('pt-BR')})</option>
          {curatedSources.map(s=><option key={s.source} value={s.source}>{s.source} · curada ({s.count.toLocaleString('pt-BR')})</option>)}
          {bulkSources.map(s=><option key={s.source} value={s.source}>{s.source} · sem revisão, volume bruto ({s.count.toLocaleString('pt-BR')})</option>)}
        </select></label>
        <button disabled={busy||!hub?.meta}>Buscar</button>
      </form>
      {hub?.restrictedToCurated&&<p className="skills-hub-notice">Mostrando só fontes curadas e revisadas ({hub.total.toLocaleString('pt-BR')} de {hub.overallTotal.toLocaleString('pt-BR')}). O restante vem de mirrors sem moderação (muitas entradas fora do português/inglês, ou sem relação com programação) — <button type="button" className="link-button" disabled={busy} onClick={()=>void action(async()=>{const filter={...hubFilter,includeAll:true};setHub(await searchSkillCatalog(filter.q,filter.source,0,true));setHubFilter(filter);})}>mostrar tudo mesmo assim</button>.</p>}
      {hub?.meta&&<><small>{hub.total.toLocaleString('pt-BR')} resultados · índice atualizado em {new Date(hub.meta.syncedAt).toLocaleDateString('pt-BR')}</small><div className="skill-grid catalog-grid">{hub.skills.map(s=>{const curated=hub.sources.find(x=>x.source===s.source)?.curated;return <article key={s.id}><small className={'source-badge'+(curated?' source-curated':' source-bulk')}>{s.source}</small><h3>{s.name}</h3><p>{s.description||'A fonte não forneceu descrição.'}</p><button disabled={busy||!s.importable} onClick={()=>void action(async()=>{const imported=await importCatalogSkill(s.id);setReference('');setSelected(await readSkill(imported.id));})}>Importar para revisão</button></article>;})}</div>{!hub.skills.length&&<p>Nenhuma skill encontrada. Experimente outro termo.</p>}<div className="catalog-pagination"><button disabled={busy||hub.page===0} onClick={()=>void action(async()=>setHub(await searchSkillCatalog(hubFilter.q,hubFilter.source,hub.page-1,hubFilter.includeAll)))}>Anterior</button><span>Página {hub.page+1} de {Math.max(1,Math.ceil(hub.total/hub.limit))}</span><button disabled={busy||(hub.page+1)*hub.limit>=hub.total} onClick={()=>void action(async()=>setHub(await searchSkillCatalog(hubFilter.q,hubFilter.source,hub.page+1,hubFilter.includeAll)))}>Próxima</button></div></>}
    </section>
    {selected&&<section id="skill-review" className="skill-review" aria-label="Revisar skill"><h2>{selected.name}</h2><p>Confira as instruções e dependências antes de ativar esta cópia.</p><pre>{selected.body}</pre>{selected.id.startsWith('import:')&&<button disabled={busy||skills.find(s=>s.id===selected.id)?.enabled===true} onClick={()=>void action(async()=>{await enableSkill(selected.id,true);})}>{skills.find(s=>s.id===selected.id)?.enabled?'Ativada':'Ativar esta skill'}</button>}<details><summary>Referências e versão</summary>{selected.resources?.map(resource=><button key={resource} disabled={busy} onClick={()=>void action(async()=>setReference((await readSkillResource(selected.id,resource)).text))}>{resource}</button>)}{reference&&<pre>{reference}</pre>}<small>{selected.hash}</small></details></section>}
    <h2>Minha biblioteca</h2>
    <label>Buscar skills<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="BI, jogos, testes…"/></label>
    <div className="skill-grid">{skills.filter(s=>(s.name+' '+s.description).toLowerCase().includes(query.toLowerCase())).map(s=><article key={s.id}>
      <h3>{s.name}</h3><p>{s.description}</p><small>{s.source} · {s.enabled?'ativa':'inativa'} · ~{s.estimatedTokens} tokens no corpo</small>
      {s.compatibility&&<p className="skill-compatibility">{s.compatibility.status==='blocked'?'Incompatível':s.compatibility.status==='compatible'?'Compatível com a engine':'Dependências a revisar'}{s.compatibility.status==='blocked'&&': '+s.compatibility.reasons.join(' ')}</p>}
      <div className="workflow-actions"><button disabled={busy} onClick={()=>void action(async()=>{setReference('');setSelected(await readSkill(s.id));})}>Ler</button>
      {s.id.startsWith('import:')?<button disabled={busy} onClick={()=>void action(async()=>{await enableSkill(s.id,!s.enabled);})}>{s.enabled?'Desativar':'Ativar'}</button>:s.source!=='bundled'&&<button disabled={busy} onClick={()=>void action(async()=>{await importSkill({skillId:s.id});})}>Importar cópia</button>}</div>
    </article>)}</div>
    <details><summary>Importar SKILL.md</summary><textarea rows={9} value={content} onChange={e=>setContent(e.target.value)} placeholder={'---\nname: minha-skill\ndescription: Quando usar\n---\nProcedimento e verificação.'}/><button disabled={busy||!content.trim()} onClick={()=>void action(async()=>{await importSkill({content});setContent('');})}>Importar para revisão</button></details>
    <details><summary>Catálogo oficial do Hermes</summary><p>Busca somente os nomes disponíveis. A importação fixa a revisão do repositório; referências de texto podem ser consultadas sob demanda ao abrir a skill. Verifique ferramentas e dependências antes de ativar.</p>
      <button disabled={busy} onClick={()=>void action(async()=>setCatalog(await getHermesSkills()))}>Consultar catálogo online</button>
      {catalog&&<><small>Revisão: {catalog.revision}</small><div className="skill-catalog">{catalog.skills.filter(s=>s.name.includes(query.toLowerCase())).map(s=><div key={s.path}><span>{s.name}</span><button disabled={busy} onClick={()=>void action(async()=>{const imported=await importSkill({hermesPath:s.path});setSelected(await readSkill(imported.id));})}>Importar para revisão</button></div>)}</div></>}
    </details>
    <details><summary>Regras internas do Aurora</summary>{Object.entries(rules).map(([name,text])=><article key={name}><h3>{name}.md</h3><pre>{text}</pre></article>)}</details>
  </section>;
}
