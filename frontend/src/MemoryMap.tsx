import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getRecentRecalls, probeRecall, type RecallResult, type RecentRecall } from "./api";
import { clusterColor, groupColor, groupKey, isCandidateLesson, memoryHealth, type Memory, type MemoryCluster } from "./data";

/**
 * The memory map an agent would actually use: a treemap. Every topic is a
 * block sized by how many memories it holds, with its health bar and the
 * titles of its memories readable in place; clicking a topic opens it, one
 * tile per memory. Next to it:
 *  - "what would the AI remember?" runs the chat's real selection for a
 *    question and lights up what would enter the context, ranked, plus what
 *    almost did;
 *  - "latest recalls" lights up what recent answers actually used.
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

type HealthKey = "helpful" | "used" | "unused" | "failing";
const HEALTH: Record<HealthKey, { color: string; label: string }> = {
  helpful: { color: "#4ade80", label: "Ajuda" },
  used: { color: "#5fd4c0", label: "Usada" },
  unused: { color: "#565d68", label: "Nunca usada" },
  failing: { color: "#f87171", label: "Atrapalha" },
};
const HEALTH_ORDER: HealthKey[] = ["helpful", "used", "unused", "failing"];
function healthOf(m: Memory): HealthKey {
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

// ---------- squarified treemap ----------
type Rect = { x: number; y: number; w: number; h: number };
function squarify<T>(input: { value: number; item: T }[], rect: Rect): { item: T; rect: Rect }[] {
  const total = input.reduce((s, i) => s + i.value, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const items = input.map((i) => ({ item: i.item, area: i.value * scale })).sort((a, b) => b.area - a.area);
  const out: { item: T; rect: Rect }[] = [];
  const r = { ...rect };
  const worst = (row: { area: number }[], side: number) => {
    const s = row.reduce((t, i) => t + i.area, 0);
    const max = Math.max(...row.map((i) => i.area)), min = Math.min(...row.map((i) => i.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const place = (row: typeof items) => {
    const s = row.reduce((t, i) => t + i.area, 0);
    if (r.w >= r.h) {
      const w = s / r.h;
      let y = r.y;
      for (const i of row) { const h = i.area / w; out.push({ item: i.item, rect: { x: r.x, y, w, h } }); y += h; }
      r.x += w; r.w -= w;
    } else {
      const h = s / r.w;
      let x = r.x;
      for (const i of row) { const w = i.area / h; out.push({ item: i.item, rect: { x, y: r.y, w, h } }); x += w; }
      r.y += h; r.h -= h;
    }
  };
  let row: typeof items = [];
  for (let i = 0; i < items.length; ) {
    const side = Math.min(r.w, r.h);
    if (!row.length || worst([...row, items[i]], side) <= worst(row, side)) { row.push(items[i]); i += 1; }
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

type Topic = { key: string; label: string; color: string; clusterId?: number; members: Memory[] };
const topicKeyOf = (m: Memory) => (m.cluster !== undefined ? `c${m.cluster}` : `g:${groupKey(m)}`);

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export default function MemoryMap({ memories, visible, clusters, selectedId, onSelect, onCluster, onGroup }: Props) {
  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const topics = useMemo<Topic[]>(() => {
    const map = new Map<string, Topic>();
    for (const m of memories) {
      const key = topicKeyOf(m);
      if (!map.has(key)) {
        const clusterId = m.cluster;
        map.set(key, {
          key,
          clusterId,
          label: clusterId !== undefined ? clusters.find((c) => c.id === clusterId)?.label || "sem assunto" : groupKey(m),
          color: clusterId !== undefined ? clusterColor(clusterId, "#8a93a0") : groupColor(groupKey(m)),
          members: [],
        });
      }
      map.get(key)!.members.push(m);
    }
    return [...map.values()];
  }, [memories, clusters]);

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
  const lit = useMemo(() => {
    if (probe) return { rank: new Map(probe.selected.map((s) => [s.id, s.rank])), near: new Set(probe.near.map((n) => n.id)), created: new Set<string>() };
    if (activeRecent) return { rank: new Map(activeRecent.used.map((id, i) => [id, i + 1])), near: new Set<string>(), created: new Set(activeRecent.created) };
    return null;
  }, [probe, activeRecent]);
  const isHit = (id: string) => !!lit && (lit.rank.has(id) || lit.near.has(id) || lit.created.has(id));
  // A good recall is focused: many memories, or memories from many topics, is a smell.
  const spread = useMemo(() => {
    if (!lit?.rank.size) return null;
    const ids = [...lit.rank.keys()].filter((id) => byId.has(id));
    const n = new Set(ids.map((id) => topicKeyOf(byId.get(id)!))).size;
    if (ids.length >= 8) return `${ids.length} memórias de ${n} assuntos: contexto demais para uma resposta.`;
    if (n >= 3) return `Espalhada em ${n} assuntos: a lembrança está pouco focada.`;
    return null;
  }, [lit, byId]);

  // ---------- treemap ----------
  const [open, setOpen] = useState<string | null>(null);
  const openTopic = topics.find((t) => t.key === open) || null;
  const [area, size] = useSize<HTMLDivElement>();
  const GAP = 6;
  const blocks = useMemo(() => {
    const shown = topics.filter((t) => t.members.some((m) => visible.has(m.id)));
    return squarify(shown.map((t) => ({ value: t.members.filter((m) => visible.has(m.id)).length, item: t })), { x: 0, y: 0, w: size.w + GAP, h: size.h + GAP });
  }, [topics, visible, size]);
  // Narrow: blocks stack in a scrollable column instead of being squeezed.
  const stacked = size.w > 0 && (size.w < 620 || size.h < 300);
  useEffect(() => {
    if (open && !topics.some((t) => t.key === open)) setOpen(null);
  }, [open, topics]);

  const order = (list: Memory[]) => [...list].sort((a, b) => {
    const ra = lit?.rank.get(a.id) ?? (lit?.near.has(a.id) || lit?.created.has(a.id) ? 900 : 999);
    const rb = lit?.rank.get(b.id) ?? (lit?.near.has(b.id) || lit?.created.has(b.id) ? 900 : 999);
    return ra - rb || (b.stats?.uses ?? 0) - (a.stats?.uses ?? 0) || a.title.localeCompare(b.title);
  });
  const mark = (m: Memory) => {
    const rank = lit?.rank.get(m.id);
    if (rank) return <b className="rank">{rank}</b>;
    if (lit?.near.has(m.id)) return <i className="mark near" />;
    if (lit?.created.has(m.id)) return <i className="mark created" />;
    return <i className="mark" style={{ background: HEALTH[healthOf(m)].color }} />;
  };
  const healthBar = (members: Memory[]) => {
    const counts = { helpful: 0, used: 0, unused: 0, failing: 0 } as Record<HealthKey, number>;
    members.forEach((m) => (counts[healthOf(m)] += 1));
    return (
      <span className="health-bar" title={HEALTH_ORDER.map((k) => `${HEALTH[k].label}: ${counts[k]}`).join(" · ")}>
        {HEALTH_ORDER.map((k) => counts[k] > 0 && <i key={k} style={{ flex: counts[k], background: HEALTH[k].color }} />)}
      </span>
    );
  };
  const totals = useMemo(() => {
    const c = { helpful: 0, used: 0, unused: 0, failing: 0 } as Record<HealthKey, number>;
    memories.forEach((m) => (c[healthOf(m)] += 1));
    return c;
  }, [memories]);

  return (
    <div className="memory-map">
      <aside className="map-panel">
        <section>
          <div className="overline">O que a IA lembraria?</div>
          <form onSubmit={runProbe}>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Escreva uma pergunta como no chat…" />
            <button type="submit" disabled={probing || !question.trim()}>{probing ? "…" : "Testar"}</button>
          </form>
          {probeError && <p className="map-error">{probeError}</p>}
          {spread && <p className="map-warning">{spread}</p>}
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
            <div className="overline">
              Últimas lembranças
              {activeRecent && <button className="link" onClick={clearRecall}>Limpar</button>}
            </div>
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

      <div className="map-main">
        <div className="map-bar">
          {openTopic ? (
            <nav className="crumbs">
              <button onClick={() => setOpen(null)}>← Todos os assuntos</button>
              <span style={{ color: openTopic.color }}>{openTopic.label}</span>
              <small>{openTopic.members.length} memórias</small>
              <button className="filter" onClick={() => (openTopic.clusterId !== undefined ? onCluster(openTopic.clusterId) : onGroup(openTopic.label))}>Filtrar a lista</button>
            </nav>
          ) : (
            <span className="map-title">{topics.length} assuntos · {memories.length} memórias</span>
          )}
          <span className="map-legend" hidden={!!openTopic}>
            {HEALTH_ORDER.map((k) => (
              <span key={k}>
                <i style={{ background: HEALTH[k].color }} /> {HEALTH[k].label} <b>{totals[k]}</b>
              </span>
            ))}
          </span>
        </div>
        <div className={`treemap ${lit ? "lit" : ""} ${stacked || openTopic ? "scroll" : ""}`} ref={area}>
          {!openTopic && stacked &&
            order(memories)
              .reduce<Topic[]>((list, m) => {
                const t = topics.find((x) => x.key === topicKeyOf(m))!;
                if (visible.has(m.id) && !list.includes(t)) list.push(t);
                return list;
              }, [])
              .sort((a, b) => (lit ? 0 : b.members.length - a.members.length))
              .map((t) => {
                const members = order(t.members.filter((m) => visible.has(m.id)));
                const hits = lit ? members.filter((m) => isHit(m.id)).length : 0;
                return (
                  <section key={t.key} className={`topic-block stacked ${lit && !hits ? "faded" : ""}`} style={{ ["--topic" as string]: t.color }}>
                    <header onClick={() => setOpen(t.key)}>
                      <i style={{ background: t.color }} />
                      <strong>{t.label}</strong>
                      <small>{members.length}</small>
                      {hits > 0 && <em>{hits}</em>}
                    </header>
                    {healthBar(members)}
                    <ul>
                      {members.slice(0, 4).map((m) => (
                        <li key={m.id} className={`${m.id === selectedId ? "selected" : ""} ${lit && !isHit(m.id) ? "dim" : ""}`} onClick={() => onSelect(m.id)}>
                          {mark(m)}
                          <span>{m.title}</span>
                        </li>
                      ))}
                      {members.length > 4 && <li className="more" onClick={() => setOpen(t.key)}>+ {members.length - 4} memórias · abrir</li>}
                    </ul>
                  </section>
                );
              })}
          {!openTopic && !stacked &&
            blocks.map(({ item: t, rect }) => {
              const members = order(t.members.filter((m) => visible.has(m.id)));
              const hits = lit ? members.filter((m) => isHit(m.id)).length : 0;
              const rows = Math.max(0, Math.floor((rect.h - GAP - 62) / 24));
              const compact = rect.h - GAP < 74;
              const tiny = rect.w - GAP < 64 || rect.h - GAP < 38;
              return (
                <section
                  key={t.key}
                  className={`topic-block ${lit && !hits ? "faded" : ""} ${compact ? "compact" : ""} ${tiny ? "tiny" : ""}`}
                  style={{ left: rect.x, top: rect.y, width: rect.w - GAP, height: rect.h - GAP, ["--topic" as string]: t.color }}
                >
                  <header onClick={() => setOpen(t.key)} title="Abrir assunto">
                    <i style={{ background: t.color }} />
                    <strong>{t.label}</strong>
                    <small>{members.length}</small>
                    {hits > 0 && <em title={`${hits} na lembrança`}>{hits}</em>}
                  </header>
                  {!compact && healthBar(members)}
                  {!compact && (
                    <ul>
                      {members.slice(0, members.length > rows ? Math.max(0, rows - 1) : rows).map((m) => (
                        <li key={m.id} className={`${m.id === selectedId ? "selected" : ""} ${lit && !isHit(m.id) ? "dim" : ""}`} onClick={() => onSelect(m.id)} title={m.title}>
                          {mark(m)}
                          <span>{m.title}</span>
                          {(m.stats?.uses ?? 0) > 0 && <small>{m.stats!.uses}×</small>}
                        </li>
                      ))}
                      {members.length > rows && rows > 0 && (
                        <li className="more" onClick={() => setOpen(t.key)}>+ {members.length - rows + 1} memórias · abrir</li>
                      )}
                    </ul>
                  )}
                </section>
              );
            })}
          {openTopic && (
            <div className="tile-grid">
              {order(openTopic.members.filter((m) => visible.has(m.id))).map((m) => {
                const health = healthOf(m);
                return (
                  <button
                    key={m.id}
                    className={`memory-tile ${m.id === selectedId ? "selected" : ""} ${lit && !isHit(m.id) ? "dim" : ""} ${lit?.near.has(m.id) ? "near" : ""} ${lit?.created.has(m.id) ? "created" : ""} ${(m.duplicates?.length ?? 0) > 0 ? "duplicate" : ""}`}
                    style={{ ["--health" as string]: HEALTH[health].color }}
                    onClick={() => onSelect(m.id)}
                    title={m.title}
                  >
                    {lit?.rank.has(m.id) && <b className="rank">{lit.rank.get(m.id)}</b>}
                    <strong>{m.title}</strong>
                    <p>{m.content}</p>
                    <small>
                      {HEALTH[health].label}
                      {isCandidateLesson(m) ? " · lição candidata (vale menos até ajudar)" : ""}
                      {m.stats ? ` · ${m.stats.uses}× usada · ajudou ${m.stats.helped}${m.stats.failed ? ` · falhou ${m.stats.failed}` : ""}` : ""}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
