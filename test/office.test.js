import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOffice, turnState, sessionName, OFFICE_ROOM } from '../app/office.js';
import { startTurn, setStage, pushTurnStep, endTurn, turnSnapshots, requestApproval } from '../app/pendingTurns.js';

const now = Date.parse('2026-10-12T22:00:00Z');
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const find = (office, id) => office.rooms[0].actors.find((a) => a.id === id);

test('office: what a running turn is doing, from its stage, steps and approval', () => {
  assert.deepEqual(turnState({ stage: 'Pensando…', steps: [] }), { state: 'pensando', activity: 'Pensando…' });
  assert.equal(turnState({ stage: 'x', steps: [{ tool: 'write_document', status: 'running', summary: '' }] }).activity, 'Escrevendo a entrega');
  assert.equal(turnState({ stage: 'x', steps: [{ tool: 'read_file', status: 'running', summary: 'Lendo vendas.xlsx' }] }).activity, 'Lendo vendas.xlsx');
  assert.equal(turnState({ stage: 'x', steps: [], approval: { tool: 'run_command', summary: 'npm test' } }).state, 'aguardando');
  assert.deepEqual(turnState({ stage: 'Revisando com Claude…', steps: [] }), { state: 'revisao', activity: 'Em revisão com Claude', teacher: 'claude' });
  assert.equal(turnState({ stage: 'Consultando o professor…', steps: [] }, { teacherProvider: 'codex' }).teacher, 'codex');
  assert.equal(turnState({ stage: 'Refazendo com as lições do professor…', steps: [] }).state, 'refazendo');
  assert.equal(turnState({ stage: 'Conferindo a resposta com 3 cópias…', steps: [] }).copies, 3);
});

test('office: Claude or Codex doing a task appears next to whoever handed it over, and agents show their engine', () => {
  assert.deepEqual(turnState({ stage: 'A Aurora está fazendo com o Claude, sem enviar seus dados…', steps: [] }), { state: 'delegado', activity: 'Passou a tarefa ao Claude, sem enviar seus dados', engine: 'claude' });
  assert.equal(turnState({ stage: 'A Aurora pediu ajuda ao Codex…', steps: [] }).engine, 'codex');
  assert.equal(turnState({ stage: 'O script falhou nos dados reais; o Claude está corrigindo…', steps: [] }).state, 'delegado');
  assert.deepEqual(turnState({ stage: 'A Aurora está rodando aqui o script do Codex, nos dados reais…', steps: [] }).tool, 'run_command');
  const agents = [{ id: 'ag', name: 'Relatórios', enabled: true, projectId: 'pa', engine: 'codex' }, { id: 'al', name: 'Local', enabled: true, projectId: 'pl', engine: 'local' }];
  const runs = [{ id: 'r', agentId: 'ag', conversationId: 'cg', status: 'running', request: 'Relatório semanal', startedAt: iso(30000) }];
  const turns = { active: [
    { conversationId: 'cg', stage: 'A Aurora está fazendo com o Codex, sem enviar seus dados…', steps: [], since: now - 20000 },
    { conversationId: 'c1', stage: 'A Aurora está fazendo com o Claude, sem enviar seus dados…', steps: [], since: now - 9000 },
  ], ended: [] };
  const conversations = new Map([['cg', { id: 'cg', projectId: 'pa' }], ['c1', { id: 'c1', title: 'Gráfico de vendas', projectId: null }]]);
  const office = buildOffice({ projects: [], conversations, turns, agents, runs, now });
  const agent = find(office, 'agente:ag');
  assert.equal(agent.engine, 'codex', 'the agent carries its engine');
  assert.equal(agent.state, 'delegado');
  assert.equal(find(office, 'agente:al').engine, undefined);
  const forte = find(office, 'forte:agente:ag');
  assert.deepEqual([forte.kind, forte.name, forte.teacher, forte.state, forte.with], ['forte', 'Codex', 'codex', 'trabalhando', 'agente:ag']);
  assert.match(forte.activity, /cópia com valores falsos/);
  const session = find(office, 'aurora:c1');
  const claude = find(office, `forte:${session.id}`);
  assert.equal(claude.name, 'Claude');
  assert.equal(claude.room, session.room, 'at the desk of the same area as whoever handed it the task');
  assert.equal(forte.room, agent.room);
});

