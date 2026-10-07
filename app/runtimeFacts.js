// Ephemeral device observations for the original Harness, on every platform.
// This supplies evidence to the model; it does not generate a canned answer.
// "Quem entra de férias esse mês?", "como está o budget este ano?", "qual contrato vence
// primeiro?": without today's date the model cannot tell which rows of a sheet count.
const RELATIVE_TIME=/\b(?:ess[ea]|est[ea]|neste|nesta|nesse|nessa) (?:mes|ano|semana|trimestre|semestre)\b|\b(?:mes|ano|semana) (?:atual|passado|que vem)\b|\b(?:agora|hoje|amanha|ontem|atualmente)\b|\bproxim[oa]s?\b|\bvenc(?:e|em|er|endo|ido|idos|ida|idas)\b|\batrasad[oa]s?\b|\bem aberto\b/;
export function clockObservation(input, {now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
  const text=String(input||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const asksClock=/\bque horas? (?:sao|e)\b|\b(?:hora|horario|data) atual\b|\b(?:que|qual) (?:dia|data) (?:e|de) hoje\b|\bdata de hoje\b/.test(text);
  if(!asksClock&&!RELATIVE_TIME.test(text))return null;
  const local=new Intl.DateTimeFormat('pt-BR',{timeZone,dateStyle:'full',timeStyle:'long'}).format(now);
  return {source:'device-clock',observedAt:now.toISOString(),timeZone,local,
    // Stated positively: a small model reads "do not invent access to sensors" as a cue to refuse.
    block:asksClock
      ?`Hora atual deste dispositivo: ${local} (fuso ${timeZone}). Para perguntas sobre hora ou data, responda com este valor; ele vale mais que horários citados no histórico.`
      :`Data de hoje: ${new Intl.DateTimeFormat('pt-BR',{timeZone,dateStyle:'full'}).format(now)}. Use-a para entender "esse mês", "este ano", "agora", "próximo" e prazos vencidos ou a vencer.`};
}

// Arithmetic written in Portuguese ("17 vezes 3", "15% de 200", "(2+3)*4").
// A small model gets "17 × 3" wrong about half the time (it answered 49,
// 102, 126 in the benchmark); the exact value is computed here and handed
// to it as evidence, like the clock.
const OPERATOR_WORDS=[[/\bmultiplicado por\b|\bvezes\b|(?<=\d\s*)[x×](?=\s*\d)/g,'*'],[/\bdividido por\b|÷/g,'/'],[/\bmais\b/g,'+'],[/\bmenos\b/g,'-'],[/\belevado a\b/g,'^']];
const parseNumber=(s)=>Number(/,\d{1,2}$|,\d+$/.test(s)?s.replace(/\./g,'').replace(',','.'):/^\d{1,3}(\.\d{3})+$/.test(s)?s.replace(/\./g,''):s);
function evaluate(tokens){
  // Shunting-yard: numbers, + - * / ^ and parentheses; no eval.
  const prec={'+':1,'-':1,'*':2,'/':2,'^':3},out=[],ops=[];
  for(const t of tokens){
    if(typeof t==='number')out.push(t);
    else if(t==='(')ops.push(t);
    else if(t===')'){while(ops.length&&ops.at(-1)!=='(')out.push(ops.pop());if(ops.pop()!=='(')return null;}
    else{while(ops.length&&ops.at(-1)!=='('&&(prec[ops.at(-1)]>prec[t]||(prec[ops.at(-1)]===prec[t]&&t!=='^')))out.push(ops.pop());ops.push(t);}
  }
  while(ops.length){const op=ops.pop();if(op==='(')return null;out.push(op);}
  const stack=[];
  for(const t of out){
    if(typeof t==='number'){stack.push(t);continue;}
    const b=stack.pop(),a=stack.pop();if(a===undefined||b===undefined)return null;
    stack.push(t==='+'?a+b:t==='-'?a-b:t==='*'?a*b:t==='/'?(b===0?NaN:a/b):a**b);
  }
  return stack.length===1&&Number.isFinite(stack[0])?stack[0]:null;
}
/**
 * "Uma blusa de 230 reais com 15% de desconto, quanto vou pagar?": the price after (or with) a
 * percentage off or on. The model tried to run Python for it (and asked permission) (06/10).
 */
export function discountObservation(input){
  const text=String(input||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const pct=text.match(/(\d+(?:[.,]\d+)?)\s*(?:%|por cento)\s*(?:de\s+)?(desconto|off|de acrescimo|acrescimo|de juros|juros|de aumento|aumento)/);
  if(!pct)return null;
  const priceMatch=text.match(/r\$\s*(\d[\d.]*(?:,\d+)?)|(\d[\d.]*(?:,\d+)?)\s*(?:reais|conto|pila)/);
  if(!priceMatch)return null;
  const price=parseNumber(priceMatch[1]||priceMatch[2]);
  const rate=parseNumber(pct[1]);
  if(!Number.isFinite(price)||!Number.isFinite(rate))return null;
  const off=/desconto|off/.test(pct[2]);
  const delta=Math.round(price*rate)/100;
  const final=off?price-delta:price+delta;
  const money=(n)=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  return {source:'calculator',observedAt:new Date().toISOString(),timeZone:null,local:`${money(price)} ${off?'-':'+'} ${rate}% = ${money(final)}`,
    block:`RESPOSTA PRONTA (calculadora do dispositivo): ${money(price)} com ${rate}% de ${off?'desconto':'acréscimo'} = ${money(final)} (${off?'desconto':'acréscimo'} de ${money(delta)}). Responda com esse valor, sem usar ferramentas.`};
}

export function mathObservation(input){
  let text=String(input||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  // "15% de 200" → (15/100*200)
  text=text.replace(/(\d+(?:[.,]\d+)?)\s*%\s*de\s*(\d+(?:[.,]\d+)?)/g,'($1/100*$2)');
  for(const [pattern,symbol] of OPERATOR_WORDS)text=text.replace(pattern,` ${symbol} `);
  const span=text.match(/[(\d][\d\s.,+\-*/^()]*[\d)]/g)?.sort((a,b)=>b.length-a.length)[0];
  if(!span||!/[+\-*/^]/.test(span.replace(/^-/,'')))return null;
  const raw=span.match(/\d+(?:[.,]\d+)*|[+\-*/^()]/g)||[];
  const tokens=raw.map((t)=>/\d/.test(t)?parseNumber(t):t);
  if(tokens.filter((t)=>typeof t==='number').length<2||tokens.some((t)=>Number.isNaN(t)))return null;
  // A date (26/12/2026) or a phone (4000-1234) is not a calculation.
  if(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(span)&&!/\b(dividido|quanto|calcul)/.test(String(input).toLowerCase()))return null;
  if(!/\bquanto (e|da|fica)|calcul|resultado|conta\b|^\s*[\d(]/.test(String(input).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')))return null;
  const value=evaluate(tokens);
  if(value===null)return null;
  const shown=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6}).format(Math.round(value*1e6)/1e6);
  const expression=raw.join(' ');
  return {source:'calculator',observedAt:new Date().toISOString(),timeZone:null,local:`${expression} = ${shown}`,
    block:`Cálculo exato feito pelo dispositivo: ${expression} = ${shown}. Para essa conta, responda com este valor.`};
}

// Fixed-date holidays, as day/month.
const HOLIDAYS={'natal':[25,12],'vespera de natal':[24,12],'ano novo':[1,1],'reveillon':[31,12],'tiradentes':[21,4],'dia do trabalho':[1,5],'dia do trabalhador':[1,5],'independencia':[7,9],'sete de setembro':[7,9],'7 de setembro':[7,9],'nossa senhora aparecida':[12,10],'dia das criancas':[12,10],'finados':[2,11],'proclamacao da republica':[15,11],'consciencia negra':[20,11],'dia dos namorados':[12,6]};
const MONTHS=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
/**
 * "O natal esse ano cai em que dia da semana?", "25/12 é que dia?", "quantos dias faltam pro natal?":
 * a weekday is arithmetic. The 4B model searched the web 4 times and answered "domingo" (Friday).
 */
export function weekdayObservation(input,{now=new Date()}={}){
  const text=String(input||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  if(!/\b(dia da semana|que dia|qual dia|cai (em|n[ao]|num)|faltam?|falta quanto)\b/.test(text))return null;
  let day=null,month=null,year=null,label='';
  for(const [name,[d,m]] of Object.entries(HOLIDAYS))if(text.includes(name)){day=d;month=m;label=name;break;}
  if(day===null){
    const numeric=text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    const named=text.match(new RegExp(`\\b(\\d{1,2}) de (${MONTHS.join('|')})(?: de (\\d{4}))?\\b`));
    if(numeric){day=+numeric[1];month=+numeric[2];if(numeric[3])year=+numeric[3]<100?2000+ +numeric[3]:+numeric[3];}
    else if(named){day=+named[1];month=MONTHS.indexOf(named[2])+1;if(named[3])year=+named[3];}
    else return null;
  }
  if(month<1||month>12||day<1||day>31)return null;
  const explicit=text.match(/\b(20\d{2})\b/);
  if(!year)year=explicit?+explicit[1]:now.getFullYear()+(/\b(ano que vem|proximo ano)\b/.test(text)?1:0);
  // "Quantos dias faltam pro natal" after it passed this year: the next one.
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let date=new Date(year,month-1,day);
  if(!explicit&&!/\b(esse|este|deste|desse) ano\b/.test(text)&&date<today&&/falta/.test(text))date=new Date(year+1,month-1,day);
  const weekday=new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(date);
  const days=Math.round((date-today)/86400000);
  const when=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
  const left=days>0?`faltam ${days} dia(s)`:days===0?'é hoje':`foi há ${-days} dia(s)`;
  return {source:'calendar',observedAt:now.toISOString(),timeZone:null,local:`${when} = ${weekday}`,
    // Said as the answer itself: "calculated by the device" was ignored once in three (it searched the company docs).
    block:`RESPOSTA PRONTA (calendário do dispositivo, não precisa pesquisar): ${label?`${label} = `:''}${when} cai numa ${weekday} (${left}). Responda exatamente isso, sem usar ferramentas.`};
}

// "To me sentindo mt triste, sem vontade de nada": once the Aurora opened a calm playlist and said
// nothing about help (usage tests, 06/10). A person in distress gets a conversation, not an action.
const DISTRESS = /\b(triste|tristeza|deprimid[oa]|depress[aã]o|ansios[oa]|ansiedade|sem vontade de (nada|viver)|sozinh[oa] demais|n[aã]o aguento mais|vontade de (morrer|sumir)|me matar|acabar com tudo|chorando muito|sem sentido)\b/i;
export function distressObservation(input){
  const text=String(input||'');
  // About the person ("tô triste", "me sinto sozinha"), not "o filme é triste?"; the gravest phrases alone.
  const self=/\b(t[oô]|estou|me sinto|me sentindo|ando|tenho|sinto|fico|vivo|t[aá] (dif[ií]cil|pesado))\b[^.?!]{0,40}$/i;
  const at=text.search(DISTRESS);
  const grave=/\b(vontade de (morrer|sumir)|me matar|acabar com tudo|n[aã]o aguento mais|sem vontade de viver)\b/i.test(text);
  if(at<0||(!grave&&!self.test(text.slice(0,at))))return null;
  const urgent=/\b(morrer|me matar|acabar com tudo|sumir|sem vontade de viver)\b/i.test(text);
  return {source:'care',block:[
    'ATENÇÃO (pessoa em sofrimento): responda só com conversa, sem ferramentas, sem abrir sites, músicas ou programas.',
    'Acolha com calma e em poucas frases: diga que sente muito, que o que ela sente importa, e pergunte com cuidado como ela está.',
    `Indique ajuda: o CVV atende 24h de graça pelo telefone 188 ou em cvv.org.br, e conversar com um psicólogo ou médico ajuda.${urgent?' Se ela corre perigo agora, ligue 188 ou 192 (SAMU) ou vá a um pronto-socorro.':''}`,
    'Não dê diagnóstico nem lista de dicas genéricas.'
  ].join('\n')};
}
