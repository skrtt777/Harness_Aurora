// Frozen before model runs. Explicit DOM contracts make grading reproducible.
const common = 'Entregue somente um arquivo HTML completo, com CSS e JavaScript inline. Sem bibliotecas, fontes, imagens ou serviços externos. Interface em português, limpa e responsiva a 390 e 1280 pixels, sem rolagem horizontal. Use title, h1, main, lang="pt-BR", meta viewport; botões HTML nativos com nome e inputs com label associado. Evite animações. Todos os IDs e comportamentos abaixo são obrigatórios. Não explique o código.';
export const tasks = [
  {id:'alvo',domain:'Jogos',name:'Jogo de clicar no alvo',buttons:['start','target','restart'],inputs:[],prompt:'Crie um jogo de clicar no alvo. Botões #start (Iniciar), #target (Alvo), #restart (Reiniciar), texto #score contendo apenas o número e #status. Inicialmente score=0 e alvo inativo ou oculto. Iniciar ativa o jogo. Cada clique no alvo vale 1 ponto. No terceiro ponto, status contém "Vitória" e cliques adicionais não pontuam. Reiniciar a qualquer momento inicia uma nova partida com 0 pontos e alvo ativo. Cinco reinícios consecutivos devem funcionar sem duplicar eventos. Alvo imóvel.'},
  {id:'quiz',domain:'Jogos',name:'Quiz com reinício',buttons:['answer4','answer5','restart'],inputs:[],prompt:'Crie um quiz de uma pergunta: Quanto é 2 + 2? Botões #answer4 (4), #answer5 (5), #restart (Reiniciar). Texto #score apenas número, inicialmente 0. Texto #status. Resposta 4 soma 1 ponto e status contém "Correto"; resposta 5 soma zero e status contém "Incorreto". Só a primeira resposta de cada rodada conta; depois ambas ficam inativas até reiniciar. Reiniciar zera pontos, limpa feedback e permite responder novamente. Deve funcionar por cinco rodadas.'},
  {id:'landing',domain:'Páginas',name:'Página com formulário',buttons:['submit'],inputs:['name','email'],prompt:'Crie uma landing page do produto Aurora com título, três benefícios visíveis, formulário e confirmação. Form #signup com input #name (nome obrigatório), input #email (type=email obrigatório), botão submit #submit e texto #feedback inicialmente vazio. Não aceite nome só com espaços nem email inválido; nunca mostre confirmação nesses casos. Ao enviar nome válido e email válido, impeça navegação e mostre em #feedback "Obrigado, NOME", usando textContent para não interpretar HTML. O envio funciona repetidamente. Não envie dados para servidor.'},
  {id:'catalogo',domain:'Páginas',name:'Catálogo com busca e filtros',buttons:[],inputs:['search','category'],prompt:'Crie catálogo com três produtos: Teclado, categoria Acessórios, preço 100; Mouse, Acessórios, 50; Monitor, Telas, 800. Input #search e select #category com values all, acessorios, telas. Div #products contém um article por produto visível, com nome e preço; produtos filtrados devem ser removidos ou ocultos. Busca ignora maiúsculas e combina com a categoria. Texto #count apenas número de produtos visíveis. Sem resultados mostre #empty visível. Limpar busca e selecionar all restaura três produtos.'},
  {id:'tarefas',domain:'Apps',name:'Lista de tarefas persistente',buttons:['add'],inputs:['task-input','filter'],prompt:'Crie app de tarefas. Input #task-input, botão #add, ul #list, select #filter com values all, pending, done, texto #count apenas número de tarefas pendentes TOTAL, independente do filtro. Cada tarefa é um li com texto, checkbox nativo e botão Excluir com nome acessível. Adicionar ignora texto vazio/espaços e limpa input. Checkbox alterna conclusão. Filtros combinam com estado. Excluir remove só a tarefa escolhida. Use localStorage para preservar tarefas e conclusão após recarregar. Renderize texto do usuário como texto, nunca HTML.'},
  {id:'bi',domain:'BI',name:'BI com indicadores e filtro',buttons:[],inputs:['region'],prompt:'Crie dashboard BI de vendas com dados fixos: Ana, Sul, receita 100, custo 60; Bia, Norte, receita 200, custo 80; Caio, Sul, receita 300, custo 120. Select #region values all, Sul, Norte. Indicadores numéricos (sem separador de milhares): #revenue soma receita, #cost soma custos, #profit receita menos custos, #margin percentual de lucro sobre receita com uma casa decimal e ponto decimal (pode ter %). Tabela #sales com thead e tbody, uma linha por venda filtrada. Filtro atualiza todos indicadores e tabela. All: receita 600 custo 260 lucro 340 margem 56.7; Sul: 400,180,220,55.0; Norte:200,80,120,60.0. Layout em cartões.'},
].map(t=>({...t,prompt:common+'\n\n'+t.prompt}));

