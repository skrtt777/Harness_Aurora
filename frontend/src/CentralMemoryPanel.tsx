import {useEffect,useRef,useState,type MouseEvent} from 'react';
import {openExternalUrl,getCentralStatus,setCentralConfig,syncCentralMemory,getCentralMemories,checkCentralGitHub,previewCentralContribution,approveCentralContribution,cancelCentralContribution,type CentralStatus,type CentralConfig,type PublicMemory,type MemoryEntry} from './api';

const date=(value?:string)=>value?new Date(value).toLocaleString('pt-BR'):'Ainda não realizada';
const external=(event:MouseEvent<HTMLAnchorElement>)=>{event.preventDefault();openExternalUrl(event.currentTarget.href);};
const labels:Record<string,string>={queued:'Aguardando sincronização',sending:'Enviando',sent:'Enviada para revisão no GitHub',uncertain:'Envio sem confirmação — conferir no GitHub',cancelled:'Envio cancelado'};
export default function CentralMemoryPanel({draft,onCloseDraft}:{draft:MemoryEntry|null;onCloseDraft:()=>void}) {
  const [status,setStatus]=useState<CentralStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const [hours,setHours]=useState('6'),[login,setLogin]=useState(''),[query,setQuery]=useState('');
  const [memories,setMemories]=useState<(PublicMemory&{id:string;source:string})[]>([]);
  const [title,setTitle]=useState(''),[content,setContent]=useState(''),[tags,setTags]=useState(''),[consent,setConsent]=useState(false);
  const [preview,setPreview]=useState<{id:string;memory:PublicMemory}|null>(null);
  const panel=useRef<HTMLDetailsElement>(null);
  const load=async()=>{const next=await getCentralStatus();setStatus(next);setHours(String(next.config.intervalHours));};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{void getCentralMemories(query).then(rows=>{if(active)setMemories(rows);}).catch(e=>{if(active)setError(e.message);});},200);return()=>{active=false;clearTimeout(timer);};},[query,status?.state.downloadedAt]);
  useEffect(()=>{if(draft){setTitle(draft.title);setContent(draft.content);setTags(draft.tags.join(', '));setPreview(null);setConsent(false);setOpen(true);panel.current?.scrollIntoView({behavior:'smooth',block:'start'});}},[draft]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Falha na memória central.');}finally{setBusy(false);}};
  const patch=(value:Partial<CentralConfig>)=>{
    const previous=status;
    setStatus(current=>current?{...current,config:{...current.config,...value}}:current);
    return action(async()=>{try{setStatus(await setCentralConfig(value));}catch(e){setStatus(previous);throw e;}});
  };
  const invalidate=()=>{setPreview(null);setConsent(false);};
  return <div className="central-memory">
    <div className="memory-levels" aria-label="Níveis de memória">
      <article><b>01 · Central compartilhada</b><span>{status?.count??0} referências revisadas da comunidade</span></article>
      <article><b>02 · Memória do chat</b><span>Contexto e decisões de cada conversa</span></article>
      <article><b>03 · Memória pessoal</b><span>Todos os seus chats, reunidos nesta máquina</span></article>
    </div>
    <details ref={panel} open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
      <summary>Memória central · sincronização e contribuições</summary>
      <p>Conhecimento público revisado no GitHub. O contexto específico do chat tem preferência. Sincroniza enquanto o aplicativo estiver aberto, sem chamadas à IA.</p>
      {error&&<p role="alert">{error}</p>}
      {status&&<>
        <div className="central-options">
          <label><input type="checkbox" checked={status.config.downloadEnabled} disabled={busy} onChange={e=>void patch({downloadEnabled:e.target.checked})}/>Receber e consultar memórias da central</label>
          <label><input type="checkbox" checked={status.config.shareEnabled} disabled={busy} onChange={e=>void patch({shareEnabled:e.target.checked})}/>Enviar somente as cópias que eu revisar e aprovar para publicação</label>
          <label><input type="checkbox" checked={status.config.crossChatEnabled} disabled={busy} onChange={e=>void patch({crossChatEnabled:e.target.checked})}/>Consultar também minhas memórias de outros chats e projetos (sem compartilhar com a central)</label>
        </div>
        <div className="central-actions"><label>Intervalo (horas)<input aria-label="Intervalo de sincronização em horas" type="number" min="1" max="168" value={hours} onChange={e=>setHours(e.target.value)}/></label><button disabled={busy||!Number.isInteger(Number(hours))||Number(hours)<1||Number(hours)>168} onClick={()=>void patch({intervalHours:Number(hours)})}>Salvar intervalo</button><button disabled={busy||(!status.config.downloadEnabled&&!status.config.shareEnabled)} onClick={()=>void action(async()=>{setStatus(await syncCentralMemory());})}>{busy?'Aguarde…':'Sincronizar agora'}</button><button disabled={busy} onClick={()=>void action(load)}>Atualizar status</button></div>
        <small>Última sincronização: {date(status.state.lastSuccessAt)} · Próxima: {status.config.downloadEnabled||status.config.shareEnabled?(status.state.nextAt?date(status.state.nextAt):'ao verificar o agendamento'):'desativada'}. Se estiver fechado, retoma na próxima abertura.</small>
        {status.state.error&&<p role="alert">{status.state.error} Nova tentativa em aproximadamente 15 minutos.</p>}
        <p>Para enviar contribuições, instale <a href="https://cli.github.com/" onClick={external}>GitHub CLI</a> e autentique sua própria conta com <code>gh auth login</code>. Não precisa de conta para baixar. Nenhuma credencial do mantenedor acompanha o app.</p>
        <button disabled={busy} onClick={()=>void action(async()=>{setLogin((await checkCentralGitHub()).login);})}>Verificar minha conta GitHub</button>{login&&<small>Conta conectada: {login}</small>}
        <p>As contribuições são públicas, ligadas à sua conta GitHub e aguardam revisão. Desativar o envio cancela a fila pendente; não apaga publicações anteriores. Para retirar uma referência publicada, solicite a remoção na issue; a retirada da central será recebida na próxima sincronização.</p>
        {draft&&<section className="central-draft" aria-label="Revisar contribuição pública"><h3>Revisar uma cópia pública</h3><p>Remova nomes, dados de clientes, senhas e detalhes privados. Só o título, o texto e as tags abaixo serão enviados. A detecção automática é parcial.</p>
          <label>Título público<input value={title} maxLength={160} onChange={e=>{setTitle(e.target.value);invalidate();}}/></label>
          <label>Conteúdo público<textarea value={content} maxLength={8000} rows={6} onChange={e=>{setContent(e.target.value);invalidate();}}/></label>
          <label>Tags públicas<input value={tags} onChange={e=>{setTags(e.target.value);invalidate();}}/></label>
          <button disabled={busy} onClick={()=>void action(async()=>{setPreview(await previewCentralContribution({title,content,tags:tags.split(',').map(t=>t.trim()).filter(Boolean)}));setConsent(false);})}>Conferir prévia</button>
          {preview&&<><pre>{JSON.stringify(preview.memory,null,2)}</pre><label className="central-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Revisei esta cópia, tenho autorização para compartilhá-la e autorizo sua publicação pública no GitHub.</label><button disabled={busy||!consent||!status.config.shareEnabled} onClick={()=>void action(async()=>{setStatus(await approveCentralContribution(preview.memory,preview.id,consent));setPreview(null);onCloseDraft();})}>Aprovar e colocar na fila</button>{!status.config.shareEnabled&&<p>Ative o envio de cópias revisadas acima para aprovar esta contribuição.</p>}</>}
          <button disabled={busy} onClick={onCloseDraft}>Fechar revisão</button>
        </section>}
        <h3>Contribuições desta instalação</h3>
        {!status.contributions.length&&<p>Nenhuma contribuição aprovada. Use “Compartilhar cópia” em uma memória pessoal para revisar o conteúdo primeiro.</p>}
        {status.contributions.map(c=><article className="central-contribution" key={c.id}><strong>{c.memory.title}</strong><span>{labels[c.status]||c.status}</span>{c.issueUrl&&<a href={c.issueUrl} onClick={external}>Ver revisão no GitHub</a>}{c.error&&<small>{c.error}</small>}{['queued','uncertain'].includes(c.status)&&<button disabled={busy} onClick={()=>void action(async()=>{setStatus(await cancelCentralContribution(c.id));})}>Cancelar envio pendente</button>}</article>)}
        <h3>Referências centrais disponíveis</h3><label>Pesquisar na central<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Título, conteúdo ou assunto"/></label>
        <small>Até 100 resultados por busca. Cache local; desligar a consulta impede seu uso nas respostas.</small>
        {!memories.length&&<p>Nenhuma referência no cache para esta busca.</p>}
        <div className="central-library">{memories.map(m=><details key={m.id}><summary>{m.title}</summary><p>{m.content}</p><a href={m.source} onClick={external}>Procedência</a></details>)}</div>
      </>}
    </details>
  </div>;
}
