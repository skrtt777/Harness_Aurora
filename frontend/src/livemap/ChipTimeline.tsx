import { useEffect, useRef } from "react";

/**
 * The chip's timeline: from the first memory written to now. Bars are memories written per stretch of time, gold
 * ticks the answers that used memory, red ticks what was forgotten (all real). Drag to go back; play to watch the
 * memory grow; "ao vivo" to come back to now.
 */
export default function ChipTimeline({ t0, t1, value, playing, buckets, onChange, onPlay, onLive }: {
  t0: number; t1: number; value: number | null; playing: boolean;
  buckets: { born: number[]; gone: number[]; asked: number[] };
  onChange: (t: number) => void; onPlay: () => void; onLive: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = c.clientWidth, H = c.clientHeight;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const n = buckets.born.length, bw = W / n, max = Math.max(1, ...buckets.born);
    for (let i = 0; i < n; i += 1) {
      const h = (buckets.born[i] / max) * (H - 8);
      if (h > 0) { g.fillStyle = "rgba(92,242,200,0.55)"; g.fillRect(i * bw + 0.5, H - h, Math.max(1, bw - 1), h); }
      if (buckets.asked[i]) { g.fillStyle = "#E2B85C"; g.fillRect(i * bw, 0, Math.max(1.5, bw - 1), Math.min(6, 2 + buckets.asked[i])); }
      if (buckets.gone[i]) { g.fillStyle = "#ff8a7a"; g.fillRect(i * bw, H - 3, Math.max(1.5, bw - 1), 3); }
    }
  }, [buckets]);
  const t = value ?? t1, u = (t - t0) / Math.max(1, t1 - t0);
  const fmt = (x: number) => new Date(x).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`mc-timeline ${value !== null ? "past" : ""}`}>
      <button onClick={onPlay} aria-label={playing ? "Pausar" : "Ver a memória crescer"} title="Ver a memória crescer desde a primeira lembrança">{playing ? "❚❚" : "▶"}</button>
      <div className="mc-tl-track">
        <canvas ref={ref} aria-hidden="true" />
        <input type="range" min={0} max={1000} value={Math.round(u * 1000)} aria-label="Momento da memória"
          onChange={(e) => onChange(t0 + (Number(e.target.value) / 1000) * (t1 - t0))} />
        <i style={{ left: `${u * 100}%` }} />
      </div>
      <span className="mc-tl-when">{value === null ? "agora" : fmt(t)}</span>
      <button className={value === null ? "on" : ""} onClick={onLive} title="Voltar ao presente">ao vivo</button>
    </div>
  );
}
