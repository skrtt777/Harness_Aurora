import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOffice, turnState, TEAM_ROOM } from '../app/office.js';
import { startTurn, setStage, pushTurnStep, endTurn, turnSnapshots, requestApproval } from '../app/pendingTurns.js';

const now = Date.parse('2026-10-12T22:00:00Z');
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const find = (office, roomId, id) => office.rooms.find((r) => r.id === roomId).actors.find((a) => a.id === id);

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
  assert.deepEqual(office.rooms.map((r) => r.id), [TEAM_ROOM, 'p1', 'p2', 'geral']);
  // The team floor: one per agent, in the state of its run; the teacher is there only while reviewing.
  const team = office.rooms[0].actors;
  assert.equal(find(office, TEAM_ROOM, 'agente:a1').state, 'revisao');
  assert.equal(find(office, TEAM_ROOM, 'prof:agente:a1').name, 'Claude');
  assert.equal(find(office, TEAM_ROOM, 'agente:a2').state, 'cafe'); assert.match(find(office, TEAM_ROOM, 'agente:a2').activity, /Relatorio\.docx/);
  assert.equal(find(office, TEAM_ROOM, 'agente:a3').state, 'cobrado');
  assert.equal(find(office, TEAM_ROOM, 'agente:a4').state, 'desligado');
  assert.equal(find(office, TEAM_ROOM, 'agente:a5').state, 'descanso');
  assert.equal(find(office, TEAM_ROOM, 'chefe:equipe').state, 'cobrando'); assert.equal(find(office, TEAM_ROOM, 'chefe:equipe').with, 'agente:a3');
  assert.equal(team.filter((a) => a.kind === 'aurora').length, 0);
  // A project's room: the Aurora of each conversation working (or that just answered: a coffee).
  assert.equal(find(office, 'p1', 'aurora:c1').state, 'trabalhando'); assert.equal(find(office, 'p1', 'aurora:c1').activity, 'Pesquisando na web');
  assert.equal(find(office, 'p1', 'aurora:c3').state, 'cafe');
  assert.equal(find(office, 'p1', 'chefe:p1').state, 'conferindo');
  // Copies checking an answer, in the loose conversations' room; a quiet room keeps its Aurora resting.
  assert.equal(office.rooms.find((r) => r.id === 'geral').actors.filter((a) => a.kind === 'copia').length, 2);
  assert.deepEqual(office.rooms.find((r) => r.id === 'p2').actors.map((a) => [a.kind, a.state]), [['aurora', 'descanso'], ['chefe', 'supervisionando']]);
  // A team request: the boss and its agents in the meeting.
  const meeting = buildOffice({ agents: [{ id: 'a5', name: 'Estoque', enabled: true, projectId: 'pe' }], runs: [], orchestrations: [{ status: 'running', request: 'Fechar o mês', startedAt: iso(1000), plan: [{ agentId: 'a5' }] }], now });
  assert.equal(find(meeting, TEAM_ROOM, 'agente:a5').state, 'reuniao'); assert.equal(find(meeting, TEAM_ROOM, 'chefe:equipe').state, 'reuniao');
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
