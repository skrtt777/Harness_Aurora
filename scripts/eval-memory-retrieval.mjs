// Labeled retrieval check against a copy of a real Harness database.
// For each query: the memory titles that must be retrieved (or none), and what else came along.
// Usage: HARNESS_DB_FILE=<copy> node scripts/eval-memory-retrieval.mjs [--verbose]
// Embeddings: Ollama (desktop default) or EMBEDDING_BASE_URL + LOCAL_ENGINE=llama.cpp.
const {selectRelevantMemories}=await import('../app/store.js');
export const CASES=[
  {q:'que horas são?',expect:[]},
  {q:'Qual é a data de hoje?',expect:[]},
  {q:'Me conte uma piada curta.',expect:[]},
  {q:'Me dê duas dicas para dormir melhor.',expect:[]},
  {q:'Quanto é 17 × 23?',expect:[]},
  {q:'No Godot, como devo mover um personagem controlado por código?',expect:['Godot: CharacterBody e movimento controlado']},
  {q:'Como faço o áudio de um jogo no navegador tocar sem ser bloqueado?',expect:['Áudio iniciado por interação e controle de volume']},
  {q:'Meu canvas fica borrado em telas de alta resolução, o que faço?',expect:['Canvas nítido com devicePixelRatio']},
  {q:'Como salvar o progresso do jogo no navegador com segurança?',expect:['Salvar progresso sem depender do armazenamento']},
  {q:'Criar e destruir muitos projéteis está deixando o jogo lento.',expect:['Reutilização de projéteis e partículas com pool']},
  {q:'Como evito trapaça num jogo multiplayer competitivo?',expect:['Multiplayer: autoridade, validação e desconexão']},
  {q:'Como mostrar o texto digitado pelo usuário sem interpretar HTML?',expect:['Texto literal seguro']},
  {q:'O valor salvo some quando recarrego a página.',expect:['Persistência após reload']},
  {q:'Como as cenas do Godot devem se comunicar sem acoplamento?',expect:['Godot: sinais para comunicação entre cenas']},
];
const verbose=process.argv.includes('--verbose');
let found=0,expected=0,noise=0,quiet=0,none=0,chars=0;
for(const {q,expect} of CASES){
  const got=await selectRelevantMemories(q,{},12,process.env);
  const titles=got.map(m=>m.title);
  const hits=expect.filter(t=>titles.includes(t));
  found+=hits.length;expected+=expect.length;
  const extra=titles.filter(t=>!expect.includes(t));noise+=extra.length;
  if(!expect.length){none++;if(!got.length)quiet++;}
  chars+=got.reduce((n,m)=>n+m.title.length+m.content.length,0);
  const rank=expect.map(t=>titles.indexOf(t)+1||'-').join(',');
  console.log(`${expect.length?(hits.length===expect.length?'OK ':'FALTA'):(got.length?'RUÍDO':'OK ')} | ${got.length} mem | pos ${rank||'-'} | ${q}`);
  if(verbose)for(const m of got)console.log(`      ${m.retrieval.score.toFixed(2)} sim=${m.retrieval.similarity?.toFixed(3)??'-'} ${expect.includes(m.title)?'*':' '} ${m.title}`);
}
console.log(`\nRecuperação: ${found}/${expected} esperadas | consultas sem memória relevante vazias: ${quiet}/${none} | memórias extras: ${noise} | ~${Math.round(chars/3/CASES.length)} tokens de memória por consulta`);