export async function validate(page, task, url) {
  const checks=[], errors=[], external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if (!r.url().startsWith(url) && /^https?:/.test(r.url())) external.push(r.url());});
  page.setDefaultTimeout(750);
  const check=async(id,label,fn,group='functional')=>{try{const actual=await fn();checks.push({id,label,group,pass:actual===true,actual:actual===true?'ok':actual});}catch(e){checks.push({id,label,group,pass:false,actual:e.message.split('\n')[0]});}};
  const fresh=()=>page.goto(url,{waitUntil:'load',timeout:5000});
  const click=id=>page.locator('#'+id).click();
  const text=id=>page.locator('#'+id).innerText();
  const num=async id=>{const s=(await text(id)).trim();const m=s.match(/-?\d+(?:[.,]\d+)?/);return m?Number(m[0].replace(',','.')):NaN;};
  const eq=async(id,n)=>(await num(id))===n || `${id}: esperado ${n}, recebido ${await text(id)}`;
  const attemptClick=async id=>{const l=page.locator('#'+id);if(await l.isVisible() && await l.isEnabled()) await l.click();};
  try {await fresh();} catch(e) {errors.push(e.message);}
  if(task.id==='alvo') {
    await check('initial','Antes de iniciar, alvo não pontua',async()=>{await fresh();await attemptClick('target');return eq('score',0);});
    await check('point','Clique iniciado soma um',async()=>{await fresh();await click('start');await click('target');return eq('score',1);});
    await check('win','Três cliques vencem com três pontos',async()=>{await fresh();await click('start');for(let i=0;i<3;i++)await click('target');return await num('score')===3 && /vit[oó]ria/i.test(await text('status'));});
    await check('lock','Após vitória não soma pontos',async()=>{await fresh();await click('start');for(let i=0;i<3;i++)await click('target');await attemptClick('target');return eq('score',3);});
    await check('reset-active','Reiniciar durante partida zera e reativa',async()=>{await fresh();await click('start');await click('target');await click('restart');if(await num('score')!==0)return false;await click('target');return eq('score',1);});
    await check('reset-five','Cinco partidas sem estado ou eventos acumulados',async()=>{await fresh();for(let n=0;n<5;n++){await click('restart');if(await num('score')!==0)return false;for(let i=0;i<3;i++)await click('target');if(await num('score')!==3)return false;}return true;});
  } else if(task.id==='quiz') {
    await check('initial','Pontuação inicial zero',async()=>{await fresh();return eq('score',0);});
    await check('correct','Resposta correta pontua e dá feedback',async()=>{await fresh();await click('answer4');return await num('score')===1 && /^correto/i.test((await text('status')).trim());});
    await check('wrong','Resposta errada não pontua e dá feedback',async()=>{await fresh();await click('answer5');return await num('score')===0 && /incorreto/i.test(await text('status'));});
    await check('lock-correct','Não acumula respostas após acerto',async()=>{await fresh();await click('answer4');await attemptClick('answer4');await attemptClick('answer5');return await num('score')===1 && /^correto/i.test((await text('status')).trim());});
    await check('lock-wrong','Não permite acertar após errar',async()=>{await fresh();await click('answer5');await attemptClick('answer4');return await num('score')===0 && /incorreto/i.test(await text('status'));});
    await check('reset-five','Cinco reinícios limpam feedback e pontos',async()=>{await fresh();for(let i=0;i<5;i++){await click('restart');if(await num('score')!==0 || (await text('status')).trim()!=='')return false;await click('answer4');if(await num('score')!==1)return false;}return true;});
  } else if(task.id==='landing') {
    const send=async(name,email)=>{await page.locator('#name').fill(name);await page.locator('#email').fill(email);await click('submit');};
    await check('initial','Feedback inicial vazio',async()=>{await fresh();return (await text('feedback')).trim()==='';});
    await check('empty','Dados vazios não são aceitos',async()=>{await fresh();await click('submit');return !/obrigado/i.test(await text('feedback'));});
    await check('spaces','Nome só de espaços não é aceito',async()=>{await fresh();await send('   ','ana@example.com');return !/obrigado/i.test(await text('feedback'));});
    await check('email','Email inválido não é aceito',async()=>{await fresh();await send('Ana','invalido');return !/obrigado/i.test(await text('feedback'));});
    await check('submit','Envio válido confirma nome sem navegar',async()=>{await fresh();await send('Ana','ana@example.com');return /Obrigado,\s*Ana/i.test(await text('feedback')) && page.url()===url;});
    await check('repeat','Segundo envio atualiza confirmação',async()=>{await fresh();await send('Ana','ana@example.com');await send('Bia','bia@example.com');return /Obrigado,\s*Bia/i.test(await text('feedback'));});
    await check('escape','Nome com marcação permanece texto',async()=>{await fresh();await send('<b>Eva</b>','eva@example.com');return (await text('feedback')).includes('<b>Eva</b>') && await page.locator('#feedback b').count()===0;});
  } else if(task.id==='catalogo') {
    const visible=()=>page.locator('#products article:visible').count();
    await check('initial','Três produtos e contador inicial',async()=>{await fresh();return await visible()===3 && await num('count')===3;});
    await check('search','Busca ignora caixa e encontra Mouse',async()=>{await fresh();await page.locator('#search').fill('MOUSE');return await visible()===1 && /mouse/i.test(await page.locator('#products article:visible').innerText()) && await num('count')===1;});
    await check('category','Categoria Acessórios contém dois produtos',async()=>{await fresh();await page.locator('#category').selectOption('acessorios');return await visible()===2 && await num('count')===2;});
    await check('combine','Busca e categoria são combinadas',async()=>{await fresh();await page.locator('#category').selectOption('telas');await page.locator('#search').fill('mouse');return await visible()===0 && await num('count')===0 && await page.locator('#empty').isVisible();});
    await check('empty','Busca sem resultado mostra estado vazio',async()=>{await fresh();await page.locator('#search').fill('inexistente');return await visible()===0 && await num('count')===0 && await page.locator('#empty').isVisible();});
    await check('restore','Limpar filtros restaura catálogo',async()=>{await fresh();await page.locator('#search').fill('inexistente');await page.locator('#category').selectOption('telas');await page.locator('#search').fill('');await page.locator('#category').selectOption('all');return await visible()===3 && await num('count')===3;});
  } else if(task.id==='tarefas') {
    const clean=async()=>{await page.evaluate(()=>localStorage.clear());await fresh();};
    const add=async s=>{await page.locator('#task-input').fill(s);await click('add');};
    const rows=()=>page.locator('#list li:visible');
    await check('empty','Ignora tarefas vazias',async()=>{await clean();await add('   ');return await rows().count()===0 && await num('count')===0;});
    await check('add','Adiciona duas tarefas e limpa campo',async()=>{await clean();await add('Estudar');await add('Comprar');return await rows().count()===2 && await num('count')===2 && await page.locator('#task-input').inputValue()==='';});
    await check('done','Concluir reduz pendências',async()=>{await clean();await add('Estudar');await add('Comprar');await rows().first().locator('input[type=checkbox]').check();return eq('count',1);});
    await check('filters','Filtros preservam contador total pendente',async()=>{await clean();await add('Estudar');await add('Comprar');await rows().first().locator('input[type=checkbox]').check();await page.locator('#filter').selectOption('done');if(await rows().count()!==1 || !(await rows().innerText()).includes('Estudar') || await num('count')!==1)return false;await page.locator('#filter').selectOption('pending');return await rows().count()===1 && (await rows().innerText()).includes('Comprar');});
    await check('delete','Excluir remove só o item escolhido',async()=>{await clean();await add('Estudar');await add('Comprar');await rows().first().getByRole('button',{name:/excluir/i}).click();return await rows().count()===1 && (await rows().innerText()).includes('Comprar') && await num('count')===1;});
    await check('persist','Tarefas e conclusão sobrevivem a recarga',async()=>{await clean();await add('Estudar');await add('Comprar');await rows().first().locator('input[type=checkbox]').check();await fresh();return await rows().count()===2 && await rows().first().locator('input[type=checkbox]').isChecked() && await num('count')===1;});
    await check('escape','Texto do usuário não vira HTML',async()=>{await clean();await add('<b>Texto</b>');return (await rows().innerText()).includes('<b>Texto</b>') && await page.locator('#list b').count()===0;});
  } else if(task.id==='bi') {
    const values=async(revenue,cost,profit,margin,rows)=>await num('revenue')===revenue && await num('cost')===cost && await num('profit')===profit && Math.abs(await num('margin')-margin)<.01 && await page.locator('#sales tbody tr:visible').count()===rows;
    await check('all','Totais e três linhas corretos',async()=>{await fresh();return values(600,260,340,56.7,3);});
    await check('south','Filtro Sul recalcula todos indicadores',async()=>{await fresh();await page.locator('#region').selectOption('Sul');return values(400,180,220,55,2);});
    await check('north','Filtro Norte recalcula todos indicadores',async()=>{await fresh();await page.locator('#region').selectOption('Norte');return values(200,80,120,60,1);});
    await check('rows','Filtro Norte mostra Bia, sem Ana e Caio',async()=>{await fresh();await page.locator('#region').selectOption('Norte');const s=await page.locator('#sales tbody').innerText();return /Bia/.test(s) && !/Ana|Caio/.test(s);});
    await check('restore','Restaurar all recupera totais',async()=>{await fresh();await page.locator('#region').selectOption('Sul');await page.locator('#region').selectOption('all');return values(600,260,340,56.7,3);});
    await check('repeat','Cinco alternâncias não acumulam valores',async()=>{await fresh();for(let i=0;i<5;i++){await page.locator('#region').selectOption('Norte');if(!await values(200,80,120,60,1))return false;await page.locator('#region').selectOption('Sul');if(!await values(400,180,220,55,2))return false;}return true;});
  }
  await fresh().catch(()=>{});
  await check('structure','Documento com title, h1 e main',()=>page.evaluate(()=>!!document.title.trim() && !!document.querySelector('h1')?.textContent.trim() && !!document.querySelector('main')),'structure');
  await check('language','Idioma e viewport definidos',()=>page.evaluate(()=>document.documentElement.lang.startsWith('pt') && !!document.querySelector('meta[name=viewport]')),'structure');
  await check('buttons','Controles de ação são botões nativos nomeados',()=>page.evaluate(ids=>ids.every(id=>{const e=document.getElementById(id);return e?.tagName==='BUTTON' && !!(e.textContent.trim()||e.getAttribute('aria-label'));}),task.buttons),'accessibility');
  await check('labels','Campos possuem label associado',()=>page.evaluate(ids=>ids.every(id=>{const e=document.getElementById(id);return e && ((e.labels?.length>0 && [...e.labels].some(l=>l.textContent.trim())) || e.getAttribute('aria-label')?.trim());}),task.inputs),'accessibility');
  for(const width of [390,1280]) await check('width-'+width,`Sem overflow horizontal em ${width}px`,async()=>{await page.setViewportSize({width,height:900});return page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.body.scrollWidth<=innerWidth+1);},'responsive');
  await check('runtime','Sem erros JavaScript durante os testes',async()=>errors.length===0 || errors.join('; '),'runtime');
  await check('offline','Sem solicitações externas ou serviços adicionais',async()=>external.length===0 || external.join('; '),'runtime');
  const weights={functional:70,structure:10,accessibility:10,responsive:5,runtime:5};
  const groups=Object.fromEntries(Object.entries(weights).map(([g,w])=>{const c=checks.filter(x=>x.group===g);return[g,c.filter(x=>x.pass).length/c.length*w];}));
  const score=Object.values(groups).reduce((a,b)=>a+b,0);
  return {checks,groups,score,approved:checks.filter(x=>['functional','runtime'].includes(x.group)).every(x=>x.pass)&&score>=90,errors,external};
}
