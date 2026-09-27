import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:8787/api';
const {token}=await (await fetch(base+'/session')).json();
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'x-harness-token':token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(value.error);return value;}
const title='Aurora Presence';
const {projects}=await call('/projects');
let project=projects.find(p=>p.name===title);
if(!project)project=await call('/projects',{name:title,instructions:'Projeto aprovado: levar o Harness Aurora ao Quest como presença de IA em realidade mista. Conversa por voz, projetos e memórias reais, painel contextual, mãos, ancoragem e leitura explícita do ambiente. Dados e provedores permanecem no PC. Não afirmar execução de ações ou percepção visual sem evidência. Diferenciar capacidades implementadas, testadas e pendentes.'});
const {memories}=await call('/memories?projectId='+project.id);
if(!memories.some(m=>m.title==='Conceito aprovado — Aurora Presence'))await call('/memories',{scope:'project',projectId:project.id,title:'Conceito aprovado — Aurora Presence',content:readFileSync('unreal/AuroraXR/Docs/CONCEITO-AURORA-PRESENCE.md','utf8'),kind:'manual',source:'Conceito aprovado explicitamente por Lucas em 26/09/2026',tags:['aurora','quest','mixed-reality','conceito-aprovado']});
if(!memories.some(m=>m.title==='Implementação validada — Aurora Presence 0.2.0'))await call('/memories',{
  scope:'project',projectId:project.id,title:'Implementação validada — Aurora Presence 0.2.0',kind:'manual',
  source:'Implementação e testes locais no PC e Quest 3S em 26/09/2026',tags:['aurora','quest','estado-atual','seis-objetivos'],
  content:'O trabalho foi organizado em seis objetivos: 1 conectar Quest/Harness; 2 conversas reais; 3 voz e presença; 4 painel e mãos; 5 projetos, memórias e persistência espacial; 6 visão e validação. A versão 0.2.0 foi compilada e instalada. Foram validados TLS no Quest, mensagem do Quest visível no desktop, gravação de memória com mesmo ID/conteúdo no PC, câmera com OCR local, captura do microfone encaminhada à transcrição e âncora salva/localizada após reiniciar. Amostra inicial: cerca de 72 FPS de jogo, GPU não medida. Voz local usa Whisper base e Microsoft Maria; respostas usam o provedor da conversa no Harness. Há um painel/cartão reposicionável com núcleo luminoso. Permanecem pendentes conversa humana completa, conforto e precisão de mãos, anotação física controlada e ensaio prolongado de falhas. Não há detecção automática de mesas/paredes, coleção de cartões independentes, reconhecimento geral de objetos nem IA inteiramente no headset. Detalhes: Docs/TODO-PRESENCE.md, Docs/VALIDATION-PRESENCE.md e Docs/PRESENCE-USO.md no projeto Unreal.'
});
writeFileSync('unreal/AuroraXR/Saved/PresenceProject.json',JSON.stringify({projectId:project.id,name:project.name},null,2));
console.log('Projeto Aurora Presence e conceito aprovado disponíveis no Harness.');
