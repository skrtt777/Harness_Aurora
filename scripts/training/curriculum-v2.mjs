// Diverse authored training families; final evaluation is a separate module.
import {contract,click,fill,select,num,count,text,visible} from './curriculum.mjs';
export function diverseCurriculum(v=0){
 const tasks=[],a=8+v,fee=3+v;
 function add(id,domain,goal,body,js,actions,before,after){
  const source=`<!doctype html>\n<html lang="pt-BR">\n<head><meta charset="utf-8"><title>${id}</title></head>\n<body>\n${body}\n<script>\n${js}\n</script>\n</body></html>`;
  if(!js.includes(after)||js.split(after).length!==2)throw Error('Nonunique mutation '+id);
  tasks.push({id:id+'-'+v,family:id,domain,goal:'Entregue em uma etapa HTML autocontido, sem dependências externas. '+goal+' Use números en-US, sem separador de milhar.',reference:source,contract:contract(actions),before,after,bad:source.replace(after,before)});
 }
 add('tip','bi',`#bill e #tip entradas numéricas iniciam ${a} e 10. #pay soma conta e gorjeta percentual, atualizado em input.`,
 `<input id="bill" type="number" value="${a}"><input id="tip" type="number" value="10"><output id="pay"></output>`,
 `function render(){const bill=Number(document.querySelector('#bill').value),tip=Number(document.querySelector('#tip').value);document.querySelector('#pay').textContent=bill*(1+tip/100);}document.querySelector('#bill').oninput=render;document.querySelector('#tip').oninput=render;render();`,
 [num('#pay',a*1.1),fill('#bill',100),num('#pay',110),fill('#tip',20),num('#pay',120),fill('#bill',0),num('#pay',0)],'bill*(1-tip/100)','bill*(1+tip/100)');
 add('progress','app','Três checkboxes .task. #done conta marcadas e #percent mostra porcentagem concluída. Todos desmarcados inicialmente.',
 '<input class="task" type="checkbox"><input class="task" type="checkbox"><input class="task" type="checkbox"><output id="done"></output><output id="percent"></output>',
 `const inputs=[...document.querySelectorAll('.task')];function update(){const done=inputs.filter(x=>x.checked).length;document.getElementById('done').textContent=done;document.getElementById('percent').textContent=done/inputs.length*100;}inputs.forEach(x=>x.onchange=update);update();`,
 [num('#done',0),{op:'check',selector:'.task:nth-child(1)',value:true},num('#done',1),num('#percent',100/3),{op:'check',selector:'.task:nth-child(2)',value:true},num('#done',2),{op:'check',selector:'.task:nth-child(1)',value:false},num('#done',1)],'inputs.filter(x=>!x.checked)','inputs.filter(x=>x.checked)');
 add('capacity','app',`Reserva: capacidade ${a}, #free começa ${a}. #book reserva 1, #cancel devolve 1. #free sempre entre 0 e ${a}.`,
 `<button id="book">Reservar</button><button id="cancel">Cancelar</button><output id="free"></output>`,
 `let occupied=0;function draw(){document.getElementById('free').textContent=${a}-occupied;}document.getElementById('book').onclick=()=>{occupied=Math.min(${a},occupied+1);draw();};document.getElementById('cancel').onclick=()=>{occupied=Math.max(0,occupied-1);draw();};draw();`,
 [num('#free',a),click('#cancel'),num('#free',a),click('#book'),click('#book'),num('#free',a-2),click('#cancel'),num('#free',a-1)],'occupied=Math.min(0,occupied-1)','occupied=Math.max(0,occupied-1)');
 add('paused-ticks','jogo',`Relógio manual: #time começa ${a}. #tick reduz 1 até zero apenas quando rodando. Inicialmente pausado. #start roda, #pause pausa, #reset restaura tempo e pausa.`,
 '<output id="time"></output><button id="tick">Passo</button><button id="start">Iniciar</button><button id="pause">Pausar</button><button id="reset">Reiniciar</button>',
 `let time=${a},running=false;function draw(){document.getElementById('time').textContent=time;}document.getElementById('tick').onclick=()=>{if(running)time=Math.max(0,time-1);draw();};document.getElementById('start').onclick=()=>running=true;document.getElementById('pause').onclick=()=>running=false;document.getElementById('reset').onclick=()=>{time=${a};running=false;draw();};draw();`,
 [click('#tick'),num('#time',a),click('#start'),click('#tick'),num('#time',a-1),click('#pause'),click('#tick'),num('#time',a-1),click('#reset'),num('#time',a),click('#tick'),num('#time',a)],'if(!running)','if(running)');
 add('quiz','jogo',`Quiz: #answer select errado/certo. #check soma ${fee} em #score só se certo, e mostra Correto ou Tente novamente em #feedback. Pontuação inicia zero.`,
 '<select id="answer"><option>errado</option><option>certo</option></select><button id="check">Responder</button><output id="score">0</output><p id="feedback"></p>',
 `let score=0;document.getElementById('check').onclick=()=>{const correct=document.getElementById('answer').value==='certo';if(correct)score+=${fee};document.getElementById('score').textContent=score;document.getElementById('feedback').textContent=correct?'Correto':'Tente novamente';};`,
 [click('#check'),num('#score',0),text('#feedback','Tente novamente'),select('#answer','certo'),click('#check'),num('#score',fee),text('#feedback','Correto'),click('#check'),num('#score',fee*2)],"value==='errado'","value==='certo'");
 add('multiplier','jogo',`#score começa zero. #factor select 1/2/3, inicial 1. #hit soma ${fee} vezes fator selecionado. #reset zera score preservando fator.`,
 '<output id="score">0</output><select id="factor"><option>1</option><option>2</option><option>3</option></select><button id="hit">Acertar</button><button id="reset">Zerar</button>',
 `let score=0;const draw=()=>document.querySelector('#score').textContent=score;document.querySelector('#hit').onclick=()=>{score+=${fee}*Number(document.querySelector('#factor').value);draw();};document.querySelector('#reset').onclick=()=>{score=0;draw();};`,
 [click('#hit'),num('#score',fee),select('#factor','3'),click('#hit'),num('#score',fee*4),click('#reset'),click('#hit'),num('#score',fee*3)],`score-=${fee}`,`score+=${fee}`);
 add('pagination','pagina','Itens A,B,C,D,E. #list li exibe dois por página. #next e #prev mudam página sem sair de 1..3; #page mostra página atual. Começa 1.',
 '<ul id="list"></ul><button id="prev">Anterior</button><button id="next">Próxima</button><output id="page"></output>',
 `const data=['A','B','C','D','E'];let page=1;function render(){document.getElementById('page').textContent=page;document.getElementById('list').replaceChildren(...data.slice((page-1)*2,page*2).map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));}document.getElementById('next').onclick=()=>{page=Math.min(3,page+1);render();};document.getElementById('prev').onclick=()=>{page=Math.max(1,page-1);render();};render();`,
 [count('#list li',2),text('#list li:first-child','A'),click('#prev'),num('#page',1),click('#next'),text('#list li:first-child','C'),click('#next'),count('#list li',1),text('#list li','E'),click('#next'),num('#page',3),click('#prev'),num('#page',2)],'data.slice(page*2,page*2)','data.slice((page-1)*2,page*2)');
 add('numeric-sort','pagina',`Valores ${a},100,2 em #list li. #order select asc/desc controla ordem numérica. Começa asc.`,
 '<select id="order"><option>asc</option><option>desc</option></select><ul id="list"></ul>',
 `const data=[${a},100,2];function render(){const rows=[...data].sort((a,b)=>a-b);if(document.getElementById('order').value==='desc')rows.reverse();document.getElementById('list').replaceChildren(...rows.map(n=>{const li=document.createElement('li');li.textContent=n;return li;}));}document.getElementById('order').onchange=render;render();`,
 [text('#list li:first-child','2'),select('#order','desc'),text('#list li:first-child','100'),select('#order','asc'),text('#list li:first-child','2')],'sort()','sort((a,b)=>a-b)');
 add('form-validation','pagina','Nome #name input e checkbox #agree. #submit mostra OK em #status só com nome não vazio e checkbox marcado; senão mostra Incompleto.',
 '<input id="name"><input id="agree" type="checkbox"><button id="submit">Enviar</button><output id="status"></output>',
 `document.getElementById('submit').onclick=()=>{const valid=Boolean(document.getElementById('name').value.trim())&&document.getElementById('agree').checked;document.getElementById('status').textContent=valid?'OK':'Incompleto';};`,
 [click('#submit'),text('#status','Incompleto'),fill('#name','Ana'),click('#submit'),text('#status','Incompleto'),{op:'check',selector:'#agree',value:true},click('#submit'),text('#status','OK'),fill('#name',' '),click('#submit'),text('#status','Incompleto')],")||document.getElementById('agree')",")&&document.getElementById('agree')");
 add('literal-preview','pagina','Input #title aparece em tempo real como texto literal em #preview. Não interprete HTML. #clear limpa entrada e preview.',
 '<input id="title"><h1 id="preview"></h1><button id="clear">Limpar</button>',
 `const input=document.getElementById('title'),preview=document.getElementById('preview');function update(){preview.textContent=input.value;}input.oninput=update;document.getElementById('clear').onclick=()=>{input.value='';update();};`,
 [fill('#title','<b>Aurora</b>'),text('#preview','<b>Aurora</b>'),count('#preview b',0),click('#clear'),text('#preview',''),{op:'assertValue',selector:'#title',expected:''}],'preview.innerHTML=input.value','preview.textContent=input.value');
 add('remove-last','app','Entrada #item e #add adicionam texto não vazio em #list li; #undo remove último item. Lista vazia não causa erro. #count reflete quantidade.',
 '<input id="item"><button id="add">Adicionar</button><button id="undo">Desfazer</button><ul id="list"></ul><output id="count"></output>',
 `const items=[];function render(){document.getElementById('count').textContent=items.length;document.getElementById('list').replaceChildren(...items.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));}document.getElementById('add').onclick=()=>{const value=document.getElementById('item').value.trim();if(value)items.push(value);render();};document.getElementById('undo').onclick=()=>{items.pop();render();};render();`,
 [click('#undo'),num('#count',0),fill('#item','Um'),click('#add'),fill('#item','Dois'),click('#add'),num('#count',2),click('#undo'),text('#list li','Um'),num('#count',1)],'items.shift()','items.pop()');
 add('growth','bi','Entradas #old e #new; #calc mostra crescimento percentual em #growth = (new-old)/old*100. Se old zero, resultado zero.',
 '<input id="old" type="number"><input id="new" type="number"><button id="calc">Calcular</button><output id="growth">0</output>',
 `document.querySelector('#calc').onclick=()=>{const previous=Number(document.querySelector('#old').value),current=Number(document.querySelector('#new').value);document.querySelector('#growth').textContent=previous?(current-previous)/previous*100:0;};`,
 [fill('#old',100),fill('#new',120),click('#calc'),num('#growth',20),fill('#new',80),click('#calc'),num('#growth',-20),fill('#old',0),click('#calc'),num('#growth',0)],'(current-previous)/current*100','(current-previous)/previous*100');
 add('weighted-grades','bi','Notas #first e #second numéricas. #calc mostra #result com pesos 1 e 3 respectivamente; média = (first+3*second)/4.',
 '<input id="first" type="number"><input id="second" type="number"><button id="calc">Calcular</button><output id="result">0</output>',
 `document.getElementById('calc').onclick=()=>{const first=Number(document.getElementById('first').value),second=Number(document.getElementById('second').value);document.getElementById('result').textContent=(first+3*second)/4;};`,
 [fill('#first',4),fill('#second',8),click('#calc'),num('#result',7),fill('#first',10),fill('#second',2),click('#calc'),num('#result',4)],'(first+second)/2','(first+3*second)/4');
 add('tax','bi',`Preço #price inicia ${a}. Checkbox #tax adiciona ${fee}% de imposto quando marcado. #total atualiza quando preço ou checkbox muda.`,
 `<input id="price" type="number" value="${a}"><input id="tax" type="checkbox"><output id="total"></output>`,
 `function draw(){const price=Number(document.getElementById('price').value),rate=document.getElementById('tax').checked?${fee}/100:0;document.getElementById('total').textContent=price*(1+rate);}document.getElementById('price').oninput=draw;document.getElementById('tax').onchange=draw;draw();`,
 [num('#total',a),{op:'check',selector:'#tax',value:true},num('#total',a*(1+fee/100)),fill('#price',100),num('#total',100+fee),{op:'check',selector:'#tax',value:false},num('#total',100)],'price*(1-rate)','price*(1+rate)');
 add('unit-convert','app','Distância #value numérica inicia 2. #unit select m-cm/cm-m. #result converte metros em centímetros ou inverso. Atualize em input/change.',
 '<input id="value" type="number" value="2"><select id="unit"><option>m-cm</option><option>cm-m</option></select><output id="result"></output>',
 `function draw(){const value=Number(document.getElementById('value').value);document.getElementById('result').textContent=document.getElementById('unit').value==='m-cm'?value*100:value/100;}document.getElementById('value').oninput=draw;document.getElementById('unit').onchange=draw;draw();`,
 [num('#result',200),select('#unit','cm-m'),num('#result',.02),fill('#value',350),num('#result',3.5),select('#unit','m-cm'),num('#result',35000)],'?value*100:value*100','?value*100:value/100');
 add('select-all','app','Checkbox #all controla dois checkboxes .row. Ao desmarcar qualquer row, all desmarca; ao marcar ambas, all marca. Começa tudo desmarcado.',
 '<input id="all" type="checkbox"><input class="row" type="checkbox"><input class="row" type="checkbox">',
 `const all=document.getElementById('all'),rows=[...document.querySelectorAll('.row')];all.onchange=()=>rows.forEach(row=>row.checked=all.checked);rows.forEach(row=>row.onchange=()=>{all.checked=rows.every(r=>r.checked);});`,
 [{op:'check',selector:'#all',value:true},{op:'assertChecked',selector:'.row:nth-child(2)',expected:true},{op:'assertChecked',selector:'.row:nth-child(3)',expected:true},{op:'check',selector:'.row:nth-child(2)',value:false},{op:'assertChecked',selector:'#all',expected:false},{op:'check',selector:'.row:nth-child(2)',value:true},{op:'assertChecked',selector:'#all',expected:true}],'.some(r=>r.checked)','.every(r=>r.checked)');
 add('shipping-threshold','pagina',`#subtotal input inicia 0; #total adiciona frete ${fee} se subtotal menor que ${a}; caso contrário frete zero. Valores negativos contam como zero.`,
 '<input id="subtotal" type="number" value="0"><output id="total"></output>',
 `function draw(){const subtotal=Math.max(0,Number(document.getElementById('subtotal').value));document.getElementById('total').textContent=subtotal+(subtotal<${a}?${fee}:0);}document.getElementById('subtotal').oninput=draw;draw();`,
 [num('#total',fee),fill('#subtotal',a-1),num('#total',a-1+fee),fill('#subtotal',a),num('#total',a),fill('#subtotal',-1),num('#total',fee)],`subtotal<=${a}`,`subtotal<${a}`);
 add('status-count','bi','Dados status open,done,open. Select #status all/open/done/empty; #count conta linhas selecionadas, não soma strings. Começa all.',
 '<select id="status"><option>all</option><option>open</option><option>done</option><option>empty</option></select><output id="count"></output>',
 `const data=[{status:'open'},{status:'done'},{status:'open'}];function draw(){const selected=document.getElementById('status').value;document.getElementById('count').textContent=data.filter(r=>selected==='all'||r.status===selected).length;}document.getElementById('status').onchange=draw;draw();`,
 [num('#count',3),select('#status','open'),num('#count',2),select('#status','done'),num('#count',1),select('#status','empty'),num('#count',0)],"r.status!==selected","r.status===selected");
 add('text-length','pagina',`Textarea #text; #left mostra ${a} menos número de caracteres. Pode ser negativo. #error com texto Excesso visível somente se ultrapassar limite.`,
 '<textarea id="text"></textarea><output id="left"></output><p id="error" hidden>Excesso</p>',
 `function draw(){const length=document.getElementById('text').value.length;document.getElementById('left').textContent=${a}-length;document.getElementById('error').hidden=length<=${a};}document.getElementById('text').oninput=draw;draw();`,
 [num('#left',a),fill('#text','abc'),num('#left',a-3),fill('#text','x'.repeat(a+1)),num('#left',-1),visible('#error',true),fill('#text',''),visible('#error',false)],`.value.trim().length`,`.value.length`);
 // Whitespace distinguishes length from trim length.
 tasks.at(-1).contract=contract([num('#left',a),fill('#text','  abc  '),num('#left',a-7),fill('#text','x'.repeat(a+1)),visible('#error',true),fill('#text',''),visible('#error',false)]);
 add('filtered-search','pagina','Dados Azul (active true), Branco (false), Amarelo (true). #query pesquisa nome sem diferenciar caixa; #active checkbox exige active quando marcado. Ambos filtros se combinam em #list li.',
 '<input id="query"><input id="active" type="checkbox"><ul id="list"></ul>',
 `const data=[{name:'Azul',active:true},{name:'Branco',active:false},{name:'Amarelo',active:true}];function draw(){const query=document.getElementById('query').value.toLowerCase(),active=document.getElementById('active').checked;document.getElementById('list').replaceChildren(...data.filter(r=>r.name.toLowerCase().includes(query)&&(!active||r.active)).map(r=>{const li=document.createElement('li');li.textContent=r.name;return li;}));}document.getElementById('query').oninput=draw;document.getElementById('active').onchange=draw;draw();`,
 [count('#list li',3),{op:'check',selector:'#active',value:true},count('#list li',2),fill('#query','BR'),count('#list li',0),{op:'check',selector:'#active',value:false},text('#list li','Branco')],'includes(query)||(!active||r.active)','includes(query)&&(!active||r.active)');
 // Rename IDs consistently in goal, markup, DOM calls, and contracts across variants.
 if(v)for(const t of tasks){
  const ids=[...t.reference.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
  const rename=s=>{for(const id of ids)s=s.replaceAll('#'+id,'#'+id+'V'+v).replaceAll(`id="${id}"`,`id="${id}V${v}"`).replaceAll(`getElementById('${id}')`,`getElementById('${id}V${v}')`);return s;};
  for(const k of ['goal','reference','bad','before','after'])t[k]=rename(t[k]);t.contract=JSON.parse(rename(JSON.stringify(t.contract)));
 }
 return tasks;
}
