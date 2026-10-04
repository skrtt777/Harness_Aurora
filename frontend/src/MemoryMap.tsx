import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getRecentRecalls, probeRecall, type RecallResult, type RecentRecall } from "./api";
import { constellationLayout } from "./Constellation";
import { groupKey, memoryHealth, type Memory, type MemoryCluster } from "./data";

/**
 * The memory map an agent would actually use. Flat and still — nothing
 * spins — so it reads like an instrument:
 *  - territories: one area per topic, a dot per memory (size = use,
 *    colour = health);
 *  - "what would the AI remember?": runs the chat's real selection for a
 *    question and shows what would enter the context, in order and why, plus
 *    what almost did;
 *  - "latest recalls": what recent answers actually used (and created).
 */
type Props = {
  memories: Memory[];
  visible: Set<string>;
  clusters: MemoryCluster[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCluster: (id: number) => void;
  onGroup: (key: string) => void;
};

const HEALTH = {
  helpful: { color: "#4ade80", label: "Ajuda" },
  failing: { color: "#f87171", label: "Atrapalha" },
  used: { color: "#5fd4c0", label: "Usada" },
  unused: { color: "#7c8594", label: "Nunca usada" },
};
function healthOf(m: Memory): keyof typeof HEALTH {
  const h = memoryHealth(m);
  if (h.failing) return "failing";
  if (h.helpful) return "helpful";
  if ((m.stats?.uses ?? 0) > 0) return "used";
  return "unused";
}
const percent = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const when = (iso: string) => {
  const d = new Date(iso);
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 60 * 24) return `há ${Math.round(minutes / 60)} h`;
  return d.toLocaleDateString("pt-BR");
};

type View = { x: number; y: number; k: number };

