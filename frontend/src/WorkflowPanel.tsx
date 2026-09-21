import { useEffect, useState } from 'react';
import { createWorkflow, listWorkflows, getWorkflow, runWorkflow, cancelWorkflow, reviewWorkflow, teachWorkflow, recheckWorkflow, type Workflow } from './api';

const labels: Record<string,string> = { draft:'Pronto para planejar',planning:'Planejando',planned:'Plano pronto',running:'Executando',validating:'Validando',completed:'Concluída',pending:'Pendente',failed:'Precisa de atenção',interrupted:'Interrompida',budget_exhausted:'Orçamento esgotado',awaiting_review:'Revisão necessária',awaiting_acceptance:'Aceite final necessário' };
const previewPolicy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\';">';
export default function WorkflowPanel({ conversationId }: {conversationId:string}) {
  const [jobs,setJobs] = useState<Workflow[]>([]);
  const [job,setJob] = useState<Workflow|null>(null);
  const [goal,setGoal] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [note,setNote] = useState('');
  const [baseId,setBaseId]=useState<string|undefined>();
  const [calls,setCalls] = useState(16);
  const [knowledgeMode,setKnowledgeMode]=useState('none');
  const [tests,setTests] = useState<unknown>();
  const [testsName,setTestsName] = useState('');
  useEffect(() => {
    let stale=false; setJob(null); setBaseId(undefined); setGoal(''); setJobs([]); setError(''); setTests(undefined); setTestsName('');
    listWorkflows(conversationId).then(items => { if(!stale) {setJobs(items); if(items[0]) void getWorkflow(items[0].id).then(j=>{if(!stale)setJob(j);});} }).catch(e=>{if(!stale)setError(e.message);});
    return ()=>{stale=true;};
  },[conversationId]);
  useEffect(() => {
    if(!job || !['planning','running'].includes(job.status)) return;
    let stale=false;
    const timer=setInterval(()=>{void getWorkflow(job.id).then(j=>{if(!stale)setJob(j);}).catch(e=>{if(!stale)setError(e.message);});},1200);
    return ()=>{stale=true;clearInterval(timer);};
  },[job?.id,job?.status]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Falha na execução.');}finally{setBusy(false);}};
  const start=async(id:string)=>{await runWorkflow(id); const fresh=await getWorkflow(id); setJob({...fresh,status:fresh.steps.length?'running':'planning'});};
  const create=()=>action(async()=>{const j=await createWorkflow(conversationId,goal,{maxCalls:calls},baseId,tests,knowledgeMode);setJob(j);setJobs(await listWorkflows(conversationId));if(j.status==='draft')await start(j.id);});
  const review=(accepted:boolean,stepId?:number)=>action(async()=>{
    if(!job)return;
    await reviewWorkflow(job.id,{accepted,note,stepId,artifactHash:stepId===undefined?job.acceptanceHash:job.steps[stepId].artifactHash});
    setNote('');setJob(await getWorkflow(job.id));
  });
  const running=!!job&&['planning','running'].includes(job.status);
  return <details className="workflow-panel">
    <summary>Execução por etapas · economia e validação</summary>
    <p>Use para entregas com várias etapas. O progresso fica salvo. O professor não é chamado automaticamente.</p>
    {baseId&&<p>Ampliando a entrega aprovada. Descreva somente as mudanças. <button onClick={()=>setBaseId(undefined)}>Usar objetivo independente</button></p>}
    <label>Objetivo<textarea value={goal} onChange={e=>setGoal(e.target.value)} placeholder="Descreva a entrega, os dados disponíveis e como saber se ficou correta." rows={3}/></label>
    <label>Conhecimento para esta execução<select value={knowledgeMode} disabled={busy||running} onChange={e=>setKnowledgeMode(e.target.value)}><option value="none">Contexto mínimo · padrão econômico</option><option value="memory">Incluir memórias relevantes</option><option value="skills">Incluir memórias e skills ativadas</option></select></label>
    <small>Os ensaios ainda não comprovaram ganho geral ao acrescentar conhecimento. Testes, reparos determinísticos e reutilização de entregas continuam disponíveis no contexto mínimo.</small>
    <details><summary>Testes de aceitação · opcional</summary>
      <p>Importe cenários já preparados para conferir a entrega automaticamente. Sem um contrato fornecido, os testes sugeridos pela IA precisam de revisão.</p>
      <label>Importar testes (.json)<input type="file" accept=".json,application/json" disabled={busy||running} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void action(async()=>{setTests(undefined);setTestsName('');if(file.size>120000)throw new Error('Arquivo de testes excede 120 KB.');const value=JSON.parse(await file.text());if(!Array.isArray(value))throw new Error('Use uma lista de contratos por etapa.');setTests(value);setTestsName(file.name);});}}/></label>
      {testsName&&<p>{testsName} <button onClick={()=>{setTests(undefined);setTestsName('');}}>Remover</button></p>}
    </details>
    <div className="workflow-actions"><label>Máximo de chamadas locais <input type="number" min={1} max={50} value={calls} onChange={e=>setCalls(Number(e.target.value))}/></label>
    <button disabled={busy||running||!goal.trim()} onClick={create}>Preparar ou recuperar plano</button></div>
    {jobs.length>0&&<label>Execuções salvas<select value={job?.id||''} onChange={e=>void action(async()=>setJob(await getWorkflow(e.target.value)))}><option value="" disabled>Selecione</option>{jobs.map(j=><option key={j.id} value={j.id}>{j.goal.slice(0,70)}</option>)}</select></label>}
    {error&&<p role="alert" className="memory-form-error">{error}</p>}
    {job&&<section aria-label="Plano de execução">
      <h3>{labels[job.status]||job.status}</h3>
      <p>{job.goal}</p>
      <p className="workflow-stats">{job.stats.localCalls}/{job.budget.maxCalls} chamadas locais · {job.stats.teacherCalls} ao professor · {job.stats.inputTokens+job.stats.outputTokens} tokens locais medidos · {job.stats.estimatedTokens} estimados · {job.stats.reuses} reutilizações</p>
      <small>Limite cumulativo: {job.budget.maxTokens} tokens contabilizados, {Math.round(job.budget.maxDurationMs/60000)} min de execução. Estimativas reservam contexto e saída; não representam economia financeira.</small>
      {job.teacherNotes&&<details><summary>Orientação do professor</summary><p>{job.teacherNotes}</p></details>}
      {job.teacherError&&<p role="alert">{job.teacherError}</p>}
      {job.error&&<p role="alert">{job.error}</p>}
      <ol className="workflow-steps">{job.steps.map(step=><li key={step.id}>
        <strong>{step.title}</strong> <span>{labels[step.status]||step.status}</span>
        <p>{step.acceptance}</p>
        {step.validation&&<small>{step.validation.limitation}</small>}
        {step.validation?.functional&&<p>{step.validation.functional.passedCases.length}/{step.validation.functional.totalCases} cenários passaram{step.testsSource==='planner'?' · cobertura a revisar':''}.</p>}
        {step.evidence.length>0&&<details><summary>Resultados das verificações</summary><ul>{step.evidence.map((e,i)=><li key={i}>{e}</li>)}</ul></details>}
        {step.artifact&&<details><summary>Ver artefato e evidências</summary><pre>{step.artifact}</pre>{step.format==='html'&&<iframe title={'Artefato: '+step.title} sandbox="allow-scripts" srcDoc={previewPolicy+step.artifact}/>}</details>}
        {['awaiting_review','failed'].includes(step.status)&&step.artifact&&<button disabled={busy||running} onClick={()=>void action(async()=>{await recheckWorkflow(job.id,step.id);setJob(await getWorkflow(job.id));})}>Refazer verificações sem usar IA</button>}
        {step.status==='awaiting_review'&&<div className="workflow-actions"><button disabled={busy} onClick={()=>void review(true,step.id)}>Conferi: aprovar etapa</button><button disabled={busy||!note.trim()} onClick={()=>void review(false,step.id)}>Solicitar correção</button></div>}
      </li>)}</ol>
      {(job.status==='awaiting_review'||job.status==='awaiting_acceptance')&&<label>Observação da revisão<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Registre o que conferiu ou o problema encontrado."/></label>}
      <div className="workflow-actions">
        {running?<button onClick={()=>void action(async()=>{await cancelWorkflow(job.id);setJob(await getWorkflow(job.id));})}>Interromper</button>:!['completed','awaiting_review','awaiting_acceptance','budget_exhausted'].includes(job.status)&&<button disabled={busy} onClick={()=>void action(()=>start(job.id))}>{job.steps.length?'Executar / continuar etapas':'Preparar plano local'}</button>}
        {job.status==='awaiting_acceptance'&&<><button disabled={busy} onClick={()=>void review(true)}>Conferi a entrega: concluir e salvar no chat</button><button disabled={busy||!note.trim()} onClick={()=>void review(false)}>Devolver para correção</button></>}
      </div>
      {!running&&job.status!=='completed'&&job.stats.teacherCalls===0&&<button disabled={busy} onClick={()=>void action(async()=>{await teachWorkflow(job.id);setJob(await getWorkflow(job.id));})}>Preparar conhecimento / pedir ajuda ao professor (1 chamada)</button>}
      {job.status==='completed'&&<button onClick={()=>{setBaseId(job.id);setGoal('');}}>Ampliar esta entrega</button>}
      {job.status==='completed'&&<p>Entrega aprovada e salva no chat. Repetir este objetivo compatível recupera esta execução sem gerar novamente.</p>}
    </section>}
  </details>;
}
