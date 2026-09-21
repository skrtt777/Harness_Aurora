import {useEffect,useState} from 'react';
import {getEngineSummary,getEngineEvaluation,reviewEngineKnowledge,type EngineKnowledge,type EngineMetrics,type EngineEvaluation} from './api';
const number=(n:number)=>n.toLocaleString('pt-BR',{maximumFractionDigits:1});
const money=(n:number)=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:4});
export default function EnginePanel({onChange}:{onChange:()=>void}){
  const [data,setData]=useState<{knowledge:EngineKnowledge[];metrics:EngineMetrics}|null>(null),[evaluation,setEvaluation]=useState<EngineEvaluation|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [tariff,setTariff]=useState(()=>Number(localStorage.getItem('aurora.engine.tariff')??1)),[watts,setWatts]=useState(()=>Number(localStorage.getItem('aurora.engine.watts')??300));
  const load=async()=>{setData(await getEngineSummary());setEvaluation(await getEngineEvaluation());};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  const review=async(id:string,accepted:boolean)=>{setBusy(true);setError('');try{await reviewEngineKnowledge(id,accepted);await load();onChange();}catch(e){setError(e instanceof Error?e.message:'Falha na revisão');}finally{setBusy(false);}};
  const cost=(ms:number)=>ms/3600000*(watts/1000)*tariff;
  return <details className="engine-panel"><summary>Engine de Evidências · desempenho e aprendizado</summary>
    <p>Correções precisam passar nos testes antes de virarem conhecimento candidato. A ativação permite reutilizar o procedimento somente na conversa ou no projeto de origem.</p>
    {error&&<p role="alert">{error}</p>}
    <button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Atualizar resultados</button>
    {data&&<><div className="engine-metrics"><article><strong>{data.metrics.passedContracts}/{data.metrics.attempted}</strong><span>Execuções com contratos aprovados</span></article><article><strong>{data.metrics.tokensPerPassed===null?'—':number(data.metrics.tokensPerPassed)}</strong><span>Tokens medidos por execução aprovada</span></article><article><strong>{data.metrics.reuses}</strong><span>Reutilizações registradas</span></article><article><strong>{data.knowledge.filter(k=>k.status==='candidate').length}</strong><span>Conhecimentos aguardando revisão</span></article></div>
    <p>{number(data.metrics.measuredTokens)} tokens medidos · {number(data.metrics.estimatedTokens)} estimados separadamente · {data.metrics.references} referências consultadas · {data.metrics.humanAccepted} entregas com aceite humano.</p></>}
    <div className="engine-cost"><label>Tarifa estimada (R$/kWh)<input type="number" min="0" max="100" step="0.1" value={tariff} onChange={e=>{const v=Math.max(0,Math.min(100,Number(e.target.value)));setTariff(v);localStorage.setItem('aurora.engine.tariff',String(v));}}/></label><label>Potência estimada do PC (W)<input type="number" min="0" max="3000" value={watts} onChange={e=>{const v=Math.max(0,Math.min(3000,Number(e.target.value)));setWatts(v);localStorage.setItem('aurora.engine.watts',String(v));}}/></label></div>
    <small>Simulação editável de energia durante os ciclos. Não mede a tomada e não inclui equipamento, trabalho humano ou APIs. Sem aprovações, o custo por aprovação fica indisponível.</small>
    {evaluation&&<section aria-label="Avaliação congelada"><h3>Avaliação em tarefas novas</h3><p>{evaluation.taskCount} tarefas · {evaluation.seeds.length} sementes · {evaluation.model}. {evaluation.scope}</p><div className="engine-table"><table><thead><tr><th>Configuração</th><th>Aprovados</th><th>Tokens / aprovação</th><th>Tempo / aprovação</th><th>Reparos</th><th>Energia / aprovação</th></tr></thead><tbody>{evaluation.arms.map(a=><tr key={a.name}><td>{a.name}</td><td>{a.passed}/{a.runs}</td><td>{a.passed&&a.completeUsage?number(a.tokens/a.passed):'—'}</td><td>{a.passed?number(a.elapsedMs/a.passed/1000)+' s':'—'}</td><td>{a.repairCalls}</td><td>{a.passed?money(cost(a.elapsedMs)/a.passed):'—'}</td></tr>)}</tbody></table></div><small>O numerador inclui todas as tentativas do grupo, inclusive falhas. Aprovação vale para os cenários testados; não é precisão geral.</small></section>}
    <h3>Aprendizado verificável</h3>
    {data?.knowledge.length===0&&<p>Ainda não há reparos funcionais comprovados nesta base. Eles aparecerão aqui quando uma correção passar em contratos fornecidos antes da geração.</p>}
    {data?.knowledge.map(k=><details key={k.id}><summary>{k.title} · {k.status==='active'?'ativo':k.status==='rejected'?'desativado':'candidato'}</summary><p>{k.goal}</p><small>{k.evidence.length} evidência(s) · escopo: {k.scope.projectId?'projeto':'conversa'} · validade observada nos casos registrados.</small><h4>Antes</h4><pre>{k.old}</pre><h4>Depois</h4><pre>{k.fixed}</pre><button disabled={busy||k.status==='active'} onClick={()=>void review(k.id,true)}>Ativar conhecimento</button> <button disabled={busy||k.status==='rejected'} onClick={()=>void review(k.id,false)}>Desativar conhecimento</button></details>)}
  </details>;
}
