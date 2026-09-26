// Frozen final evaluation set for LoRA v3 — written and frozen BEFORE
// running any training or evaluation, same discipline as engine-tasks.mjs.
// Never tune from these outputs. Distinct task instances from both
// engine-tasks.mjs (already used this session for KERNEL/distillation
// benchmarking — "already observed", not a valid blind test per this
// project's own standing rule) and curriculum-v3.mjs's training families
// (different specific mechanics, even where the underlying skill overlaps
// on purpose — that's what training should generalize, not memorize).
const html=(body,js)=>`<!doctype html><html><head><meta charset="utf-8"><title>Avaliação v3</title></head><body>${body}<script>${js}</script></body></html>`;
const click=selector=>({op:'click',selector}),fill=(selector,value)=>({op:'fill',selector,value}),select=(selector,value)=>({op:'select',selector,value});
const num=(selector,expected)=>({op:'assertNumber',selector,expected,locale:'en-US',tolerance:0.01}),count=(selector,expected)=>({op:'assertCount',selector,expected});
const visible=(selector,expected)=>({op:'assertVisible',selector,expected}),text=(selector,expected)=>({op:'assertText',selector,expected});
const contract=(...cases)=>({version:1,cases:cases.map((actions,i)=>({id:'c'+i,name:'Requisito '+(i+1),actions}))});
const task=(id,domain,goal,body,js,tests)=>({id,domain,goal:'Entregue em uma etapa HTML autocontido, sem dependências externas. '+goal+' Números en-US, sem separador de milhar.',reference:html(body,js),contract:tests});
export const finalTasksV3=[
task('elevator','jogo','Elevador: #floor começa 0 e vai de 0 a 5. #up sobe 1, #down desce 1, nunca sai do intervalo.',
'<b id="floor">0</b><button id="up">Subir</button><button id="down">Descer</button>',
`let floor=0;const draw=()=>document.getElementById('floor').textContent=floor;document.getElementById('up').onclick=()=>{floor=Math.min(5,floor+1);draw();};document.getElementById('down').onclick=()=>{floor=Math.max(0,floor-1);draw();};`,
contract([click('#down'),num('#floor',0),click('#up'),click('#up'),click('#up'),click('#up'),click('#up'),click('#up'),num('#floor',5),click('#down'),num('#floor',4)])),
task('inventory','jogo','Moedas #coins inicia 0. #find soma 5. #spend gasta 5 só se houver saldo suficiente; senão não muda nada.',
'<b id="coins">0</b><button id="find">Achar</button><button id="spend">Gastar</button>',
`let coins=0;const draw=()=>document.getElementById('coins').textContent=coins;document.getElementById('find').onclick=()=>{coins+=5;draw();};document.getElementById('spend').onclick=()=>{if(coins>=5)coins-=5;draw();};`,
contract([click('#spend'),num('#coins',0),click('#find'),num('#coins',5),click('#spend'),num('#coins',0),click('#spend'),num('#coins',0)])),
task('accordion','pagina','Três seções .panel, cada uma com um botão .toggle e um texto .body escondido. Clicar num botão alterna só o .body correspondente. Todas começam escondidas.',
'<div class="panel"><button class="toggle">A</button><p class="body" hidden>Conteúdo A</p></div><div class="panel"><button class="toggle">B</button><p class="body" hidden>Conteúdo B</p></div><div class="panel"><button class="toggle">C</button><p class="body" hidden>Conteúdo C</p></div>',
`document.querySelectorAll('.toggle').forEach((btn,i)=>{btn.onclick=()=>{const body=document.querySelectorAll('.body')[i];body.hidden=!body.hidden;};});`,
contract([visible('.panel:nth-child(1) .body',false),visible('.panel:nth-child(2) .body',false),click('.panel:nth-child(2) .toggle'),visible('.panel:nth-child(2) .body',true),visible('.panel:nth-child(1) .body',false),click('.panel:nth-child(2) .toggle'),visible('.panel:nth-child(2) .body',false)])),
task('currency','pagina','Select #currency com opções usd/eur, começando em usd. #amount numérico começa 10. #total mostra amount convertido: usd multiplica por 1, eur multiplica por 0.9.',
'<select id="currency"><option value="usd">USD</option><option value="eur">EUR</option></select><input id="amount" type="number" value="10"><output id="total"></output>',
`function draw(){const rate=document.getElementById('currency').value==='eur'?0.9:1;document.getElementById('total').textContent=Number(document.getElementById('amount').value)*rate;}document.getElementById('currency').onchange=draw;document.getElementById('amount').oninput=draw;draw();`,
contract([num('#total',10),select('#currency','eur'),num('#total',9),fill('#amount','20'),num('#total',18),select('#currency','usd'),num('#total',20)])),
task('todo-filter','app','Lista de tarefas: #add adiciona texto de #entry como li com checkbox em #list. Select #view all/done/pending filtra quais aparecem. Começa em all.',
'<input id="entry"><button id="add">Adicionar</button><select id="view"><option value="all">all</option><option value="done">done</option><option value="pending">pending</option></select><ul id="list"></ul>',
`const items=[];function render(){const view=document.getElementById('view').value;document.getElementById('list').replaceChildren(...items.filter(it=>view==='all'||(view==='done')===it.done).map(it=>{const li=document.createElement('li');li.textContent=it.text;return li;}));}document.getElementById('add').onclick=()=>{const v=document.getElementById('entry').value.trim();if(v){items.push({text:v,done:false});document.getElementById('entry').value='';render();}};document.getElementById('view').onchange=render;render();`,
contract([fill('#entry','Lavar louça'),click('#add'),fill('#entry','Estudar'),click('#add'),count('#list li',2),select('#view','done'),count('#list li',0),select('#view','pending'),count('#list li',2),select('#view','all'),count('#list li',2)])),
task('stopwatch','app','Cronômetro simples: #seconds começa 0. #tick soma 1. #pause impede que #tick some (fica pausado). #resume libera de novo. #reset zera e despausa.',
'<output id="seconds">0</output><button id="tick">Tick</button><button id="pause">Pausar</button><button id="resume">Retomar</button><button id="reset">Reiniciar</button>',
`let seconds=0,paused=false;const draw=()=>document.getElementById('seconds').textContent=seconds;document.getElementById('tick').onclick=()=>{if(!paused)seconds++;draw();};document.getElementById('pause').onclick=()=>paused=true;document.getElementById('resume').onclick=()=>paused=false;document.getElementById('reset').onclick=()=>{seconds=0;paused=false;draw();};`,
contract([click('#tick'),click('#tick'),num('#seconds',2),click('#pause'),click('#tick'),num('#seconds',2),click('#resume'),click('#tick'),num('#seconds',3),click('#reset'),num('#seconds',0),click('#tick'),num('#seconds',1)])),
task('margin','bi','Preço de custo #cost e preço de venda #price, entradas numéricas. #calc mostra #margin = (price-cost)/price*100, ou 0 se price for zero.',
'<input id="cost" type="number"><input id="price" type="number"><button id="calc">Calcular</button><output id="margin">0</output>',
`document.getElementById('calc').onclick=()=>{const cost=Number(document.getElementById('cost').value),price=Number(document.getElementById('price').value);document.getElementById('margin').textContent=price?(price-cost)/price*100:0;};`,
contract([fill('#cost','60'),fill('#price','100'),click('#calc'),num('#margin',40),fill('#price','0'),click('#calc'),num('#margin',0),fill('#cost','0'),fill('#price','50'),click('#calc'),num('#margin',100)])),
task('ranking','bi','Times A pontos 30, B pontos 45, C pontos 10 em #list li, ordenados do maior pro menor pontos. Select #team all/A/B/C filtra a exibição, mantendo a ordem; all mostra todos.',
'<select id="team"><option value="all">all</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select><ul id="list"></ul>',
`const data=[{team:'A',pts:30},{team:'B',pts:45},{team:'C',pts:10}];function render(){const sel=document.getElementById('team').value,rows=[...data].sort((a,b)=>b.pts-a.pts).filter(r=>sel==='all'||r.team===sel);document.getElementById('list').replaceChildren(...rows.map(r=>{const li=document.createElement('li');li.textContent=r.team;return li;}));}document.getElementById('team').onchange=render;render();`,
contract([count('#list li',3),text('#list li:first-child','B'),select('#team','C'),count('#list li',1),text('#list li','C'),select('#team','all'),text('#list li:last-child','C')])),
];
