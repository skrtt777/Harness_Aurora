import { useState } from 'react';
import { canOpenFiles, openDeliveredFile, type LiveCheck, type LiveClaim, type Proof, type ProofClaim } from './api';

/**
 * The comprovante on screen (app/proof.js computes it): each number of an answer is marked where it is
 * written. Hover or focus shows where it came from — the sheet's row with the cell lit, the line of a
 * document, the calculation — and the seal under the answer counts how many numbers are proven.
 */

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };
const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'image', 'html']);

/** remark plugin: wraps each claim's text in a <mark data-proof="i">, in reading order, once each. */
export function remarkProof(proof: Proof | null | undefined) {
  return () => (tree: MdNode) => {
    if (!proof?.claims.length) return;
    const left = proof.claims.map((c, i) => ({ c, i })).filter(({ c }) => c.status !== 'pedido');
    const walk = (node: MdNode) => {
      if (!node.children || SKIP.has(node.type)) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value) { walk(child); next.push(child); continue; }
        let text = child.value;
        for (;;) {
          let best: { at: number; k: number } | null = null;
          left.forEach(({ c }, k) => { const at = text.indexOf(c.raw); if (at >= 0 && (!best || at < best.at)) best = { at, k }; });
          if (!best) break;
          const { at, k } = best as { at: number; k: number };
          const [{ c, i }] = left.splice(k, 1);
          if (at > 0) next.push({ type: 'text', value: text.slice(0, at) });
          next.push({ type: 'proofMark', data: { hName: 'mark', hProperties: { 'data-proof': String(i) } }, children: [{ type: 'text', value: c.raw }] });
          text = text.slice(at + c.raw.length);
        }
        if (text) next.push({ type: 'text', value: text });
      }
      node.children = next;
    };
    walk(tree);
  };
}

const LABEL: Record<ProofClaim['status'], string> = { fonte: 'Comprovado', conta: 'Calculado', pedido: 'Você disse', 'sem-prova': 'Sem fonte' };

function Where({ claim }: { claim: ProofClaim }) {
  const s = claim.source;
  if (claim.status === 'conta') return <><p className="proof-where">{claim.formula}</p>{claim.of && <p className="proof-file">de {claim.of}</p>}</>;
  if (claim.status === 'sem-prova') return <p className="proof-where">Nenhum arquivo lido nesta conversa tem este número, e ele não sai de uma conta com os números comprovados. Confira antes de usar.</p>;
  if (!s) return null;
  const at = s.row && s.header ? s.row.findIndex((cell) => cell.includes(claim.raw.replace(/^R\$\s?/, '').replace(/%$/, '')) || cell === claim.raw) : -1;
  return <>
    <p className="proof-file">{s.name || s.tool}{s.sheet ? ` › ${s.sheet}` : ''}{s.cell ? ` › ${s.cell}` : s.line ? ` › linha ${s.line}` : ''}{s.column ? ` (${s.column})` : ''}</p>
    {s.row && s.header
      ? <div className="proof-table" role="table">
          <div role="row" className="proof-row head">{s.header.slice(0, 6).map((h, j) => <span role="columnheader" key={j}>{h}</span>)}</div>
          <div role="row" className="proof-row">{s.row.slice(0, 6).map((cell, j) => <span role="cell" key={j} className={j === at || (at < 0 && s.column === s.header![j]) ? 'lit' : ''}>{cell}</span>)}</div>
        </div>
      : <p className="proof-line">{s.text}</p>}
    {(claim.others ?? 0) > 0 && <p className="proof-more">e em mais {claim.others} lugar{claim.others === 1 ? '' : 'es'}</p>}
    {canOpenFiles() && /^([A-Za-z]:[\\/]|\/)/.test(s.file) && <button type="button" className="proof-open" onClick={() => openDeliveredFile(s.file)}>Abrir {/\.(xlsx|xlsm|csv|tsv)$/i.test(s.file) ? 'a planilha' : 'o arquivo'}{s.cell ? ` (célula ${s.cell})` : ''}</button>}
  </>;
}

/** What the file says now, when it changed after the answer (the resposta viva). */
function LiveNote({ live }: { live: LiveClaim }) {
  if (live.status === 'mudou') return <p className="proof-where">Depois desta resposta, {live.where ? `${live.file ? `${live.file} › ` : ''}${live.where}` : live.file || 'o arquivo'} passou a dizer <strong>{live.now}</strong>{live.formula ? ` (${live.formula})` : ''}.</p>;
  return <p className="proof-where"><strong>Não confere mais:</strong> {live.why}.</p>;
}

const stale = (live?: LiveClaim) => live && (live.status === 'mudou' || live.status === 'sumiu') ? live : undefined;

