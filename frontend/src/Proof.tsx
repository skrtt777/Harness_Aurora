import { useState } from 'react';
import { canOpenFiles, openDeliveredFile, type Proof, type ProofClaim } from './api';

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

/** One marked number: its status as a thin underline, the card on hover or focus. */
export function ProofMark({ claim, children }: { claim: ProofClaim; children: React.ReactNode }) {
  return <mark className={`proof-mark ${claim.status}`} tabIndex={0} aria-label={`${claim.raw}: ${LABEL[claim.status]}`}>
    {children}
    <span className="proof-card" role="tooltip">
      <span className={`proof-badge ${claim.status}`}>{LABEL[claim.status]}</span>
      <Where claim={claim} />
    </span>
  </mark>;
}

/** The seal under an answer: "Comprovado · 6 de 6 números", the list of every number when opened. */
export function ProofSeal({ proof }: { proof: Proof }) {
  const [open, setOpen] = useState(false);
  const shown = proof.claims.filter((c) => c.status !== 'pedido');
  const missing = proof.total - proof.proven;
  return <div className={`proof-seal ${proof.seal}`}>
    <button className="proof-seal-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
      <span className="proof-seal-icon" aria-hidden="true">{proof.seal === 'comprovado' ? '✓' : '!'}</span>
      <strong>{proof.seal === 'comprovado' ? 'Comprovado' : missing === proof.total ? 'Números sem fonte' : `${missing} número${missing === 1 ? '' : 's'} sem fonte`}</strong>
      <span>{proof.proven} de {proof.total} número{proof.total === 1 ? '' : 's'} com prova{proof.sources.length ? ` · ${proof.sources.slice(0, 3).join(', ')}${proof.sources.length > 3 ? '…' : ''}` : ''}</span>
    </button>
    {open && <ol className="proof-list">{shown.map((c, i) => <li key={i} className={c.status}>
      <span className={`proof-badge ${c.status}`}>{LABEL[c.status]}</span><strong>{c.raw}</strong>
      <div><Where claim={c} /></div>
    </li>)}</ol>}
  </div>;
}
