import { useEffect, useRef, useState } from 'react';
import { getProviders, openExternalUrl, updateSettings, type ProviderInfo } from './api';
import BrandMark from './BrandMark';
import FoldersPanel from './FoldersPanel';
import ProfilePanel from './ProfilePanel';
import Icon from './Icon';
import './welcome.css';

const steps = ['Boas-vindas', 'Sobre você', 'Suas pastas', 'Como pedir', 'IA na nuvem'];
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
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
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
    <header className="guide-header"><BrandMark /><button disabled={saving} onClick={() => void finish()} aria-label="Fechar guia"><Icon name="close" size={14} /></button></header>
    <nav className="guide-steps" aria-label="Etapas do guia">{steps.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{" "}{label}</button>)}</nav>
    <div className="guide-content" ref={content}>
      <p className="guide-eyebrow">SEU PRIMEIRO PASSO COM A AURORA · {step + 1} DE {steps.length}</p>
      <h1 id="guide-title" ref={title} tabIndex={-1}>{['Sua assistente, no seu computador.', 'Conte um pouco sobre você.', 'Quais pastas a Aurora pode usar?', 'Peça do seu jeito.', 'Quer usar também uma IA na nuvem?'][step]}</h1>
      {step === 0 && <>
        <p className="guide-lead">A Aurora é uma assistente que trabalha nos seus arquivos: organiza pastas, cria documentos e planilhas, resume o que você manda e pesquisa na internet. Ela roda aqui, no seu computador.</p>
        <div className="guide-cards"><article><h2>Você pede</h2><p>Do seu jeito, como pediria a uma pessoa: “organize meus Downloads”, “resuma esse PDF”.</p></article><article><h2>Ela faz</h2><p>Abre, cria e organiza os arquivos. Antes de algo delicado, como apagar ou instalar, ela pergunta.</p></article><article><h2>Você confere</h2><p>Os arquivos aparecem na conversa. Dá para pedir ajustes ou desfazer uma organização.</p></article></div>
        <p>Leva um minuto. Este guia não usa IA, e você pode revê-lo em <strong>Configurações → Geral</strong>.</p>
      </>}
      {step === 1 && <>
        <p className="guide-lead">A Aurora lê isto em todas as conversas. Seu nome, o que você faz e como prefere as respostas já ajudam muito. É opcional.</p>
        <ProfilePanel />
      </>}
      {step === 2 && <>
        <p className="guide-lead">Adicione as pastas onde ficam os seus arquivos e escolha, em cada uma, se ela só consulta ou também organiza. Tudo fica neste computador, e dá para mudar depois em Configurações → Pastas.</p>
        <FoldersPanel compact />
      </>}
      {step === 3 && <>
        <div className="guide-examples">
          {[['Organizar', 'Organize a minha pasta Downloads por tipo de arquivo, sem apagar nada.'], ['Resumir', 'Resuma esse contrato em tópicos e me diga as datas importantes.'], ['Criar', 'Crie uma planilha com os gastos deste mês a partir das notas na pasta Documentos.'], ['Encontrar', 'Onde está o meu contrato de aluguel?']].map(([title, text]) => <div className="guide-example" key={title}><span>{title}</span><p>“{text}”</p></div>)}
        </div>
        <p>Dica: para falar de um arquivo, digite <strong>&gt;</strong> e o nome dele. Em <strong>Agentes</strong>, você cria ajudantes que trabalham sozinhos num horário, como um resumo toda manhã.</p>
      </>}
      {step === 4 && <>
        <p className="guide-lead">Não é preciso: a Aurora já funciona com a IA deste computador. Depois de preparada, ela responde sem internet e sem mandar nada para fora. Se você já tem Codex ou Claude, dá para usá-los também.</p>
        <div className="guide-providers" role="group" aria-label="Guia de conexão">{(['codex', 'claude'] as const).map(id => <button key={id} aria-pressed={provider === id} onClick={() => setProvider(id)}>{id === 'codex' ? 'Codex' : 'Claude'}</button>)}</div>
        <>
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
        </>
        <p className="guide-note">Ao usar Codex ou Claude, seu pedido e o contexto selecionado são enviados ao provedor. Este guia não altera seu modelo nem inicia um login automaticamente.</p>
      </>}
      {error && <p role="alert" className="guide-error">{error}</p>}
    </div>
    <footer className="guide-footer"><button disabled={saving} onClick={() => void finish()}>Ver depois</button><div>{step > 0 && <button onClick={() => setStep(step - 1)}>Voltar</button>}{step < steps.length - 1 ? <button className="guide-primary" onClick={() => setStep(step + 1)}>Continuar →</button> : <button className="guide-primary" disabled={saving} onClick={() => void finish()}>{saving ? 'Salvando…' : 'Começar a usar'}</button>}</div></footer>
  </dialog>;
}
