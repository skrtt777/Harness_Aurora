import { useEffect, useRef, useState } from 'react';

/**
 * The chat backdrop: curtains of an aurora borealis made of 0s and 1s,
 * rippling slowly across the top of the screen, in the Hermes manner (near
 * black and white, calm). Each curtain has a bright continuous hem with rays
 * rising from it and fading; the digits carry a faint aurora tint (mint at
 * the hem, ice in the rays, lavender at the tips), kept close to white so it
 * never competes with the conversation.
 *
 * `active` (the person is typing) makes the curtains ripple more; `busy` (the
 * Aurora is working) sends a wave of light along them. One still frame under
 * reduced motion. Fills its parent.
 */
type Props = { active?: boolean; busy?: boolean };

/** Curtains: [base height (0..1 of h), amplitude, wavelength, speed, phase, ray height]. */
const CURTAINS: [number, number, number, number, number, number][] = [
  [0.42, 0.09, 0.0028, 0.00011, 0.0, 0.11],
  [0.3, 0.06, 0.0041, -0.00008, 2.1, 0.08],
  [0.52, 0.08, 0.0022, 0.00006, 4.0, 0.13],
];

// Art tints: the UI ink (--base) mixed ~55% toward aurora hues. Hem, rays, tips.
const TINTS = ['#b5eedc', '#bee1fb', '#d2ccfa'];

export default function AuroraCurtains({ active = false, busy = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mood = useRef({ active, busy });
  mood.current = { active, busy };
  const clock = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => { const r = parent.getBoundingClientRect(); setSize((s) => (Math.abs(s.w - r.width) < 4 && Math.abs(s.h - r.height) < 4 ? s : { w: Math.round(r.width), h: Math.round(r.height) })); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const { w, h } = size;
    if (!canvas || !ctx || !w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const font = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'monospace';

    const cw = 9, ch = 12;
    const cols = Math.ceil(w / cw), rows = Math.ceil(h / ch);
    const digits = Array.from({ length: cols * rows }, () => (Math.random() < 0.5 ? '0' : '1'));
    let energy = 0, glow = 0;
    // Animation time, advanced frame by frame: typing speeds it up from here on. It was
    // `now * (1 + energy * 1.5)`, which rescaled all the time since the app opened, so the
    // curtains spun through minutes of motion in a second when typing started or stopped.
    // Kept in a ref so a resize (which redraws the canvas) does not send the curtains back to the start.
    let prev = 0;

    const draw = (now: number) => {
      const { active: typing, busy: working } = mood.current;
      energy += ((typing ? 1 : 0) - energy) * 0.04;
      glow += ((working ? 1 : 0) - glow) * 0.04;
      // A long gap (hidden tab, first frame) counts as one frame, never as a jump.
      clock.current += Math.min(now - prev, 100) * (1 + energy * 1.5);
      prev = now;
      const t = clock.current;
      for (let k = 0; k < 40; k++) { const i = (Math.random() * digits.length) | 0; digits[i] = digits[i] === '0' ? '1' : '0'; }
      ctx.clearRect(0, 0, w, h);
      ctx.font = `600 ${ch - 1}px ${font}`;
      ctx.textBaseline = 'top';
      for (let col = 0; col < cols; col++) {
        const x = col * cw;
        // Each curtain: its lower edge is a slow wave; rays rise from it and fade.
        const edges = CURTAINS.map(([base, amp, wl, speed, phase, ray], c) => {
          const y = h * (base + amp * (1 + energy * 0.6) * Math.sin(x * wl + t * speed + phase) + amp * 0.4 * Math.sin(x * wl * 2.7 - t * speed * 1.7 + c));
          // Vertical striation, drifting sideways: the "rays" of the aurora.
          const s = 0.5 + 0.5 * Math.sin(x * 0.045 + t * 0.0004 + c * 3) * Math.sin(x * 0.013 - t * 0.00023 + c);
          // A brightness wave travelling along the curtain while she works.
          const pulse = glow * Math.max(0, Math.sin(x * 0.006 - now * 0.002 + c)) ** 6 * 0.6;
          return { y, ray: h * ray, rays: 0.12 + 0.9 * s ** 3, pulse };
        });
        for (let row = 0; row < rows; row++) {
          const y = row * ch;
          let v = 0, height = 0; // height: 0 at the hem, 1 at the tips of the rays
          for (const e of edges) {
            const above = e.y - y;
            const reach = e.ray * (0.4 + e.rays);
            // Long soft rays above the edge, sharp falloff below it.
            const ray = (above >= 0 ? Math.exp(-above / reach) : Math.exp(above / 8)) * (e.rays + e.pulse);
            // The continuous bright hem at the bottom of each curtain.
            const hem = Math.exp(-Math.abs(above) / 7) * (0.62 + e.pulse);
            if (ray > v) { v = ray; height = Math.min(1, Math.max(0, above / reach)); }
            if (hem > v) { v = hem; height = 0; }
          }
          // Fade toward the bottom, where the conversation sits.
          v *= Math.min(1, Math.max(0, (h * 0.78 - y) / (h * 0.3)));
          if (v < 0.12) continue;
          // "0" in the bright core, "1" in the faint rays, a flickering mix between.
          const glyph = v > 0.75 ? '0' : v < 0.35 ? '1' : digits[row * cols + col];
          ctx.fillStyle = TINTS[height < 0.15 ? 0 : height < 0.6 ? 1 : 2];
          ctx.globalAlpha = Math.min(0.95, (v - 0.12) * 0.9);
          ctx.fillText(glyph, x, y);
        }
      }
      ctx.globalAlpha = 1;
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0, last = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30 fps
      last = now;
      draw(now);
    };
    if (reduced) draw(performance.now()); else frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return <canvas ref={ref} className="aurora-curtains" aria-hidden="true" />;
}
