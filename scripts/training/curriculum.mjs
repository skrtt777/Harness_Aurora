// Authored examples. No prior benchmark outputs, user chats or downloaded skills.
export const html=(body,js)=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aurora</title><style>body{font:16px system-ui;max-width:760px;margin:24px auto;padding:16px}button,input,select{font:inherit;padding:8px;margin:4px}output{display:inline-block;min-width:32px}</style></head><body>${body}<script>${js}</script></body></html>`;
export const click=selector=>({op:'click',selector}),fill=(selector,value)=>({op:'fill',selector,value:String(value)}),select=(selector,value)=>({op:'select',selector,value});
export const num=(selector,expected)=>({op:'assertNumber',selector,expected,locale:'en-US',tolerance:.001}),count=(selector,expected)=>({op:'assertCount',selector,expected}),text=(selector,expected)=>({op:'assertText',selector,expected}),visible=(selector,expected)=>({op:'assertVisible',selector,expected});
export const contract=(...cases)=>({version:1,cases:cases.map((actions,i)=>({id:'c'+i,name:'Comportamento '+(i+1),actions}))});
export function task(id,domain,description,body,js,tests,mutation){return {id,domain,goal:'Entregue em uma etapa HTML autocontido, sem dependências externas. '+description+' Use números en-US, sem separador de milhar.',reference:html(body,js),contract:tests,...(mutation?{before:mutation[0],after:mutation[1],bad:html(body,js.replace(mutation[1],mutation[0]))}:{})};}
export function curriculum(v){
 const suffix=v.toString(36),a=4+v,b=2+v,cap=10+v,unit=6+v;
 const i=name=>name+suffix,sel=name=>'#'+i(name),get=name=>`document.getElementById('${i(name)}')`;
 return [
 task('counter-'+v,'jogo',`Contador ${sel('points')} começa 0. ${sel('gain')} soma ${a} até o limite ${cap}; ${sel('reset')} restaura 0.`,
 `<output id="${i('points')}">0</output><button id="${i('gain')}">Ganhar</button><button id="${i('reset')}">Reiniciar</button>`,
 `let points=0;const draw=()=>${get('points')}.textContent=points;${get('gain')}.onclick=()=>{points=Math.min(${cap},points+${a});draw();};${get('reset')}.onclick=()=>{points=0;draw();};draw();`,
 contract([click(sel('gain')),num(sel('points'),a),...Array.from({length:5},()=>click(sel('gain'))),num(sel('points'),cap),click(sel('reset')),num(sel('points'),0),click(sel('gain')),num(sel('points'),a)]),['points=points','points=0']),
 task('toggle-'+v,'pagina',`Botão ${sel('switch')} alterna visibilidade de ${sel('details')} com texto Detalhes ${v}, inicialmente oculto.`,
 `<button id="${i('switch')}">Detalhes</button><p id="${i('details')}" hidden>Detalhes ${v}</p>`,
 `${get('switch')}.onclick=()=>{const panel=${get('details')};panel.hidden=!panel.hidden;};`,
 contract([visible(sel('details'),false),click(sel('switch')),visible(sel('details'),true),click(sel('switch')),visible(sel('details'),false),click(sel('switch')),text(sel('details'),'Detalhes '+v)]),['panel.hidden=true','panel.hidden=!panel.hidden']),
 task('safe-list-'+v,'app',`${sel('entry')} e ${sel('save')} adicionam texto não vazio em li de ${sel('list')}. Limpe a entrada depois. Texto do usuário deve ser literal.`,
 `<input id="${i('entry')}"><button id="${i('save')}">Adicionar</button><ul id="${i('list')}"></ul>`,
 `${get('save')}.onclick=()=>{const input=${get('entry')},value=input.value.trim();if(!value)return;const li=document.createElement('li');li.textContent=value;${get('list')}.append(li);input.value='';};`,
 contract([click(sel('save')),count(sel('list')+' li',0),fill(sel('entry'),'<b>Item '+v+'</b>'),click(sel('save')),count(sel('list')+' b',0),text(sel('list')+' li','<b>Item '+v+'</b>'),{op:'assertValue',selector:sel('entry'),expected:''}]),['li.innerHTML=value','li.textContent=value']),
 task('sum-'+v,'bi',`${sel('a')} e ${sel('b')} entradas numéricas. ${sel('calc')} soma os valores e mostra ${sel('sum')}, inicialmente 0.`,
 `<input id="${i('a')}" type="number"><input id="${i('b')}" type="number"><button id="${i('calc')}">Somar</button><output id="${i('sum')}">0</output>`,
 `${get('calc')}.onclick=()=>{const x=Number(${get('a')}.value),y=Number(${get('b')}.value);${get('sum')}.textContent=x+y;};`,
 contract([fill(sel('a'),a),fill(sel('b'),b),click(sel('calc')),num(sel('sum'),a+b),fill(sel('a'),-a),click(sel('calc')),num(sel('sum'),b-a)]),['textContent=x-y','textContent=x+y']),
 task('price-'+v,'pagina',`Select ${sel('plan')} opções basic/pro/none. ${sel('price')} mostra respectivamente ${a}, ${a*4}, 0. Começa basic já calculado.`,
 `<select id="${i('plan')}"><option>basic</option><option>pro</option><option>none</option></select><output id="${i('price')}"></output>`,
 `const draw=()=>{const prices={basic:${a},pro:${a*4},none:0};${get('price')}.textContent=prices[${get('plan')}.value];};${get('plan')}.onchange=draw;draw();`,
 contract([num(sel('price'),a),select(sel('plan'),'pro'),num(sel('price'),a*4),select(sel('plan'),'none'),num(sel('price'),0),select(sel('plan'),'basic'),num(sel('price'),a)]),['.onchange=draw;','.onchange=draw;draw();']),
 task('persist-'+v,'app',`Saldo ${sel('balance')} inicia 0; ${sel('deposit')} soma ${unit}; ${sel('clear')} zera. Salve saldo em localStorage e restaure após recarregar.`,
 `<output id="${i('balance')}"></output><button id="${i('deposit')}">Depositar</button><button id="${i('clear')}">Zerar</button>`,
 `let balance=Number(localStorage.getItem('balance${v}')||0);const draw=()=>{${get('balance')}.textContent=balance;localStorage.setItem('balance${v}',String(balance));};${get('deposit')}.onclick=()=>{balance+=${unit};draw();};${get('clear')}.onclick=()=>{balance=0;draw();};draw();`,
 contract([num(sel('balance'),0),click(sel('deposit')),click(sel('deposit')),num(sel('balance'),unit*2),{op:'reload'},num(sel('balance'),unit*2),click(sel('clear')),{op:'reload'},num(sel('balance'),0)]),['let balance=0;',`let balance=Number(localStorage.getItem('balance${v}')||0);`]),
 task('filter-'+v,'bi',`Dados: grupo north valor ${a}; south valor ${b}. Select ${sel('region')} all/north/south/empty filtra soma em ${sel('total')}. Começa all.`,
 `<select id="${i('region')}"><option>all</option><option>north</option><option>south</option><option>empty</option></select><output id="${i('total')}"></output>`,
 `const rows=[{group:'north',value:${a}},{group:'south',value:${b}}];const draw=()=>{const selected=${get('region')}.value;${get('total')}.textContent=rows.filter(row=>selected==='all'||row.group===selected).reduce((sum,row)=>sum+row.value,0);};${get('region')}.onchange=draw;draw();`,
 contract([num(sel('total'),a+b),select(sel('region'),'north'),num(sel('total'),a),select(sel('region'),'empty'),num(sel('total'),0),select(sel('region'),'south'),num(sel('total'),b)]),["selected==='all'&&row.group===selected","selected==='all'||row.group===selected"]),
 task('quantity-'+v,'app',`Produto unitário ${unit}. ${sel('quantity')} entrada numérica inicia 1, negativos contam como zero. Ao editar calcule ${sel('amount')} = quantidade*preço.`,
 `<input id="${i('quantity')}" type="number" value="1"><output id="${i('amount')}"></output>`,
 `const draw=()=>{const quantity=Math.max(0,Number(${get('quantity')}.value)||0);${get('amount')}.textContent=quantity*${unit};};${get('quantity')}.oninput=draw;draw();`,
 contract([num(sel('amount'),unit),fill(sel('quantity'),3),num(sel('amount'),unit*3),fill(sel('quantity'),-1),num(sel('amount'),0),fill(sel('quantity'),2),num(sel('amount'),unit*2)]),[`textContent=quantity+${unit}`,`textContent=quantity*${unit}`]),
 task('ratio-'+v,'bi',`Entradas numéricas ${sel('part')}, ${sel('whole')}; ${sel('go')} calcula percentual ${sel('percent')} = part/whole*100, ou 0 se whole zero.`,
 `<input id="${i('part')}" type="number"><input id="${i('whole')}" type="number"><button id="${i('go')}">Calcular</button><output id="${i('percent')}">0</output>`,
 `${get('go')}.onclick=()=>{const part=Number(${get('part')}.value),whole=Number(${get('whole')}.value);${get('percent')}.textContent=whole?part/whole*100:0;};`,
 contract([fill(sel('part'),a),fill(sel('whole'),a*4),click(sel('go')),num(sel('percent'),25),fill(sel('whole'),0),click(sel('go')),num(sel('percent'),0),fill(sel('whole'),a*2),click(sel('go')),num(sel('percent'),50)]),['whole?part/part*100:0','whole?part/whole*100:0']),
 task('tabs-'+v,'pagina',`Botões ${sel('first')} e ${sel('second')} selecionam respectivamente painéis ${sel('one')} e ${sel('two')}. Só painel escolhido visível. Inicialmente one.`,
 `<button id="${i('first')}">Um</button><button id="${i('second')}">Dois</button><section id="${i('one')}">Primeiro</section><section id="${i('two')}" hidden>Segundo</section>`,
 `const show=which=>{${get('one')}.hidden=which!==1;${get('two')}.hidden=which!==2;};${get('first')}.onclick=()=>show(1);${get('second')}.onclick=()=>show(2);show(1);`,
 contract([visible(sel('one'),true),visible(sel('two'),false),click(sel('second')),visible(sel('one'),false),visible(sel('two'),true),click(sel('first')),visible(sel('one'),true),visible(sel('two'),false)]),['.hidden=which===2','.hidden=which!==2'])
 ];
}