/** One marked number: its status as a thin underline, the card on hover or focus; struck with the new value when its file changed. */
export function ProofMark({ claim, live, children }: { claim: ProofClaim; live?: LiveClaim; children: React.ReactNode }) {
  const changed = stale(live);
  return <mark className={`proof-mark ${changed ? changed.status : claim.status}`} tabIndex={0} aria-label={`${claim.raw}: ${changed ? (changed.status === 'mudou' ? `mudou, agora ${changed.now}` : 'não confere mais') : LABEL[claim.status]}`}>
    {changed ? <s>{children}</s> : children}
    {changed?.status === 'mudou' && <span className="proof-now">{changed.now}</span>}
    <span className="proof-card" role="tooltip">
      {changed ? <span className="proof-badge mudou">{changed.status === 'mudou' ? 'Mudou' : 'Não confere mais'}</span> : <span className={`proof-badge ${claim.status}`}>{LABEL[claim.status]}</span>}
      {changed && <LiveNote live={changed} />}
      {changed && <p className="proof-more">Na hora da resposta:</p>}
      <Where claim={claim} />
    </span>
  </mark>;
}

/**
 * The resposta viva under an answer: its files changed after it, and the numbers that changed with them.
 * "Refazer com os dados novos" asks the same again.
 */
export function LiveBanner({ live, onAsk }: { live: LiveCheck; onAsk?: (text: string) => void }) {
  const files = live.files.filter((f) => f.changed || f.missing);
  if (!files.length) return null;
  const names = files.map((f) => f.name).join(', ');
  if (live.verdict === 'vale') return <p className="proof-live vale"><span aria-hidden="true">✓</span> {names} mudou depois desta resposta; os {live.checked} números dela continuam iguais.</p>;
  const items = live.claims.filter((c) => c.status === 'mudou' || c.status === 'sumiu');
  return <div className="proof-live mudou" role="status">
    <p><strong>{files.some((f) => f.missing) && files.every((f) => f.missing) ? `${names} não está mais onde estava` : `${names} mudou depois desta resposta`}</strong> · {live.changed === 1 ? '1 número não vale mais' : `${live.changed} números não valem mais`}</p>
    <ul>{items.slice(0, 6).map((c) => <li key={c.i}><s>{c.raw}</s> {c.status === 'mudou' ? <>→ <strong>{c.now}</strong>{c.where ? <small> ({c.where})</small> : null}</> : <small>{c.why}</small>}</li>)}</ul>
    {onAsk && <button type="button" className="proof-open" onClick={() => onAsk(`Os dados de ${names} mudaram depois da sua resposta. Leia de novo e refaça a resposta com os números atuais.`)}>Refazer com os dados novos</button>}
  </div>;
}


/** The comprovante as a CSV for Excel (";" and a BOM, as Excel in Portuguese opens it): one line per number. */
export function proofCsv(proof: Proof): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = proof.claims.map((c) => [c.raw, LABEL[c.status], c.source?.file || c.of || '', c.source?.sheet || '', c.source?.cell || (c.source?.line ? `linha ${c.source.line}` : ''), c.source?.column || '', c.source?.row ? c.source.row.join(' | ') : c.source?.text || '', c.formula || '']);
  return '﻿' + [['Número', 'Situação', 'Arquivo', 'Aba', 'Célula', 'Coluna', 'Na fonte', 'Conta'], ...rows].map((r) => r.map(q).join(';')).join('\r\n');
}

function download(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The seal under an answer: "Comprovado · 6 de 6 números", the list of every number when opened. */
export function ProofSeal({ proof, outdated = false }: { proof: Proof; outdated?: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = proof.claims.filter((c) => c.status !== 'pedido');
  const missing = proof.total - proof.proven;
  return <div className={`proof-seal ${proof.seal}`}>
    <button className="proof-seal-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
      <span className="proof-seal-icon" aria-hidden="true">{proof.seal === 'comprovado' ? '✓' : '!'}</span>
      <strong>{proof.seal === 'comprovado' ? (outdated ? 'Comprovado na hora da resposta' : 'Comprovado') : missing === proof.total ? 'Números sem fonte' : `${missing} número${missing === 1 ? '' : 's'} sem fonte`}</strong>
      <span>{proof.proven} de {proof.total} número{proof.total === 1 ? '' : 's'} com prova{proof.sources.length ? ` · ${proof.sources.slice(0, 3).join(', ')}${proof.sources.length > 3 ? '…' : ''}` : ''}</span>
    </button>
    {open && <ol className="proof-list">{shown.map((c, i) => <li key={i} className={c.status}>
      <span className={`proof-badge ${c.status}`}>{LABEL[c.status]}</span><strong>{c.raw}</strong>
      <div><Where claim={c} /></div>
    </li>)}<li className="proof-actions"><button type="button" className="proof-open" onClick={() => download(proofCsv(proof), `comprovante-${new Date().toISOString().slice(0, 10)}.csv`)}>Baixar comprovante (.csv)</button></li></ol>}
  </div>;
}
