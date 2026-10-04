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