test('office: every character is something real, in its real state, in its project\'s room', () => {
  const projects = [{ id: 'p1', name: 'Vendas' }, { id: 'pa', name: 'Agente: Cobrança' }, { id: 'p2', name: 'Vazio' }];
  const agents = [
    { id: 'a1', name: 'Cobrança', enabled: true, projectId: 'pa' },
    { id: 'a2', name: 'Relatórios', enabled: true, projectId: 'pb' },
    { id: 'a3', name: 'RH', enabled: true, projectId: 'pc' },
    { id: 'a4', name: 'Velho', enabled: false, projectId: 'pd' },
    { id: 'a5', name: 'Estoque', enabled: true, projectId: 'pe' },
  ];
  const runs = [
    { id: 'r1', agentId: 'a1', conversationId: 'ca', status: 'running', request: 'Cobrar atrasados', startedAt: iso(60000) },
    { id: 'r2', agentId: 'a2', conversationId: 'cb', status: 'done', request: 'Relatório', files: ['C:\\x\\Relatorio.docx'], startedAt: iso(400000), finishedAt: iso(120000) },
    { id: 'r3', agentId: 'a3', conversationId: 'cc', status: 'failed', error: 'sem acesso à pasta', startedAt: iso(400000), finishedAt: iso(200000) },
    { id: 'r5', agentId: 'a5', conversationId: 'ce', status: 'done', request: 'Estoque', startedAt: iso(9e6), finishedAt: iso(8e6) },
  ];
  const turns = {
    active: [
      { conversationId: 'ca', stage: 'Revisando com Claude…', steps: [], since: now - 50000 },
      { conversationId: 'c1', stage: 'x', steps: [{ tool: 'web_search', status: 'running', summary: '' }], since: now - 9000 },
      { conversationId: 'c2', stage: 'Conferindo a resposta com 3 cópias…', steps: [], since: now - 4000 },
    ],
    ended: [{ conversationId: 'c3', endedAt: now - 30000 }],
  };
  const conversations = new Map([['ca', { id: 'ca', projectId: 'pa' }], ['c1', { id: 'c1', title: 'Metas do mês', projectId: 'p1' }], ['c2', { id: 'c2', title: 'Pergunta', projectId: null }], ['c3', { id: 'c3', title: 'Resumo', projectId: 'p1' }]]);
  const office = buildOffice({ projects, conversations, turns, agents, runs, now });
  // One floor for everyone (13/10), each person with the project it works on.
  assert.deepEqual(office.rooms.map((r) => r.id), [OFFICE_ROOM]);
  const all = office.rooms[0].actors;
  assert.equal(find(office, 'agente:a1').state, 'revisao');
  assert.equal(find(office, 'prof:agente:a1').name, 'Claude');
  assert.equal(find(office, 'agente:a2').state, 'cafe'); assert.match(find(office, 'agente:a2').activity, /Relatorio\.docx/);
  assert.equal(find(office, 'agente:a3').state, 'cobrado');
  assert.equal(find(office, 'agente:a4').state, 'desligado');
  assert.equal(find(office, 'agente:a5').state, 'descanso');
  assert.equal(all.filter((a) => a.kind === 'chefe').length, 1);
  assert.equal(find(office, 'chefe').state, 'cobrando'); assert.equal(find(office, 'chefe').with, 'agente:a3');
  assert.equal(find(office, 'aurora:c1').state, 'trabalhando'); assert.equal(find(office, 'aurora:c1').activity, 'Pesquisando na web'); assert.equal(find(office, 'aurora:c1').project, 'Vendas');
  assert.equal(find(office, 'aurora:c3').state, 'cafe');
  assert.equal(find(office, 'aurora:c2').project, 'Conversas soltas');
  assert.equal(all.filter((a) => a.kind === 'copia').length, 2);
  // A team request: the boss and its agents in the meeting.
  const meeting = buildOffice({ agents: [{ id: 'a5', name: 'Estoque', enabled: true, projectId: 'pe' }], runs: [], orchestrations: [{ status: 'running', request: 'Fechar o mês', startedAt: iso(1000), plan: [{ agentId: 'a5' }] }], now });
  assert.equal(find(meeting, 'agente:a5').state, 'reuniao'); assert.equal(find(meeting, 'chefe').state, 'reuniao');
  // Nobody working: the Aurora resting.
  assert.deepEqual(buildOffice({ now }).rooms[0].actors.map((a) => [a.kind, a.state]), [['aurora', 'descanso'], ['chefe', 'supervisionando']]);
});

