// Final blind evaluation set for LoRA v3. `heldout` re-exports the 8 tasks
// frozen in final-tasks-v3.mjs (never touched before this file existed —
// see that file's header for the "why these tasks" note). `retention` is a
// fresh set, distinct wording/content from heldout-v2.mjs's retention, so
// the final phase never reuses an already-observed retention prompt either.
export {finalTasksV3 as heldout} from './final-tasks-v3.mjs';
export const retention=[
 {id:'arithmetic-v3',prompt:'Responda somente o número: quanto é 47 + 36?',kind:'text',expected:'83'},
 {id:'json-v3',prompt:'Responda somente JSON: {"cidade":"Recife","pais":"Brasil"}.',kind:'json',expected:{cidade:'Recife',pais:'Brasil'}},
 {id:'sort-v3',prompt:'Ordene 21, 4, 15 em ordem crescente. Responda apenas um array JSON.',kind:'json',expected:[4,15,21]},
 {id:'plain-v3',prompt:'Responda exatamente: Pronto para continuar.',kind:'text',expected:'Pronto para continuar.'}
];
