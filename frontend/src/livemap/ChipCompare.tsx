import { BITS, compareBits, type ChipMemory } from "./chip";

/**
 * Two memories side by side: the bits of each (the signs of their embedding's first dimensions), where they agree,
 * the share that agrees, the real cosine of their embeddings (asked to the server), whether the atlas counts them
 * as neighbours, and the fragments they share.
 */
export default function ChipCompare({ a, b, bitsA, bitsB, colorA, colorB, similarity, mock, onClose }: {
  a: ChipMemory; b: ChipMemory; bitsA: Uint8Array; bitsB: Uint8Array; colorA: string; colorB: string;
  /** undefined: still asking; null: one of them has no embedding. */
  similarity: number | null | undefined; mock: boolean; onClose: () => void;
}) {
  const { agree, share } = compareBits(bitsA, bitsB);
  const noSig = !a.sig || !b.sig;
  const link = a.links.find((l) => l.id === b.id) || b.links.find((l) => l.id === a.id);
  const fold = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shared = a.entities.filter((x) => b.entities.some((y) => fold(y) === fold(x)));
  const COLS = 48, cell = 6;
  const grid = (bits: Uint8Array, fill: (i: number) => string) => (
    <svg viewBox={`0 0 ${COLS * cell} ${(BITS / COLS) * cell}`} className="mc-cmp-bits" aria-hidden="true">
      {Array.from(bits).map((_, i) => <rect key={i} x={(i % COLS) * cell + 0.6} y={Math.floor(i / COLS) * cell + 0.6} width={cell - 1.2} height={cell - 1.2} fill={fill(i)} />)}
    </svg>
  );
  return (
    <div className="mc-compare" role="dialog" aria-label="Comparar duas memórias">
      <header><b>COMPARAR</b><button onClick={onClose} aria-label="Fechar">×</button></header>
      <div className="mc-cmp-pair">
        <p style={{ color: colorA }}>A · {a.text}</p>
        <p style={{ color: colorB }}>B · {b.text}</p>
      </div>
      <div className="mc-cmp-nums">
        <div><b>{similarity === undefined ? "…" : similarity === null ? "—" : similarity.toFixed(3).replace(".", ",")}</b><span>{mock ? "similaridade (simulação)" : "similaridade real (cosseno dos embeddings)"}</span></div>
        <div><b>{noSig ? "—" : `${Math.round(share * 100)}%`}</b><span>sinais iguais nas {BITS} primeiras dimensões</span></div>
        <div><b>{link ? (link.kind === "relation" ? "relação" : link.score.toFixed(2).replace(".", ",")) : "não"}</b><span>{link ? "ligadas no atlas" : "vizinhas no atlas"}</span></div>
      </div>
      {noSig ? <p className="mc-cmp-note">Uma delas não tem assinatura de embedding (privada, esquecida ou sem embedding): os bits não são comparáveis.</p> : <>
        <h5>bits de A</h5>{grid(bitsA, (i) => (bitsA[i] ? colorA : "#0d1f18"))}
        <h5>bits de B</h5>{grid(bitsB, (i) => (bitsB[i] ? colorB : "#0d1f18"))}
        <h5>onde concordam <small>(verde: mesmo sinal · vermelho: sinais opostos)</small></h5>{grid(agree, (i) => (agree[i] ? "#5CF2C8" : "#ff6b6b"))}
      </>}
      <p className="mc-cmp-note">{shared.length ? <>fragmentos em comum: <b>{shared.join(" · ")}</b></> : "Nenhum fragmento em comum."}</p>
    </div>
  );
}
