import { useEffect, useRef, useState } from 'react';
import { getProviders, openExternalUrl, updateSettings, type ProviderInfo } from './api';
import './welcome.css';

const steps = ['Boas-vindas', 'Como usar', 'Conectar uma IA', 'Memórias'];
const docs = {
  codex: 'https://developers.openai.com/codex/cli',
  claude: 'https://code.claude.com/docs/en/setup',
};

function Command({ text }: { text: string }) {
  const [notice, setNotice] = useState('');
  return <div className="guide-command"><code>{text}</code><button onClick={async () => {
    try { await navigator.clipboard.writeText(text); setNotice('Copiado'); }
    catch { setNotice('Selecione o comando e copie manualmente.'); }
  }} aria-label={`Copiar ${text}`}>Copiar</button><span role="status">{notice}</span></div>;
}

export default function WelcomeGuide({ onClose }: { onClose: (openSettings?: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<'local' | 'codex' | 'claude'>('local');
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => { content.current?.scrollTo(0, 0); title.current?.focus(); }, [step]);
  async function finish(settings = false) {
    if (saving) return;
    setSaving(true); setError('');
    try { await updateSettings({ onboardingCompleted: true }); onClose(settings); }
    catch { setError('Não foi possível salvar o guia como visto. Tente novamente.'); setSaving(false); }
  }
  async function check() {
    setChecking(true); setError('');
    try { setProviders(await getProviders()); }
    catch { setError('Não foi possível verificar os programas. Tente novamente.'); }
    finally { setChecking(false); }
  }
  const detected = providers?.find(p => p.id === provider)?.configured;
  return <dialog ref={dialog} className="welcome-guide" aria-labelledby="guide-title" onCancel={e => { e.preventDefault(); void finish(); }}>
    <header className="guide-header"><img src="/brand/aurora-wordmark.png" alt="Aurora" /><button disabled={saving} onClick={() => void finish()} aria-label="Fechar guia">✕</button></header>
    <nav className="guide-steps" aria-label="Etapas do guia">{steps.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{" "}{label}</button>)}</nav>
    <div className="guide-content" ref={content}>
      <p className="guide-eyebrow">SEU PRIMEIRO PASSO COM A AURORA · {step + 1} DE 4</p>
      <h1 id="guide-title" ref={title} tabIndex={-1}>{['Uma ideia. Um lugar para criar.', 'Peça, acompanhe e refine.', 'Escolha quem vai responder.', 'Conhecimento que você pode reutilizar.'][step]}</h1>
      {step === 0 && <>
        <p className="guide-lead">Bem-vindo à Aurora. Converse com uma IA para criar jogos, páginas, aplicativos e analisar ideias, mantendo seus projetos organizados.</p>
        <div className="guide-cards"><article><h2>Você pede</h2><p>Descreva o resultado, os dados e o que precisa funcionar.</p></article><article><h2>A IA trabalha</h2><p>A Aurora reúne o contexto disponível e encaminha seu pedido ao modelo escolhido.</p></article><article><h2>Você evolui</h2><p>Veja os arquivos, confira o resultado e peça ajustes na mesma conversa.</p></article></div>
        <p>Este guia é parte do aplicativo: não usa IA nem gasta tokens. Você pode revê-lo em <strong>Configurações → Primeiros passos</strong>.</p>
      </>}
      {step === 1 && <>
        <ol className="guide-instructions"><li><strong>Escolha Local, Codex ou Claude</strong> no seletor Modelo e clique em <strong>Nova conversa</strong>. A escolha vale para a nova conversa.</li><li><strong>Explique seu objetivo.</strong> Diga o formato, as regras e como conferir que deu certo.</li><li><strong>Abra Arquivos</strong> no chat para consultar os arquivos gerados no painel lateral. Quando houver uma prévia compatível, você poderá visualizá-la.</li><li><strong>Teste e peça uma correção.</strong> Conte o que aconteceu e o comportamento esperado. Um resultado gerado ainda precisa ser conferido.</li></ol>
        <div className="guide-example"><span>Experimente pedir</span><p>“Crie um jogo da memória em HTML, com contador de jogadas e botão de reiniciar. Explique como testar cada função.”</p></div>
        <p>Use <strong>Projetos</strong> para reunir conversas e instruções do mesmo trabalho. No modo Local, <strong>Revisar com Codex/Claude</strong> solicita uma correção ao professor escolhido e pode consumir sua cota desse serviço.</p>
      </>}
      {step === 2 && <>
        <div className="guide-providers" role="group" aria-label="Guia de conexão">{(['local', 'codex', 'claude'] as const).map(id => <button key={id} aria-pressed={provider === id} onClick={() => setProvider(id)}>{id === 'local' ? 'Local' : id === 'codex' ? 'Codex' : 'Claude'}</button>)}</div>
        {provider === 'local' ? <>
          <h2>No seu computador</h2><p>Selecione <strong>Local</strong> e abra uma nova conversa. Siga o painel de preparação do Ollama e do modelo. O primeiro preparo pode baixar arquivos grandes e precisa de internet.</p><p>Depois de preparado, o modelo local pode responder sem conexão. A velocidade depende da memória e do processador/GPU disponíveis. Em Configurações, mantenha a seleção automática para usar o modelo local estável.</p>
        </> : <>
          <h2>{provider === 'codex' ? 'Conectar Codex CLI' : 'Conectar Claude Code'}</h2>
          <p>A Aurora usa o programa de terminal do provedor. Faça a instalação e o login no <strong>mesmo usuário do Windows</strong> que abre a Aurora. Uma sessão apenas no navegador ou no WSL não garante acesso pelo aplicativo.</p>
          <ol className="guide-instructions">
            <li><strong>Instale o programa.</strong> Abra as instruções oficiais e escolha Windows. <a href={docs[provider]} onClick={e => { e.preventDefault(); openExternalUrl(docs[provider]); }}>Abrir instalação oficial ↗</a>{provider === 'claude' && <><p>No PowerShell, uma opção é:</p><Command text="winget install Anthropic.ClaudeCode" /></>}</li>
            <li><strong>Entre na sua conta.</strong> Abra um novo PowerShell pelo menu Iniciar e execute:<Command key={provider} text={provider === 'codex' ? 'codex login' : 'claude'} /><p>Conclua o login seguindo as instruções do terminal e do navegador. Use uma conta com acesso ao serviço; limites e cobrança dependem do provedor. Não cole senhas ou tokens no chat da Aurora.</p></li>
            <li><strong>Reabra a Aurora.</strong> No ícone da Aurora perto do relógio do Windows, escolha <strong>Sair</strong> e abra novamente. O botão X apenas oculta a janela. Depois, use a verificação abaixo.</li>
            <li><strong>Escolha {provider === 'codex' ? 'Codex' : 'Claude'}</strong> no seletor Modelo e crie uma nova conversa. Envie uma mensagem curta para confirmar que o login funciona; essa mensagem usa o serviço escolhido.</li>
          </ol>
          <button disabled={checking} onClick={() => void check()}>{checking ? 'Verificando…' : 'Verificar detecção'}</button>
          {providers && <p role="status">{detected ? 'Programa encontrado. O login será confirmado ao enviar uma mensagem.' : 'Programa não encontrado pela Aurora. Confira a instalação e reinicie o aplicativo.'}</p>}
          <details><summary>O programa não foi encontrado ou o login falhou?</summary><p>Em um novo PowerShell, confira se este comando mostra uma versão:</p><Command key={`${provider}-version`} text={`${provider} --version`} /><p>Se o comando não existir, siga a instalação oficial e verifique o PATH do Windows. Se existir, reabra a Aurora. Para falhas de login, entre novamente no terminal e confira o acesso e os limites da conta.</p>{provider === 'codex' && <Command text="codex login status" />}</details>
        </>}
        <p className="guide-note">Ao usar Codex ou Claude, seu pedido e o contexto selecionado são enviados ao provedor. Este guia não altera seu modelo nem inicia um login automaticamente.</p>
      </>}
      {step === 3 && <>
        <div className="guide-cards"><article><h2>Central compartilhada</h2><p>Referências públicas revisadas. Ative o recebimento em Ferramentas → Memória. Sincroniza a cada 6 horas por padrão, com o app aberto.</p></article><article><h2>Memória do chat</h2><p>Contexto e decisões ligados a uma conversa. Informações específicas do trabalho têm preferência na consulta.</p></article><article><h2>Sua coleção pessoal</h2><p>Gerencie notas em Memória e explore conexões no Atlas. Consultar outros chats é uma opção separada.</p></article></div>
        <p>A Aurora seleciona referências relevantes para ajudar nas respostas. Isso reutiliza conhecimento, mas <strong>não treina automaticamente os pesos do modelo</strong> nem garante que uma resposta esteja correta.</p>
        <p>Compartilhar é opcional: você revisa e aprova uma cópia pública, e o mantenedor revisa a contribuição antes de distribuí-la. Conversas privadas não são publicadas automaticamente.</p>
        <button onClick={() => void finish(true)} disabled={saving}>Abrir configurações</button>
      </>}
      {error && <p role="alert" className="guide-error">{error}</p>}
    </div>
    <footer className="guide-footer"><button disabled={saving} onClick={() => void finish()}>Ver depois</button><div>{step > 0 && <button onClick={() => setStep(step - 1)}>Voltar</button>}{step < 3 ? <button className="guide-primary" onClick={() => setStep(step + 1)}>Continuar →</button> : <button className="guide-primary" disabled={saving} onClick={() => void finish()}>{saving ? 'Salvando…' : 'Começar a usar'}</button>}</div></footer>
  </dialog>;
}
