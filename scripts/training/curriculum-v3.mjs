// New authored families (LoRA v3) — no prior benchmark outputs, user chats
// or downloaded skills. Chosen from real failure patterns actually observed
// in this project's own benchmarking this session (not guessed): a model
// defaulting a stateful control to its "edge case" state instead of the
// stated normal starting state (kernel-ab-qwen35-2026-09-26's 'weighted'
// task); wrong element type for a value that must stay editable
// (engine-tasks.mjs's 'basket'/'board'); a two-sided (min AND max) clamp
// together, not just one direction.
import { task, contract, click, fill, select, num } from './curriculum.mjs';

export function curriculumV3(v) {
  const a = 5 + v, b = 3 + v, top = 23 + v;
  const i = (name) => name + v, sel = (name) => '#' + i(name), get = (name) => `document.getElementById('${i(name)}')`;
  return [
    // Real bug reproduced: initializing a stateful control to its edge case
    // instead of the stated normal default. Deliberately doesn't rely on
    // <select> DOM-order default semantics (fragile to mutate) — the JS
    // explicitly sets the starting value, so the mutation is one clean token.
    task('select-default-' + v, 'bi',
      `Dados: A quantidade ${a} preço 10, B quantidade ${b} preço 20. Select ${sel('group')} com opções all/A/B/empty. ${sel('revenue')} soma quantidade vezes preço das linhas do grupo selecionado; empty soma zero. Começa em all, mostrando a soma de A e B.`,
      `<select id="${i('group')}"><option value="all">all</option><option value="A">A</option><option value="B">B</option><option value="empty">empty</option></select><output id="${i('revenue')}"></output>`,
      `const data=[{group:'A',qty:${a},price:10},{group:'B',qty:${b},price:20}];const draw=()=>{const g=${get('group')}.value,rows=data.filter(r=>g==='all'||r.group===g);${get('revenue')}.textContent=rows.reduce((s,r)=>s+r.qty*r.price,0);};${get('group')}.onchange=draw;${get('group')}.value='all';draw();`,
      contract([num(sel('revenue'), a * 10 + b * 20), select(sel('group'), 'A'), num(sel('revenue'), a * 10), select(sel('group'), 'empty'), num(sel('revenue'), 0), select(sel('group'), 'all'), num(sel('revenue'), a * 10 + b * 20)]),
      [`${get('group')}.value='empty'`, `${get('group')}.value='all'`]),
    // Two-sided clamp together (min AND max in the same stepper) — single-
    // direction clamps are already covered elsewhere; this drills both.
    task('range-stepper-' + v, 'jogo',
      `Termostato ${sel('temp')} começa 20 e fica entre 16 e ${top}. ${sel('up')} soma 1, ${sel('down')} subtrai 1, ${sel('reset')} volta a 20.`,
      `<output id="${i('temp')}">20</output><button id="${i('up')}">+</button><button id="${i('down')}">-</button><button id="${i('reset')}">Reiniciar</button>`,
      `let temp=20;const draw=()=>${get('temp')}.textContent=temp;${get('up')}.onclick=()=>{temp=Math.min(${top},temp+1);draw();};${get('down')}.onclick=()=>{temp=Math.max(16,temp-1);draw();};${get('reset')}.onclick=()=>{temp=20;draw();};draw();`,
      contract([...Array.from({ length: top - 20 + 1 }, () => click(sel('up'))), num(sel('temp'), top), ...Array.from({ length: top - 16 }, () => click(sel('down'))), num(sel('temp'), 16), click(sel('reset')), num(sel('temp'), 20)]),
      [`temp=Math.max(${top},temp+1)`, `temp=Math.min(${top},temp+1)`]),
    // Wrong-element-type guard: the value must read back via a real input,
    // not a display-only element — engine-tasks.mjs's 'basket'/'board'
    // failed exactly this way (model substituted a <div>/<h2> for a control
    // that had to stay interactive/editable).
    task('editable-total-' + v, 'app',
      `Campo ${sel('qty')} numérico começa em 1. ${sel('apply')} lê o valor de ${sel('qty')} (nunca negativo) e mostra em ${sel('total')} o total = quantidade * ${a}. ${sel('qty')} deve continuar um campo editável a qualquer momento, mesmo depois de aplicar.`,
      `<input id="${i('qty')}" type="number" value="1"><button id="${i('apply')}">Aplicar</button><output id="${i('total')}"></output>`,
      `${get('apply')}.onclick=()=>{const q=Math.max(0,Number(${get('qty')}.value)||0);${get('total')}.textContent=q*${a};};`,
      contract([click(sel('apply')), num(sel('total'), a), fill(sel('qty'), 4), click(sel('apply')), num(sel('total'), a * 4), fill(sel('qty'), -3), click(sel('apply')), num(sel('total'), 0), { op: 'assertValue', selector: sel('qty'), expected: '-3' }]),
      [`Number(${get('qty')}.value)||0`, `Math.max(0,Number(${get('qty')}.value)||0)`]),
  ];
}