test('office: the HR team at work (a prize, a warning, a new hire) and the agents stars', () => {
  const agents = [{ id: 'a1', name: 'Cobrança', enabled: true, projectId: 'pa' }, { id: 'a2', name: 'Estoque', enabled: true, projectId: 'pb' }, { id: 'a3', name: 'Velho', enabled: false, projectId: 'pc' }];
  const badges = new Map([['a1', { stars: 2, warnings: 0, status: 'ativo' }], ['a3', { stars: 0, warnings: 1, status: 'demitido' }]]);
  const events = [{ agentId: 'a1', kind: 'premio', by: 'Helena', at: now - 60000 }, { agentId: 'a2', kind: 'contratacao', by: 'Otávio', at: now - 30000 }];
  const office = buildOffice({ agents, runs: [], hr: { events, badges }, now });
  assert.equal(find(office, 'rh:helena').state, 'premiando'); assert.equal(find(office, 'rh:helena').with, 'agente:a1');
  assert.equal(find(office, 'rh:otavio').state, 'entrevistando'); assert.equal(find(office, 'agente:a2').state, 'reuniao');
  assert.equal(find(office, 'agente:a1').stars, 2);
  assert.equal(find(office, 'agente:a3').activity, 'Desligado pelo RH');
  // Quiet: HR at their desks.
  const quiet = buildOffice({ agents, runs: [], hr: { events: [], badges }, now });
  assert.deepEqual(['rh:helena', 'rh:otavio'].map((id) => find(quiet, id).state), ['trabalhando', 'trabalhando']);
});

test('office: each session has a name of its own, from its conversation (same letter, same name every time, none twice in a room)', () => {
  const n = sessionName('Metas de outubro', 'c1');
  assert.match(n, /^M/); assert.equal(sessionName('Metas de outubro', 'c1'), n);
  assert.match(sessionName('Écrire un mail', 'c9'), /^[EÉ]/);
  assert.notEqual(sessionName('Metas', 'c1', new Set([n])), n);
  const turns = { active: ['a', 'b', 'c'].map((id, i) => ({ conversationId: id, stage: 'Pensando…', steps: [], since: now - 1000 * (3 - i) })), ended: [] };
  const conversations = new Map(['a', 'b', 'c'].map((id) => [id, { id, title: 'Metas', projectId: 'p1' }]));
  const office = buildOffice({ projects: [{ id: 'p1', name: 'Vendas' }], conversations, turns, now });
  const names = office.rooms[0].actors.filter((a) => a.kind === 'aurora').map((a) => a.name);
  assert.equal(new Set(names).size, 3); assert.ok(names.every((x) => /^M/.test(x)), names.join());
  // A newcomer never takes the name of who was already there.
  const later = buildOffice({ projects: [{ id: 'p1', name: 'Vendas' }], conversations: new Map([...conversations, ['z', { id: 'z', title: 'Metas', projectId: 'p1' }]]), turns: { active: [...turns.active, { conversationId: 'z', stage: 'x', steps: [], since: now }], ended: [] }, now });
  const again = later.rooms[0].actors.filter((a) => a.kind === 'aurora' && a.conversationId !== 'z').map((a) => a.name);
  assert.deepEqual(again, names);
});

test('office: the live registry gives each turn\'s stage, steps, approval and the turns just ended', async () => {
  const c = startTurn('office-1'); setStage('office-1', 'Pensando…'); pushTurnStep('office-1', { tool: 'read_file', status: 'running', summary: 'Lendo a.pdf' });
  const asked = requestApproval('office-1', { tool: 'run_command', summary: 'npm test' }, { timeoutMs: 60000 });
  let snap = turnSnapshots();
  const t = snap.active.find((x) => x.conversationId === 'office-1');
  assert.equal(t.stage, 'Pensando…'); assert.equal(t.approval.summary, 'npm test'); assert.equal(t.steps[0].summary, 'Lendo a.pdf'); assert.ok(t.since > 0);
  endTurn('office-1', c); await asked;
  snap = turnSnapshots();
  assert.ok(!snap.active.some((x) => x.conversationId === 'office-1')); assert.ok(snap.ended.some((x) => x.conversationId === 'office-1'));
});

