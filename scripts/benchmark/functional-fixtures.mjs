// Development fixtures only. These are not the frozen A/B or held-out tasks.
const html = (body, js) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Teste funcional</title></head><body>${body}<script>${js}</script></body></html>`;
const click = selector => ({op:'click',selector});
const text = (selector,expected) => ({op:'assertText',selector,expected});
const count = (selector,expected) => ({op:'assertCount',selector,expected});
const select = (selector,value) => ({op:'select',selector,value});
const fill = (selector,value) => ({op:'fill',selector,value});
const number = (selector,expected,tolerance=0.01) => ({op:'assertNumber',selector,expected,tolerance,locale:'pt-BR'});
const contract = cases => ({version:1,cases});

const resetJS = `let points=0;
const render=()=>{document.getElementById('points').textContent=points;};
document.getElementById('hit').onclick=()=>{points++;render();};
document.getElementById('reset').onclick=()=>{points=0;render();};`;
const persistenceJS = `let tasks=JSON.parse(localStorage.getItem('tasks')||'[]');
const render=()=>{document.getElementById('items').replaceChildren(...tasks.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));};
document.getElementById('add').onclick=()=>{tasks.push(document.getElementById('task').value);localStorage.setItem('tasks',JSON.stringify(tasks));render();};render();`;
const filterJS = `const products=[{name:'Azul',type:'A'},{name:'Amarelo',type:'A'},{name:'Branco',type:'B'}];
const render=()=>{const category=document.getElementById('category').value;const query=document.getElementById('search').value.toLowerCase();
const visible=products.filter(p=>(category==='all'||p.type===category)&&p.name.toLowerCase().includes(query));
document.getElementById('items').replaceChildren(...visible.map(p=>{const li=document.createElement('li');li.textContent=p.name;return li;}));};
document.getElementById('category').onchange=render;document.getElementById('search').oninput=render;render();`;
const biJS = `const sales=[{region:'Sul',revenue:100,cost:60},{region:'Norte',revenue:200,cost:140},{region:'Sul',revenue:50,cost:20}];
const render=()=>{const region=document.getElementById('region').value;const rows=sales.filter(s=>region==='all'||s.region===region);
const revenue=rows.reduce((n,s)=>n+s.revenue,0),cost=rows.reduce((n,s)=>n+s.cost,0),profit=revenue-cost;
const margin=revenue?100*profit/revenue:0;
for(const [id,value] of Object.entries({revenue,cost,profit,margin}))document.getElementById(id).textContent=value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});};
document.getElementById('region').onchange=render;render();`;

export const functionalFixtures = [
  {id:'restart',goal:'Entregue em uma etapa HTML um contador: #hit soma um ponto, #points exibe a pontuação e #reset zera o estado. Após reiniciar, o próximo clique deve mostrar 1.',
    good:html('<button id="hit">Acertar</button><button id="reset">Reiniciar</button><p id="points">0</p>',resetJS),
    before:'points=0;render();',after:"document.getElementById('points').textContent=0;",
    contract:contract([{id:'restart',name:'Reiniciar e jogar novamente',actions:[text('#points','0'),click('#hit'),click('#hit'),text('#points','2'),click('#reset'),text('#points','0'),click('#hit'),text('#points','1'),click('#reset'),text('#points','0')]}])},
  {id:'persistence',goal:'Entregue em uma etapa HTML uma lista de tarefas: entrada #task, botão #add, lista #items. Guarde as tarefas em localStorage e restaure após recarregar. Trate texto como texto.',
    good:html('<input id="task"><button id="add">Adicionar</button><ul id="items"></ul>',persistenceJS),
    before:"localStorage.setItem('tasks',JSON.stringify(tasks));",after:'',
    contract:contract([{id:'persist',name:'Restaurar tarefa depois de recarregar',actions:[fill('#task','Estudar <b>hoje</b>'),click('#add'),text('#items li','Estudar <b>hoje</b>'),{op:'reload'},count('#items li',1),text('#items li','Estudar <b>hoje</b>'),count('#items b',0)]},{id:'isolation',name:'Outra sessão começa vazia',actions:[count('#items li',0)]}])},
  {id:'filters',goal:'Entregue em uma etapa HTML um catálogo: Azul e Amarelo categoria A, Branco categoria B; #category seleciona all/A/B; #search pesquisa texto; #items contém li. Combine categoria e pesquisa, inclusive resultado vazio.',
    good:html('<select id="category"><option value="all">Todas</option><option>A</option><option>B</option></select><input id="search"><ul id="items"></ul>',filterJS),
    before:"(category==='all'||p.type===category)",after:'true',
    contract:contract([{id:'category',name:'Categoria e retorno ao total',actions:[count('#items li',3),select('#category','B'),count('#items li',1),text('#items li','Branco'),select('#category','all'),count('#items li',3)]},{id:'combined',name:'Combinar filtros e estado vazio',actions:[select('#category','A'),fill('#search','az'),count('#items li',1),text('#items li','Azul'),fill('#search','branco'),count('#items li',0),fill('#search',''),count('#items li',2)]}])},
  {id:'calculations',goal:'Entregue em uma etapa HTML um BI: vendas Sul receita 100 custo 60; Norte receita 200 custo 140; Sul receita 50 custo 20. #region filtra all/Sul/Norte/Vazio; #revenue, #cost, #profit e #margin mostram totais e margem percentual = lucro/receita*100, com zero quando sem vendas. Números pt-BR.',
    good:html('<select id="region"><option value="all">Todas</option><option>Sul</option><option>Norte</option><option>Vazio</option></select><p id="revenue"></p><p id="cost"></p><p id="profit"></p><p id="margin"></p>',biJS),
    before:'100*profit/revenue',after:'100*profit/cost',
    contract:contract([{id:'total',name:'Totais e margem sobre receita',actions:[number('#revenue',350),number('#cost',220),number('#profit',130),number('#margin',37.14)]},{id:'region',name:'Recalcular com filtro e restaurar',actions:[select('#region','Sul'),number('#revenue',150),number('#cost',80),number('#profit',70),number('#margin',46.67),select('#region','all'),number('#revenue',350)]},{id:'empty',name:'Evitar divisão por zero',actions:[select('#region','Vazio'),number('#revenue',0),number('#profit',0),number('#margin',0)]}])},
].map(f => ({...f,bad:f.good.replace(f.before,f.after)}));