export default function MemoryMap({ memories, visible, clusters, selectedId, onSelect, onCluster, onGroup }: Props) {
  const layout = useMemo(() => constellationLayout(memories, clusters), [memories, clusters]);
  const point = useCallback((id: string) => {
    const p = layout.positions.get(id);
    return p ? { x: p[0], y: p[2] } : null;
  }, [layout]);
  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);

  // ---------- size, fit, pan & zoom ----------
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const panelOpen = size.w > 760;
  const panelWidth = panelOpen ? 336 : 0;
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const g of layout.groups) {
      minX = Math.min(minX, g.center.x - g.radius - 2); maxX = Math.max(maxX, g.center.x + g.radius + 2);
      minY = Math.min(minY, g.center.z - g.radius - 4); maxY = Math.max(maxY, g.center.z + g.radius + 2);
    }
    if (!Number.isFinite(minX)) return { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    return { minX, maxX, minY, maxY };
  }, [layout]);
  const fitView = useCallback((): View => {
    const left = panelWidth + 24, right = 24, top = 40, bottom = 40;
    const w = Math.max(100, size.w - left - right), h = Math.max(100, size.h - top - bottom);
    const k = Math.min(w / (bounds.maxX - bounds.minX), h / (bounds.maxY - bounds.minY));
    return { k, x: left + (w - (bounds.maxX - bounds.minX) * k) / 2 - bounds.minX * k, y: top + (h - (bounds.maxY - bounds.minY) * k) / 2 - bounds.minY * k };
  }, [bounds, size, panelWidth]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 10 });
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setView(fitView());
  }, [fitView]);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const zoomAt = (factor: number, cx: number, cy: number) => {
    touched.current = true;
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, 2), 120);
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const el = box.current?.querySelector("svg");
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const sx = (x: number) => x * view.k + view.x;
  const sy = (y: number) => y * view.k + view.y;

  // ---------- recall: probe and recent ----------
  const [question, setQuestion] = useState("");
  const [probe, setProbe] = useState<RecallResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [recents, setRecents] = useState<RecentRecall[]>([]);
  const [activeRecent, setActiveRecent] = useState<RecentRecall | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () => getRecentRecalls().then((r) => { if (!stopped) setRecents(r.recalls); }).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  const runProbe = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!question.trim()) return;
    setProbing(true);
    setProbeError("");
    setActiveRecent(null);
    try {
      setProbe(await probeRecall(question.trim()));
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : "Não foi possível testar.");
    } finally {
      setProbing(false);
    }
  };
  const clearRecall = () => { setProbe(null); setActiveRecent(null); };

  // What is lit: the probe's picks (ranked) or a recent answer's memories.
  const lit = useMemo(() => {
    if (probe) {
      const top = Math.max(...probe.selected.map((s) => s.score ?? 0), 1e-6);
      return {
        label: "pergunta",
        ranked: probe.selected.filter((s) => byId.has(s.id)).map((s) => ({ id: s.id, rank: s.rank, weight: (s.score ?? 0) / top })),
        near: new Set(probe.near.map((n) => n.id)),
        created: new Set<string>(),
      };
    }
    if (activeRecent)
      return {
        label: "resposta",
        ranked: activeRecent.used.filter((id) => byId.has(id)).map((id, i) => ({ id, rank: i + 1, weight: 1 })),
        near: new Set<string>(),
        created: new Set(activeRecent.created),
      };
    return null;
  }, [probe, activeRecent, byId]);
  const litIds = useMemo(() => new Set(lit?.ranked.map((r) => r.id) ?? []), [lit]);
  // The question sits at the centre of what it pulled in; scattered picks read as scattered.
  const pin = useMemo(() => {
    if (!lit?.ranked.length) return null;
    let x = 0, y = 0, w = 0;
    for (const r of lit.ranked) {
      const p = point(r.id);
      if (!p) continue;
      const weight = 0.3 + r.weight;
      x += p.x * weight; y += p.y * weight; w += weight;
    }
    return w ? { x: x / w, y: y / w } : null;
  }, [lit, point]);
  const litGroups = useMemo(() => {
    if (!lit) return null;
    const keys = new Set<string>();
    const all = [...litIds, ...lit.near, ...lit.created];
    for (const id of all) {
      const m = byId.get(id);
      if (m) keys.add(m.cluster !== undefined ? `c${m.cluster}` : `g:${groupKey(m)}`);
    }
    return keys;
  }, [lit, litIds, byId]);

  // A good recall is focused: many memories, or memories from many topics, is a smell.
  const spread = useMemo(() => {
    if (!lit?.ranked.length || !litGroups) return null;
    const topics = new Set(lit.ranked.map((r) => { const m = byId.get(r.id); return m ? (m.cluster !== undefined ? `c${m.cluster}` : `g:${groupKey(m)}`) : ""; })).size;
    if (lit.ranked.length >= 8) return `${lit.ranked.length} memórias de ${topics} assuntos: contexto demais para uma resposta.`;
    if (topics >= 3) return `Espalhada em ${topics} assuntos: a lembrança está pouco focada.`;
    return null;
  }, [lit, litGroups, byId]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const radius = (m: Memory) => Math.max(0.55 + Math.min(1.1, Math.log2(1 + (m.stats?.uses ?? 0)) * 0.4), 2.4 / view.k);

  const groupOf = (key: string) => layout.groups.find((g) => g.key === key);
  const counts = useMemo(() => {
    const c = { helpful: 0, failing: 0, used: 0, unused: 0 };
    memories.forEach((m) => (c[healthOf(m)] += 1));
    return c;
  }, [memories]);

  return (
    <div className="memory-map" ref={box}>
      <svg
        width={size.w}
        height={size.h}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 3) return;
          d.moved = true;
          touched.current = true;
          d.x = e.clientX; d.y = e.clientY;
          setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        }}
        onPointerUp={() => { setTimeout(() => (drag.current = null), 0); }}
        className={drag.current?.moved ? "dragging" : ""}
      >
        <defs>
          <radialGradient id="map-pin-glow">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.groups.map((g) => {
            const dim = litGroups ? !litGroups.has(g.key) : false;
            return (
              <circle key={g.key} cx={g.center.x} cy={g.center.z} r={g.radius + 1} fill={g.color} fillOpacity={dim ? 0.02 : 0.06} stroke={g.color} strokeOpacity={dim ? 0.12 : 0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            );
          })}
          {layout.edges.map(([a, b]) => {
            const p = point(a), q = point(b);
            if (!p || !q) return null;
            return <line key={`${a}|${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#9aa4b2" strokeOpacity={lit ? 0.05 : 0.16} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          })}
          {selected?.neighbors?.map((n) => {
            const p = point(selected.id), q = point(n.id);
            if (!p || !q) return null;
            return <line key={`sel-${n.id}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--accent)" strokeOpacity={0.35 + (n.similarity - 0.7) * 1.5} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />;
          })}
          {pin && lit?.ranked.map((r) => {
            const q = point(r.id);
            if (!q) return null;
            return <line key={`pin-${r.id}`} x1={pin.x} y1={pin.y} x2={q.x} y2={q.y} stroke="#ffffff" strokeOpacity={0.25 + r.weight * 0.5} strokeWidth={1 + r.weight * 1.5} vectorEffect="non-scaling-stroke" />;
          })}
          {memories.map((m) => {
            const p = point(m.id);
            if (!p) return null;
            const shown = visible.has(m.id);
            const health = healthOf(m);
            const isLit = litIds.has(m.id);
            const faded = !shown || (lit && !isLit && !lit.near.has(m.id) && !lit.created.has(m.id));
            const r = radius(m) * (isLit ? 1.5 : 1);
            return (
              <g key={m.id} opacity={faded ? 0.16 : 1}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={isLit ? "#ffffff" : HEALTH[health].color}
                  stroke={(m.duplicates?.length ?? 0) > 0 ? "#facc15" : "none"}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  className={shown ? "map-dot" : undefined}
                  onPointerEnter={(e) => shown && setHover({ id: m.id, x: e.clientX, y: e.clientY })}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => { if (shown && !drag.current?.moved) onSelect(m.id); }}
                />
                {lit?.near.has(m.id) && <circle cx={p.x} cy={p.y} r={r + 1.1} fill="none" stroke="#ffb86b" strokeWidth={1.2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
                {lit?.created.has(m.id) && <circle cx={p.x} cy={p.y} r={r + 1.1} fill="none" stroke="#4ade80" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                {m.id === selectedId && <circle cx={p.x} cy={p.y} r={r + 1.4} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
              </g>
            );
          })}
        </g>
        {/* Screen-space overlay: text stays crisp and the same size at any zoom. */}
        <g>
          {layout.groups.map((g) => {
            const dim = litGroups ? !litGroups.has(g.key) : false;
            return (
              <text
                key={g.key}
                x={sx(g.center.x)}
                y={sy(g.center.z - g.radius - 1) - 7}
                textAnchor="middle"
                className={`map-territory ${dim ? "dim" : ""}`}
                onClick={() => (g.clusterId !== undefined ? onCluster(g.clusterId) : onGroup(g.key.slice(2)))}
              >
                <tspan fill={g.color}>{g.label}</tspan>
                <tspan className="count"> {g.count}</tspan>
              </text>
            );
          })}
          {pin && (
            <g transform={`translate(${sx(pin.x)} ${sy(pin.y)})`} className="map-pin">
              <circle r={22} fill="url(#map-pin-glow)" />
              <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" />
              <text y={-14} textAnchor="middle">{lit?.label}</text>
            </g>
          )}
          {(() => {
            const placed: { x: number; y: number }[] = [];
            return lit?.ranked.map((r) => {
            const p = point(r.id);
            if (!p) return null;
            const bx = sx(p.x) + 9, by = sy(p.y) - 9;
            if (placed.some((q) => Math.hypot(q.x - bx, q.y - by) < 15)) return null;
            placed.push({ x: bx, y: by });
            return (
              <g key={`rank-${r.id}`} transform={`translate(${sx(p.x) + 9} ${sy(p.y) - 9})`} className="map-rank">
                <circle r={8} />
                <text y={4} textAnchor="middle">{r.rank}</text>
              </g>
            );
            });
          })()}
        </g>
      </svg>

      {panelOpen && (
        <aside className="map-panel">
          <section>
            <div className="overline">O que a IA lembraria?</div>
            <form onSubmit={runProbe}>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Escreva uma pergunta como no chat…" />
              <button type="submit" disabled={probing || !question.trim()}>{probing ? "…" : "Testar"}</button>
            </form>
            {probeError && <p className="map-error">{probeError}</p>}
            {spread && <p className="map-warning">⚠ {spread}</p>}
            {probe && (
              <div className="probe-result">
                <header>
                  <strong>{probe.selected.length ? `${probe.selected.length} entrariam no contexto` : "Nenhuma memória entraria"}</strong>
                  <button className="link" onClick={clearRecall}>Limpar</button>
                </header>
                {!probe.embeddings && <p className="hint">Sem embeddings agora: só palavras contam.</p>}
                <ol>
                  {probe.selected.map((s) => (
                    <li key={s.id} onClick={() => onSelect(s.id)} className={s.id === selectedId ? "active" : ""}>
                      <b>{s.rank}</b>
                      <span>
                        {s.title}
                        <small>
                          {s.titleMatches.length ? `título: ${s.titleMatches.join(", ")} · ` : ""}
                          {percent(s.similarity)} parecida · nota {s.score?.toFixed(1) ?? "—"}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
                {probe.near.length > 0 && (
                  <>
                    <div className="overline near">Quase entraram</div>
                    <ul>
                      {probe.near.slice(0, 5).map((n) => (
                        <li key={n.id} onClick={() => onSelect(n.id)}>
                          <i />
                          <span>
                            {n.title}
                            <small>{n.why}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>
          {!probe && (
            <section>
              <div className="overline">Últimas lembranças</div>
              {!recents.length && <p className="hint">Quando o chat usar memórias, as respostas aparecem aqui.</p>}
              <ul className="recents">
                {recents.map((r) => (
                  <li key={r.id} className={activeRecent?.id === r.id ? "active" : ""} onClick={() => setActiveRecent(activeRecent?.id === r.id ? null : r)}>
                    <span className="prompt">{r.prompt || "(sem pergunta)"}</span>
                    <small>
                      {r.conversationTitle} · {when(r.at)} · <em className={r.used.length >= 8 ? "many" : ""}>usou {r.used.length}</em>
                      {r.created.length ? ` · criou ${r.created.length}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      )}

      <div className="map-legend">
        {(Object.keys(HEALTH) as (keyof typeof HEALTH)[]).map((k) => (
          <span key={k}>
            <i style={{ background: HEALTH[k].color }} /> {HEALTH[k].label} <b>{counts[k]}</b>
          </span>
        ))}
        <span><i className="ring" /> Repetida</span>
        <span className="muted">Tamanho = vezes usada</span>
      </div>
      <div className="map-zoom">
        <button onClick={() => zoomAt(1.3, size.w / 2, size.h / 2)} aria-label="Aproximar">+</button>
        <button onClick={() => zoomAt(1 / 1.3, size.w / 2, size.h / 2)} aria-label="Afastar">−</button>
        <button onClick={() => { touched.current = false; setView(fitView()); }} aria-label="Enquadrar tudo">⤢</button>
      </div>
      {hover && byId.get(hover.id) && (() => {
        const m = byId.get(hover.id)!;
        const rect = box.current!.getBoundingClientRect();
        const g = groupOf(m.cluster !== undefined ? `c${m.cluster}` : `g:${groupKey(m)}`);
        return (
          <div className="map-tip" style={{ left: hover.x - rect.left + 14, top: hover.y - rect.top - 10 }}>
            <strong>{m.title}</strong>
            <small>
              {m.stats ? `${m.stats.uses}× usada · ajudou ${m.stats.helped} · falhou ${m.stats.failed}` : "sem registro de uso"}
              {g ? ` · ${g.label}` : ""}
            </small>
          </div>
        );
      })()}
    </div>
  );
}
