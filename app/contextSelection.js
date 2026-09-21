// Deterministic routing: no extra model call, and no fixed quota of references.
export const CONTEXT_SELECTION_VERSION = 'selective-v1.1';
// Not promoted to the default: the first A/B did not pass the quality gate.
export const selectiveContext = (env=process.env) => (env.HARNESS_CONTEXT_POLICY ?? process.env.HARNESS_CONTEXT_POLICY) === 'selective-v1';
export const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stop = new Set('a o as os e de da do das dos em no na nos nas um uma uns umas para por com como que se ao aos pelo pela pelo essa esse esta este isso sua seu suas seus quero preciso favor me fale sobre the and for with from this that into create make criar crie fazer faca use usar utilizando somente apenas deve devem sempre todos todas cada qualquer tambem inicialmente texto numero valores valor'.split(' '));
const presentation = new Set('html css javascript inline arquivo completo unico entregue entrega codigo fonte fontes imagens bibliotecas externos externo servicos portugues interface limpa responsiva responsivo pixels rolagem horizontal title main lang meta viewport input inputs label associado labels botoes botao nativos nativo nome ids id obrigatorios explique'.split(' '));
export function positiveQuery(input) {
  // Remove only explicit exclusions from the retrieval query, never from the task.
  return normalize(input).replace(/\b(?:sem|nao|nunca|evite|without|avoid|do not)\b[^.!?;\n]*(?=[.!?;\n]|$)/g, ' ')
    .replace(/\b(?:entregue somente um arquivo|interface em portugues|use title|todos os ids e comportamentos)[^.!?\n]*(?=[.!?\n]|$)/g,' ');
}
export function queryTerms(input) {
  return [...new Set(positiveQuery(input).match(/[a-z0-9][a-z0-9-]{1,}/g) || [])].filter(w => !stop.has(w) && !['ou','ate','mais','menos','apos','entre','ser','ainda','antes','depois','inicial','final'].includes(w) && !presentation.has(w) && !/^\d+$/.test(w));
}
const domains = {
  game: /\b(jogos?|games?|quiz|snake|godot|unity|pygame|characterbody2d|colisao|aabb|pontuacao|partidas?|plataforma 2d)\b/,
  bi: /\b(bi|dashboard|dashboards|indicadores|faturamento|receita|margem|vendas|powerbi|analise financeira)\b/,
  web: /\b(landing|pagina|paginas|website|site|catalogo|formulario|portfolio)\b/,
  app: /\b(app|aplicativo|aplicacao|crud|lista de tarefas|localstorage)\b/,
};
const capabilities = {
  audio: /\b(audio|som|musica|audiocontext|volume|mute)\b/,
  motion: /\b(fps|delta|movimento|mover|move_and_slide|characterbody2d|velocidade|animacao|requestanimationframe|loop)\b/,
  planning: /\b(planej\w*|decompor|etapas|dependencias|projeto complexo)\b/,
  reset: /\b(reinici\w*|reset|rodadas?|partidas?|eventos duplicados)\b/,
  physics: /\b(colis\w*|aabb|fisica|gravidade|chao|paredes?)\b/,
  storage: /\b(localstorage|persist\w*|salvar|salvamento|save)\b/,
};
export function taskProfile(input) {
  const query=positiveQuery(input);
  return {query,terms:queryTerms(input),domains:Object.keys(domains).filter(k=>domains[k].test(query)),capabilities:Object.keys(capabilities).filter(k=>capabilities[k].test(query))};
}
export function referenceCompatibility(profile, memory) {
  const title=normalize(memory.title),tags=normalize((memory.tags||[]).join(' '));
  const subject=title+' '+tags;
  const game=domains.game.test(subject)||/biblioteca-jogos/.test(tags);
  const transverse=/\b(teste|testes|entrega|reutilizar|acessibilidade|persistencia|localstorage|validacao|diagnostico|orcamento)\b/.test(title);
  const sharedCapability=profile.capabilities.some(c=>capabilities[c].test(title));
  if(game && !profile.domains.includes('game') && (!transverse&&!sharedCapability||domains.game.test(title)))return {compatible:false,reason:'domain_mismatch'};
  for(const genre of ['pong','snake','breakout','puzzle'])if(title.includes(genre)&&!profile.query.includes(genre))return {compatible:false,reason:'unrequested_genre'};
  for(const [cap,pattern] of Object.entries(capabilities))if(pattern.test(title)&&!profile.capabilities.includes(cap))return {compatible:false,reason:'unrequested_capability:'+cap};
  for(const technology of ['godot','unity','pygame','three.js'])if(subject.includes(technology)&&!profile.query.includes(technology))return {compatible:false,reason:'technology_mismatch'};
  return {compatible:true,reason:game&&!profile.domains.includes('game')&&!sharedCapability?'cross_domain':'compatible'};
}
export function skillRelevance(skill, input) {
  const p=taskProfile(input),special={ 'browser-game':'game','bi-analysis':'bi' };
  if(special[skill.name])return p.domains.includes(special[skill.name])?10:0;
  if(skill.name==='task-decomposition')return /\b(planej\w*|decompor|complex\w*|etapas|dependencias|integracao)\b/.test(p.query)?5:0;
  const names=new Set(queryTerms(skill.name)),description=new Set(queryTerms(skill.description));
  return p.terms.reduce((score,w)=>score+(names.has(w)?3:description.has(w)?1:0),0);
}