test('Sede: the area of a request, the station of what each one does, the ficha of a request through the line', async () => {
  const { areaOf, stationOf, fichaOf, DEPARTMENTS } = await import('../app/headquarters.js');
  assert.equal(DEPARTMENTS.length, 18);
  assert.equal(areaOf('Quais clientes estão inadimplentes há mais de 30 dias?'), 'financeiro');
  assert.equal(areaOf('revise o contrato de locação e os prazos'), 'juridico');
  assert.equal(areaOf('férias de outubro dos funcionários'), 'pessoas');
  assert.equal(areaOf('crie um site sobre jogos'), 'ti');
  assert.equal(areaOf('campanha de instagram para a loja'), 'comercial');
  assert.equal(areaOf('oi, tudo bem?'), 'operacoes');
  assert.deepEqual(stationOf({ state: 'trabalhando', tool: 'read_file', area: 'financeiro' }), { room: 'arquivo', station: 'arquivo' });
  assert.deepEqual(stationOf({ state: 'trabalhando', tool: 'web_search', area: 'juridico' }), { room: 'biblioteca', station: 'biblioteca' });
  assert.deepEqual(stationOf({ state: 'trabalhando', tool: 'write_document', area: 'pessoas' }), { room: 'pessoas', station: 'area' });
  assert.deepEqual(stationOf({ state: 'revisao' }), { room: 'revisao', station: 'revisao' });
  assert.deepEqual(stationOf({ state: 'pensando', checkedAt: now - 5000, now }), { room: 'conferencia', station: 'conferencia' });
  assert.equal(stationOf({ state: 'cafe' }).room, 'cafe');
  const f = fichaOf({ conversationId: 'c', title: 'Clientes inadimplentes', steps: [{ tool: 'read_file' }, { tool: 'write_document' }], station: 'conferencia', checks: 1 });
  assert.equal(f.areaName, 'Financeiro'); assert.equal(f.step, 2);
  assert.deepEqual(f.stations.map((s) => [s.label, s.state]), [['Recepção', 'feito'], ['Arquivo', 'feito'], ['Biblioteca', 'pulado'], ['Financeiro', 'feito'], ['Revisão', 'pulado'], ['Conferência', 'agora'], ['Expedição', 'falta']]);
  assert.equal(fichaOf({ conversationId: 'd', title: 'Campanha', steps: [{ tool: 'web_search' }], ended: true }).step, 3);
});

test('Sede: the office puts each one in its room and sends the fichas, a guard that fired puts the session in the Conferência', () => {
  const turns = { active: [
    { conversationId: 'c1', stage: 'x', steps: [{ tool: 'read_file', status: 'running', summary: 'Lendo contas.xlsx' }], tools: ['read_file'], since: now - 5000 },
    { conversationId: 'c2', stage: 'x', steps: [], tools: ['write_document'], checks: 1, checkedAt: now - 3000, lastCheck: 'requested_files_missing', since: now - 9000 },
  ], ended: [{ conversationId: 'c3', endedAt: now - 20000, tools: ['web_search', 'write_document'] }] };
  const conversations = new Map([['c1', { id: 'c1', title: 'Clientes inadimplentes' }], ['c2', { id: 'c2', title: 'Planilha de férias' }], ['c3', { id: 'c3', title: 'Campanha de Instagram' }]]);
  const office = buildOffice({ conversations, turns, now });
  const a = (id) => office.rooms[0].actors.find((x) => x.id === id);
  assert.equal(a('aurora:c1').room, 'arquivo');
  assert.equal(a('aurora:c2').room, 'conferencia'); assert.match(a('aurora:c2').activity, /faltava um arquivo do pedido/);
  assert.equal(a('aurora:c3').room, 'expedicao');
  assert.equal(office.departments.length, 18);
  assert.deepEqual(office.fichas.map((f) => [f.title, f.step]), [['Clientes inadimplentes', 2], ['Planilha de férias', 2], ['Campanha de Instagram', 3]]);
});
