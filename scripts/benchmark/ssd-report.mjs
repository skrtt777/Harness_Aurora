import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
const root=resolve(process.env.SSD_REPORT_DIR||'reports/ssd-moe-v1');
const read=async p=>{for(let attempt=0;;attempt++){try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;if(e instanceof SyntaxError&&attempt<3){await new Promise(r=>setTimeout(r,100));continue;}throw e;}}};
const sum=x=>x.reduce((s,n)=>s+(Number.isFinite(n)?n:0),0);
const median=x=>{x=x.filter(Number.isFinite).sort((a,b)=>a-b);return x.length?(x[Math.floor((x.length-1)/2)]+x[Math.floor(x.length/2)])/2:null;};
const max=x=>x.length?Math.max(...x):null;
const outcome=r=>r.passed?'passed':/abort|timeout|time.?out|limite de tempo|duration budget/i.test(r.trace.at(-1)?.response.error||r.workflow.error||'')?'timeout':r.trace.at(-1)?.response.truncated?'truncated':r.trace.at(-1)?.response.ok?'functional':'execution';
export async function collect(){
 const manifest=await read(join(root,'manifest.json'));if(!manifest)throw Error('Missing manifest');
 const profiles=[];
 for(const p of manifest.definitions.profiles){
  const out=join(root,p.id),summary=await read(join(out,'summary.json')),process=await read(join(out,'process.json'));
  let files=[];try{files=await readdir(join(out,'runs'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const records=await Promise.all(files.filter(f=>f.endsWith('.json')).map(f=>read(join(out,'runs',f))));
  let samples=[];try{samples=(await readFile(join(out,'samples.jsonl'),'utf8')).trim().split('\n').flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}});}catch(e){if(e.code!=='ENOENT')throw e;}
  const calls=records.flatMap(r=>r.trace.map(t=>t.response));
  const timed=calls.filter(c=>c.ok&&c.metrics?.timings);
  const perTask=records.map(r=>({id:r.id,domain:r.domain,seed:r.seed,passed:r.passed,outcome:outcome(r),firstPassed:r.firstPassed,elapsedMs:r.elapsedMs,
   tokens:r.inputTokens+r.outputTokens,estimatedTokens:r.estimatedTokens,calls:r.calls,error:r.workflow.error,
   evidence:r.workflow.steps[0]?.validation?.evidence||[],startedAt:r.startedAt,finishedAt:r.finishedAt}));
  profiles.push({...p,complete:!!summary,done:records.length,total:24,passed:records.filter(r=>r.passed).length,
   firstPassed:records.filter(r=>r.firstPassed).length,retention:summary?.retentionPassed??null,
   timeoutTasks:records.filter(r=>outcome(r)==='timeout').length,
   noFirstTokenCalls:calls.filter(c=>c.metrics?.firstTokenMs==null).length,
   inputTokens:sum(records.map(r=>r.inputTokens)),outputTokens:sum(records.map(r=>r.outputTokens)),estimatedTokens:sum(records.map(r=>r.estimatedTokens)),
   calls:calls.length,failedCalls:calls.filter(c=>!c.ok).length,truncated:calls.filter(c=>c.truncated).length,
   partialOutputTokens:sum(calls.filter(c=>!c.ok).map(c=>c.metrics?.partialOutputTokens)),
   elapsedMs:sum(records.map(r=>r.elapsedMs)),medianTaskMs:median(records.map(r=>r.elapsedMs)),
   medianFirstTokenMs:median(calls.map(c=>c.metrics?.firstTokenMs)),firstTokenCoverage:calls.filter(c=>Number.isFinite(c.metrics?.firstTokenMs)).length,
   medianInitialFirstTokenMs:median(records.map(r=>r.trace[0]?.response.metrics?.firstTokenMs)),
   effectiveOutputTokensPerSecond:sum(calls.map(c=>c.metrics?.wallMs))?1000*sum(calls.map(c=>c.ok?c.usage?.output_tokens:c.metrics?.partialOutputTokens))/sum(calls.map(c=>c.metrics?.wallMs)):null,
   decodeTokensPerSecond:sum(timed.map(c=>c.metrics.timings.predicted_ms))?1000*sum(timed.map(c=>Math.max(0,c.metrics.timings.predicted_n-1)))/sum(timed.map(c=>c.metrics.timings.predicted_ms)):null,
   decodeCoverage:timed.length,peakRss:max(samples.map(s=>s.rss)),peakWorkingSet:max(samples.map(s=>s.peakWset)),
   peakPrivate:max(samples.map(s=>s.private)),systemCacheMin:samples.length?Math.min(...samples.map(s=>s.systemCache)):null,
   systemCacheMax:max(samples.map(s=>s.systemCache)),systemAvailableMin:samples.length?Math.min(...samples.map(s=>s.systemAvailable)):null,
   diskReadBytes:samples.length?sum(samples.slice(1).map((s,i)=>s.pageFaults<samples[i].pageFaults?0:Math.max(0,s.diskReadBytes-samples[i].diskReadBytes))):null,
   pageFaults:samples.length?sum(samples.slice(1).map((s,i)=>Math.max(0,s.pageFaults-samples[i].pageFaults))):null,
   processSegments:samples.length?1+samples.slice(1).filter((s,i)=>s.pageFaults<samples[i].pageFaults).length:0,
   capBytes:process?.actualMaximumBytes??Math.floor(16*1024**3*p.percent/100/4096)*4096,
   capVerified:process?!!(process.flags&4):null,capExceeded:samples.some(s=>s.peakWset>process?.actualMaximumBytes),
   capExcessBytes:process&&samples.length?Math.max(0,max(samples.map(s=>s.peakWset))-process.actualMaximumBytes):null,
   startup:await read(join(out,'startup.json')),probes:await read(join(out,'probes.json')),perTask,
   lastSampleAt:samples.at(-1)?.at??null,
   domains:Object.fromEntries(['jogo','pagina','app','bi'].map(d=>{const rows=records.filter(r=>r.domain===d);return[d,{passed:rows.filter(r=>r.passed).length,done:rows.length,total:6}];})),
   curve:samples.filter((_,i)=>i%20===0).map(s=>({at:s.at,rss:s.rss,cache:s.systemCache,available:s.systemAvailable}))});
 }
 const baseline=profiles[0];
 for(const p of profiles.slice(1)){
  const paired=p.perTask.flatMap(r=>{const old=baseline.perTask.find(b=>b.id===r.id&&b.seed===r.seed);return old?[{old,new:r}]:[];});
  p.paired={count:paired.length,gains:paired.filter(r=>!r.old.passed&&r.new.passed).length,losses:paired.filter(r=>r.old.passed&&!r.new.passed).length,
   bothPass:paired.filter(r=>r.old.passed&&r.new.passed).length,bothFail:paired.filter(r=>!r.old.passed&&!r.new.passed).length};
 }
 const quality=[];
 for(const arm of ['old','current','moe']){
  const qroot=resolve('reports/ssd-quality-control-v1',arm),summary=await read(join(qroot,'summary.json'));
  let files=[];try{files=await readdir(join(qroot,'runs'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const records=await Promise.all(files.filter(f=>f.endsWith('.json')).map(f=>read(join(qroot,'runs',f))));
  const audit=await read(resolve('reports/ssd-semantic-review-v1',arm+'.json'));
  quality.push({arm,complete:!!summary,done:records.length,passed:records.filter(r=>r.passed).length,
   reviewPassed:audit?.reviewPassed??null,redundantRepairCases:audit?.redundantRepairCases??null,redundantRepairTokens:audit?.tokensSpentAfterAlreadyCorrectFirst??null,
   tokens:sum(records.map(r=>r.inputTokens+r.outputTokens)),calls:sum(records.map(r=>r.calls)),elapsedMs:sum(records.map(r=>r.elapsedMs)),
   firstPassed:records.filter(r=>r.firstPassed).length,retention:summary?.retentionPassed??null,
   domains:Object.fromEntries(['jogo','pagina','app','bi'].map(domain=>{const rows=records.filter(r=>r.domain===domain);return[domain,{done:rows.length,passed:rows.filter(r=>r.passed).length}];}))});
 }
 const calibration=[];
 for(const id of ['dice-sequence','word-count','break-even']){
  const r=await read(resolve('reports/ssd-moe-calibration-v1/b512',id+'.json'));
  if(r)calibration.push({round:1,id,label:'b512',passed:r.validation?.status==='passed',originalPassed:r.original.passed,
   originalFirstTokenMs:r.original.first.firstTokenMs,firstTokenMs:r.response.firstTokenMs,
   originalWallMs:r.original.first.wallMs,wallMs:r.response.wallMs});
 }
 for(const presetId of ['b512-pf','b512-kr8','b512-kr8-pf','b512-kr16-pf','b512-cs-pf'])
  for(const id of ['dice-sequence','locale-greeting','word-count','break-even']){
   const r=await read(resolve('reports/ssd-moe-calibration-v2',presetId,id+'.json'));
   if(r)calibration.push({round:2,id,label:presetId,passed:r.validation?.status==='passed',originalPassed:r.original.passed,
    originalFirstTokenMs:r.original.first.firstTokenMs,firstTokenMs:r.response.firstTokenMs,
    originalWallMs:r.original.first.wallMs,wallMs:r.response.wallMs});
  }
 return {updatedAt:new Date().toISOString(),cpuComplete:profiles.every(p=>p.complete),complete:profiles.every(p=>p.complete)&&quality.every(p=>p.complete),manifest,profiles,quality,calibration};
}
function document(data){return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aurora · Qwen MoE</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e8edf7;font:15px/1.6 system-ui}main{max-width:1380px;margin:auto;padding:36px}h1{font-size:32px;margin:4px 0;color:#81e7f5}h2{font-size:19px;margin-top:30px}.muted{color:#a5b4ce}p{max-width:1000px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#141d31;border:1px solid #283651;border-radius:12px;padding:18px}.value{font-size:27px;color:#a3a0ff}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}td,th{padding:12px;text-align:left;border-bottom:1px solid #29334a}th{color:#90daf1;font-size:13px}.note{background:#192437;border-left:3px solid #d9b96f;padding:16px;border-radius:4px}.bar{height:9px;background:#29334a;width:90px;border-radius:6px}.fill{height:100%;background:linear-gradient(90deg,#36d9e7,#9b73ff);border-radius:6px}label{display:inline-flex;gap:10px;align-items:center;margin-right:20px}input,select,button{background:#151f34;color:#fff;border:1px solid #435174;border-radius:6px;padding:8px;font:inherit}input{width:110px}button{cursor:pointer}a{color:#8ce4ff}details{margin:15px 0}summary{cursor:pointer}.ok{color:#73e4bf}.bad{color:#ffbcad}svg{width:100%;height:200px}.legend span{margin-right:22px}footer{margin-top:40px;color:#a5b4ce;font-size:13px}@media(max-width:750px){main{padding:18px}.cards{grid-template-columns:repeat(2,1fr)}h1{font-size:25px}}@media print{body{background:white;color:#17233b}.card,.note{background:#eef3fa}button{display:none}main{padding:8px}.scroll{overflow:visible}table{font-size:10px}td,th{padding:6px}}</style>
<main><div class="muted">AURORA / LABORATÓRIO LOCAL</div><h1>Qualidade × velocidade × memória</h1><p id="status"></p>
<div class="cards" id="cards"></div>
<p class="note"><strong>O que este teste prova:</strong> comportamento em um i9-14900K com 31,8 GiB e SSD NVMe, usando apenas CPU. Os limites de 3,2–8 GiB valem para a memória residente do executor. O cache do Windows fica fora deles. <strong>Não certifica funcionamento em um PC físico de 16 GB.</strong></p>
<h2>Resultados medidos</h2><div class="scroll"><table><thead><tr><th>Modelo / limite</th><th>Aprovados</th><th>Prazo esgotado</th><th>1ª tentativa</th><th>Tempo por tarefa¹</th><th>1º token¹</th><th>Tokens/s²</th><th>Pico de RAM</th><th>Retenção</th></tr></thead><tbody id="results"></tbody></table></div>
<p class="muted">¹ Mediana; primeiro token considera a primeira chamada de cada tarefa, quando recebido. ² Geração das chamadas concluídas; a cobertura e as falhas estão abaixo. Tempo total inclui validação e correções. Duas sementes por tarefa, até duas tentativas, 120 s por chamada e 180 s por tarefa. Casos pendentes não contam como falhas.</p>
<h2>Qualidade por área e comparação pareada</h2><div class="scroll"><table><thead><tr><th>Perfil</th><th>Jogo</th><th>Página</th><th>App</th><th>BI</th><th>Ganhos / perdas³</th><th>Cobertura</th></tr></thead><tbody id="domains"></tbody></table></div><p class="muted">³ Ganho: antigo falhou e novo passou; perda: antigo passou e novo falhou, na mesma tarefa e semente. Conjunto pequeno de regressão já utilizado, não precisão geral do modelo.</p>
<h2>Consumo, falhas e leituras</h2><div class="scroll"><table><thead><tr><th>Perfil</th><th>Tokens completos</th><th>Saída efetiva⁶</th><th>Chamadas com erro</th><th>Saídas truncadas</th><th>Cache do sistema</th><th>Leitura NVMe⁴</th><th>Teto respeitado</th></tr></thead><tbody id="resources"></tbody></table></div><p class="muted">⁴ Leitura física do disco inteiro durante o perfil, incluindo outros programas e inicialização. Page faults incluem acessos resolvidos em RAM: não equivalem a leituras do SSD. Cache do sistema inclui standby e outros aplicativos; não deve ser somado ao RSS para estimar uso exclusivo do modelo. ⁶ Tokens de saída completos + parciais recebidos, divididos pelo tempo das chamadas, incluindo preparação e espera. Não são entregas aprovadas.</p>
<h2>Controle adicional de qualidade — hardware disponível</h2><p class="muted">Mesmos 24 casos via Ollama, com GPU disponível e sem teto de RAM. Não representa velocidade nem memória em um PC de 16 GB. Este controle usa o runtime normal do app e os padrões de amostragem de cada modelo; não isola somente o efeito da memória.</p><div class="scroll"><table><thead><tr><th>Modelo</th><th>Contrato original</th><th>Revisão posterior⁵</th><th>Retenção</th><th>Tokens medidos</th><th>Chamadas</th><th>Jogo</th><th>Página</th><th>App</th><th>BI</th></tr></thead><tbody id="quality"></tbody></table></div><p class="muted">⁵ Reavaliação dos mesmos arquivos, sem gerar ou corrigir código: lê valores numéricos em campos, aceita o botão desabilitado após a chegada e verifica linhas visíveis na busca. Aplicada aos três modelos, com referências e controles negativos. Não substitui a pontuação original nem constitui teste independente. As colunas por área mantêm o contrato original.</p><div id="audit" class="note"></div>
<h2>Diagnóstico exploratório: lote e mitigações Swap-MoE</h2><p>Rodada 1: três tarefas com teto de 30%, comparando lote 128 (original) com 512, sem reparos. Rodada 2: quatro tarefas (uma por domínio) com teto de 50%, testando combinações de lote 512 com <code>--expert-keep-recent</code>, <code>--expert-prefetch</code> e <code>--expert-cache-size</code>, ainda não exercidas na campanha original. Primeiros pedidos reaproveitados; não substitui a grade principal nem comprova ganho geral.</p><div class="scroll"><table><thead><tr><th>Rodada</th><th>Preset</th><th>Tarefa</th><th>1º token · original</th><th>1º token · preset</th><th>Duração · preset</th><th>Resultado</th></tr></thead><tbody id="calibration"></tbody></table></div>
<h2>Memória ao longo da execução</h2><label>Perfil <select id="profile"></select></label><svg id="chart" viewBox="0 0 1000 200" role="img" aria-label="RAM do processo e cache do Windows"></svg><div class="legend"><span style="color:#66ddec">● RAM do executor</span><span style="color:#b198ff">● Cache do Windows</span></div>
<h2>Simulação de custo de energia</h2><p>Não houve medição de potência da tomada. Preencha a potência média para simular; este valor não representa custo real medido.</p><label>Tarifa R$/kWh <input id="tariff" type="number" min="0" step=".01" value="1"></label><label>Potência média W <input id="watts" type="number" min="0" step="1" placeholder="Informar"></label><div id="cost"></div>
<details><summary>Carregamento e sondas curtas</summary><p>Tempo até o executor ficar disponível e duas respostas à mesma conta simples. A primeira é fria apenas para o processo; o cache do Windows não foi limpo. No perfil de 20%, estes valores são da retomada; a primeira sessão está preservada nas evidências.</p><div class="scroll"><table><thead><tr><th>Perfil</th><th>Executor disponível</th><th>1ª sonda · total</th><th>2ª sonda · total</th></tr></thead><tbody id="startup"></tbody></table></div></details>
<details><summary>Evidências por tarefa</summary><div class="scroll"><table><thead><tr><th>Perfil</th><th>Tarefa / semente</th><th>Resultado</th><th>Tempo</th><th>Evidência</th></tr></thead><tbody id="tasks"></tbody></table></div></details>
<details><summary>Metodologia e limites</summary><p>Pesos GGUF conferidos por SHA-256; Qwen3-Coder 30B MoE e Qwen2.5-Coder 1.5B original. Mesmo llama.cpp, 8 threads, sem GPU, contexto 8192, saída máxima 1536, temperatura 0,2. Contratos executados no navegador; respostas de referência verificadas antes de cada perfil. Memórias e skills desligadas para isolar o modelo. Não há treinamento nem alteração dos pesos. Todos os especialistas necessários continuam ativos.</p><p>Primeira chamada fria apenas para o processo; cache do sistema não foi limpo. Perfis sequenciais, com carga externa não isolada. Relógio, RAM, disco e respostas brutas ficam registrados em JSON. Comparação com o relatório antigo em Ollama é contextual, não uma medição controlada de velocidade.</p><p>Windows: <a href="https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-setprocessworkingsetsizeex">limite do working set</a> e <a href="https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information">cache do sistema</a>. Executor experimental: <a href="https://github.com/ek15072809/Swap-MoE">Swap-MoE</a>.</p></details>
<button onclick="window.print()">Imprimir / salvar PDF</button><footer id="footer"></footer></main>
<script>let data=${JSON.stringify(data).replaceAll('<','\\u003c')};
const $=s=>document.getElementById(s),f=(n,d=1)=>n==null?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:d,minimumFractionDigits:d}),g=n=>n==null?'—':f(n/2**30)+' GiB',sec=n=>n==null?'—':f(n/1000)+' s',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),label=p=>p.id==='old-30'?'Antigo 1,5B · 30%':'Qwen3 MoE · '+p.percent+'%';
function render(){const ps=data.profiles,done=ps.reduce((s,p)=>s+p.done,0),expected=ps.length*24;$('status').textContent=(data.complete?'Avaliação concluída':'Avaliação em andamento')+' · '+done+'/'+expected+' casos · atualizado '+new Date(data.updatedAt).toLocaleString('pt-BR');
 $('cards').innerHTML=[['Casos concluídos',done+' / '+expected],['Perfis',ps.filter(p=>p.complete).length+' / '+ps.length],['Limites relativos a 16 GiB',[...new Set(ps.map(p=>p.percent))].sort((a,b)=>a-b).join(' · ')+'%'],['GPU na inferência','Desativada']].map(([k,v])=>'<div class="card"><div class="muted">'+k+'</div><div class="value">'+v+'</div></div>').join('');
 $('results').innerHTML=ps.map(p=>'<tr><td>'+label(p)+'</td><td>'+p.passed+' de '+p.done+'<div class="bar"><div class="fill" style="width:'+(p.done?100*p.passed/p.done:0)+'%"></div></div></td><td>'+p.timeoutTasks+'/'+p.done+'</td><td>'+p.firstPassed+'/'+p.done+'</td><td>'+sec(p.medianTaskMs)+'</td><td>'+sec(p.medianInitialFirstTokenMs)+'</td><td>'+f(p.decodeTokensPerSecond)+' <small>('+p.decodeCoverage+'/'+p.calls+')</small></td><td>'+g(p.peakWorkingSet)+'</td><td>'+(p.retention==null?'Pendente':p.retention+'/4')+'</td></tr>').join('');
 $('domains').innerHTML=ps.map(p=>'<tr><td>'+label(p)+'</td>'+Object.values(p.domains).map(d=>'<td>'+d.passed+'/'+d.done+'</td>').join('')+'<td>'+(p.paired?p.paired.gains+' / '+p.paired.losses:'Referência')+'</td><td>'+p.done+'/24</td></tr>').join('');
 $('resources').innerHTML=ps.map(p=>'<tr><td>'+label(p)+'</td><td>'+f(p.inputTokens+p.outputTokens,0)+(p.estimatedTokens?' · contagem incompleta':'')+'<br><small>'+f(p.partialOutputTokens,0)+' tokens parciais recebidos</small></td><td>'+f(p.effectiveOutputTokensPerSecond)+' tok/s</td><td>'+p.failedCalls+'/'+p.calls+'<br><small>'+p.noFirstTokenCalls+' sem primeiro token</small></td><td>'+p.truncated+'</td><td>'+g(p.systemCacheMin)+' – '+g(p.systemCacheMax)+'</td><td>'+g(p.diskReadBytes)+'</td><td>'+(p.capVerified?(p.capExceeded?'Excesso '+f(p.capExcessBytes/1024,0)+' KiB':'Sim, processo'):'Pendente')+'</td></tr>').join('');
 $('quality').innerHTML=(data.quality||[]).map(p=>'<tr><td>'+({old:'Original 1,5B',current:'Padrão atual Qwen3.5 4B',moe:'Qwen3-Coder MoE 30B'}[p.arm])+'</td><td>'+p.passed+'/'+p.done+(p.done<24?' · parcial':'')+'</td><td>'+(p.reviewPassed==null?'Pendente':p.reviewPassed+'/24')+'</td><td>'+(p.retention==null?'Pendente':p.retention+'/4')+'</td><td>'+f(p.tokens,0)+'</td><td>'+p.calls+'</td>'+Object.values(p.domains).map(d=>'<td>'+d.passed+'/'+d.done+'</td>').join('')+'</tr>').join('');
 const audit=(data.quality||[]).find(p=>p.arm==='moe');$('audit').textContent=audit?.reviewPassed!=null?'Auditoria do MoE: '+audit.redundantRepairCases+' respostas já corretas receberam correções desnecessárias, consumindo '+f(audit.redundantRepairTokens,0)+' tokens adicionais. Esse desperdício foi observado; evitá-lo em produção exige corrigir e validar o harness.':'Auditoria do validador pendente.';
 $('calibration').innerHTML=(data.calibration||[]).map(p=>'<tr><td>'+p.round+'</td><td>'+esc(p.label)+'</td><td>'+esc(p.id)+'</td><td>'+sec(p.originalFirstTokenMs)+'</td><td>'+sec(p.firstTokenMs)+'</td><td>'+sec(p.wallMs)+'</td><td>'+(p.passed?'Passou':'Não concluiu / falhou')+'</td></tr>').join('');
 const current=$('profile').value;$('profile').innerHTML=ps.map(p=>'<option value="'+p.id+'">'+label(p)+'</option>').join('');if(current)$('profile').value=current;
 $('tasks').innerHTML=ps.flatMap(p=>p.perTask.map(t=>'<tr><td>'+label(p)+'</td><td>'+t.id+' / '+t.seed+'</td><td class="'+(t.passed?'ok':'bad')+'">'+({passed:'Passou',timeout:'Prazo esgotado',truncated:'Saída truncada',functional:'Falha funcional',execution:'Erro de execução'}[t.outcome]||'Falhou')+'</td><td>'+sec(t.elapsedMs)+'</td><td style="white-space:normal;min-width:300px">'+esc(t.evidence.join(' ')||t.error||'Contrato aprovado')+'</td></tr>')).join('');
 $('startup').innerHTML=ps.map(p=>'<tr><td>'+label(p)+'</td><td>'+sec(p.startup?.startupMs)+'</td><td>'+sec(p.probes?.[0]?.response.metrics?.wallMs)+'</td><td>'+sec(p.probes?.[1]?.response.metrics?.wallMs)+'</td></tr>').join('');
 $('footer').textContent='Experimento '+data.manifest.createdAt+' · Evidências: reports/ssd-moe-v1 · Sem certificação para hardware de 16 GB.';chart();cost();}
function chart(){
 const p=data.profiles.find(p=>p.id===$('profile').value),a=p.curve;
 if(!a.length){$('chart').innerHTML='<text x="20" y="90" fill="#a5b4ce">Aguardando medições</text>';return;}
 const top=Math.max(1,...a.map(s=>Math.max(s.rss,s.cache)))/2**30*1.1,start=a[0].at,span=Math.max(1,a.at(-1).at-start),segments=[];
 for(const s of a){if(!segments.length||s.at-segments.at(-1).at(-1).at>15000)segments.push([]);segments.at(-1).push(s);}
 $('chart').innerHTML='<text x="5" y="18" fill="#a5b4ce">'+f(top)+' GiB</text>'+[['rss','#66ddec'],['cache','#b198ff']].flatMap(([k,c])=>segments.map(segment=>'<polyline fill="none" stroke="'+c+'" stroke-width="2" points="'+segment.map(s=>(40+950*(s.at-start)/span)+','+(180-150*s[k]/2**30/top)).join(' ')+'"/>')).join('')+'<text x="40" y="198" fill="#a5b4ce">0 min</text><text x="880" y="198" fill="#a5b4ce">'+f(span/60000)+' min</text>';
}
function cost(){if(!$('watts').value){$('cost').innerHTML='<p class="muted">Informe a potência para calcular o cenário.</p>';return;}const w=Number($('watts').value),r=Number($('tariff').value);if(!Number.isFinite(w)||!Number.isFinite(r)||w<0||r<0)return;$('cost').innerHTML='<p>'+data.profiles.map(p=>{const c=p.elapsedMs/3600000*w/1000*r;return label(p)+': <strong>R$ '+f(c,4)+'</strong> nas '+p.done+' tarefas'+(p.passed?' · R$ '+f(c/p.passed,4)+' por tarefa aprovada':' · custo por aprovação indefinido');}).join('<br>')+'</p>';}
 $('profile').onchange=chart;$('tariff').oninput=cost;$('watts').oninput=cost;render();if(location.protocol!=='file:')setInterval(async()=>{try{const r=await fetch('/data.json');if(r.ok){data=await r.json();render();}}catch{}},10000);
</script></html>`;}
async function save(){
 const data=await collect();
 await writeFile(join(root,'dashboard-data.json'),JSON.stringify(data,null,2));
 await writeFile(join(root,'dashboard.html'),document(data));
 const f=(n,d=2)=>n==null?'—':Number(n).toFixed(d),g=n=>n==null?'—':f(n/2**30);
 const lines=['# Aurora — Qwen3 MoE por SSD','',data.complete?'Campanha concluída.':'**Campanha parcial: não concluir superioridade antes de completar a cobertura.**','',
  'Atualização: '+data.updatedAt,'',
  '| Perfil | Aprovações | Primeiro acerto | Retenção | Mediana por tarefa (s) | Tokens/s concluídos | Pico processo (GiB) | Teto processo (GiB) |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...data.profiles.map(p=>`| ${p.id} | ${p.passed}/${p.done} de 24 | ${p.firstPassed}/${p.done} | ${p.retention==null?'Pendente':p.retention+'/4'} | ${f(p.medianTaskMs==null?null:p.medianTaskMs/1000)} | ${f(p.decodeTokensPerSecond)} | ${g(p.peakWorkingSet)} | ${g(p.capBytes)} |`),
  '', '## Comparação pareada com o antigo', '',
  ...data.profiles.slice(1).map(p=>`- ${p.id}: ${p.paired.gains} ganhos, ${p.paired.losses} perdas, ${p.paired.bothPass} acertos comuns e ${p.paired.bothFail} falhas comuns em ${p.paired.count} pares concluídos.`),
  '', '## Controle adicional de qualidade (Ollama, GPU disponível, sem teto)', '',
  ...data.quality.map(p=>`- ${p.arm}: ${p.passed}/${p.done} aprovados pelo contrato original; revisão posterior ${p.reviewPassed??'pendente'}/24; retenção ${p.retention??'pendente'}/4. ${p.tokens} tokens, ${p.calls} chamadas. ${p.complete?'Concluído.':'Parcial.'}`),
  '', 'A revisão posterior reexecuta os mesmos artefatos com correções específicas no validador e contratos. Não altera os arquivos dos modelos nem substitui a pontuação original. Não é uma avaliação independente.',
  '', '## Limitações', '',
  '- i9-14900K, 31,8 GiB, NVMe, CPU sem GPU; não representa hardware físico de 16 GB.',
  '- Teto confirmado do working set do processo. Cache do Windows fora do teto; valores do sistema incluem outros programas. Não somar RSS e cache.',
  '- Cache do SSD não foi limpo; apenas processo frio/quente, ordem fixa, carga externa não isolada.',
  '- Contratos reutilizados e amostra pequena. Falhar por timeout não demonstra que a resposta completa seria incorreta.',
  '- Tempos incluem correções/validação. Tokens/s calculados apenas em chamadas concluídas; consultar erros e cobertura no dashboard.',
  '- Custo de energia não medido. Tarifa R$ 1,00/kWh editável e potência informada são hipóteses.',
  '', 'Evidências completas: manifesto, preparation.json, logs, amostras JSONL e runs/*.json. Painel: dashboard.html.'];
 await writeFile(join(root,'results.md'),lines.join('\n')+'\n');return data;
}
if(process.argv.includes('--serve')){
 const server=createServer(async(req,res)=>{try{const data=await collect();res.setHeader('Cache-Control','no-store');if(req.url==='/data.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(document(data));}else{res.statusCode=404;res.end();}}catch(e){res.statusCode=500;res.end(e.message);}});
 server.listen(18796,'127.0.0.1',()=>console.log('http://127.0.0.1:18796'));await save();
}else{const d=await save();console.log(JSON.stringify(d.profiles.map(({id,done,passed,retention,medianTaskMs,decodeTokensPerSecond,peakWorkingSet,capExceeded})=>({id,done,passed,retention,medianTaskMs,decodeTokensPerSecond,peakWorkingSet,capExceeded})),null,2));}
