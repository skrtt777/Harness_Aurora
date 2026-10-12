// The Aurora panel inside MR/VR: the same pages as the screen (Conversa, Operação, Memórias, Projetos,
// Ajustes) drawn on a canvas on a plane in the room. Text drawn by us, never by the room's light, so it
// reads the same over passthrough. Pointing (a controller ray, a hand's pinch ray) or touching it with
// the index finger (poke) presses its buttons.
import * as THREE from "../vendor/three.module.js";

const W = 1280, H = 960;
const C = { bg: "rgba(14,19,40,0.94)", surface: "#1a2244", line: "#2a3561", fg: "#e8ecff", muted: "#9aa5cf", accent: "#b04bff", accent2: "#4bd9c4", warn: "#f6b93b", bad: "#ff6b6b", ok: "#3ddc97" };
const PAGES = [["conversa", "Conversa"], ["operacao", "Operação"], ["cenarios", "Cenários"], ["memorias", "Memórias"], ["projetos", "Projetos"], ["ajustes", "Ajustes"]];
const FONT = '"Segoe UI", system-ui, sans-serif';

export class Panel3D {
  constructor({ width = 0.62, onAction }) {
    this.canvas = document.createElement("canvas"); this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    const height = width * H / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.renderOrder = 10; this.mesh.userData.panel = this;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    // A grab bar under the panel: hold and move it (one hand or controller).
    this.bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, width * 0.25, 4, 10), new THREE.MeshBasicMaterial({ color: C.muted, transparent: true, opacity: 0.8 }));
    this.bar.rotation.z = Math.PI / 2; this.bar.position.y = -height / 2 - 0.025; this.bar.userData.panelBar = true; this.group.add(this.bar);
    this.onAction = onAction; this.regions = []; this.hover = null; this.textPage = 0; this.state = null;
  }
  get object() { return this.group; }

  /** The canvas point of a hit (uv from the raycaster). */
  pointAt(uv) { return uv ? { x: uv.x * W, y: (1 - uv.y) * H } : null; }
  regionAt(p) { return p && this.regions.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h); }
  setHover(p) { const r = this.regionAt(p); const key = r?.action || null; if (key !== this.hover) { this.hover = key; this.draw(this.state); } }
  press(p) {
    const r = this.regionAt(p); if (!r) return false;
    if (r.action === "text:prev") this.textPage = Math.max(0, this.textPage - 1);
    else if (r.action === "text:next") this.textPage += 1;
    else this.onAction?.(r.action, r.arg);
    this.draw(this.state); return true;
  }

  draw(s) {
    if (!s) return; this.state = s;
    const g = this.g; this.regions = [];
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg; round(g, 0, 0, W, H, 44); g.fill();
    g.strokeStyle = C.line; g.lineWidth = 3; round(g, 1.5, 1.5, W - 3, H - 3, 44); g.stroke();
    // Header: the Aurora, where it thinks (PC), the context.
    text(g, "Aurora", 48, 70, 44, C.fg, 700);
    text(g, s.context || "", 220, 70, 30, C.muted);
    const conn = s.connection || {}; const dot = conn.state === "ok" ? C.ok : conn.state === "bad" ? C.bad : C.warn;
    g.fillStyle = dot; g.beginPath(); g.arc(W - 330, 60, 10, 0, 7); g.fill();
    text(g, clip(g, conn.text || "", 260, 28), W - 310, 70, 28, C.muted);
    // Tabs.
    const tw = (W - 96) / PAGES.length;
    PAGES.forEach(([key, name], i) => {
      const x = 48 + i * tw; const on = s.page === key;
      this.button(x, 104, tw - 10, 64, name, `page:${key}`, { on, size: 30 });
    });
    const body = { x: 48, y: 196, w: W - 96, h: H - 196 - 40 };
    const page = { conversa: this.conversa, operacao: this.operacao, cenarios: this.cenarios, memorias: this.memorias, projetos: this.projetos, ajustes: this.ajustes }[s.page] || this.conversa;
    page.call(this, s, body);
    this.texture.needsUpdate = true;
  }

  button(x, y, w, h, label, action, { on = false, size = 30, tone = null, arg } = {}) {
    const g = this.g; const hover = this.hover === action;
    g.fillStyle = on ? C.accent : tone === "bad" ? "rgba(255,107,107,0.18)" : hover ? "#26305c" : C.surface;
    round(g, x, y, w, h, 18); g.fill();
    if (hover || tone) { g.strokeStyle = tone === "bad" ? C.bad : tone === "ok" ? C.ok : C.accent2; g.lineWidth = 3; round(g, x, y, w, h, 18); g.stroke(); }
    g.font = `600 ${size}px ${FONT}`; const t = clip(g, label, w - 24, size);
    g.fillStyle = on ? "#fff" : C.fg; g.textBaseline = "middle"; g.textAlign = "center"; g.fillText(t, x + w / 2, y + h / 2 + 1); g.textAlign = "left"; g.textBaseline = "alphabetic";
    this.regions.push({ x, y, w, h, action, arg });
  }

  /** Wrapped text in a box, in pages (◀ ▶ when it does not fit). */
  paragraph(str, b, size = 32, color = C.fg) {
    const g = this.g; g.font = `400 ${size}px ${FONT}`;
    const lines = wrap(g, str, b.w); const per = Math.max(1, Math.floor(b.h / (size * 1.35)));
    const pages = Math.max(1, Math.ceil(lines.length / per)); this.textPage = Math.min(this.textPage, pages - 1);
    lines.slice(this.textPage * per, this.textPage * per + per).forEach((l, i) => text(g, l, b.x, b.y + size + i * size * 1.35, size, color));
    if (pages > 1) {
      this.button(b.x + b.w - 250, b.y + b.h + 6, 110, 56, "◀", "text:prev");
      this.button(b.x + b.w - 120, b.y + b.h + 6, 110, 56, "▶", "text:next");
      text(this.g, `${this.textPage + 1}/${pages}`, b.x + b.w - 360, b.y + b.h + 44, 26, C.muted);
    }
  }

  conversa(s, b) {
    const last = [...(s.messages || [])].reverse().find((m) => m.role === "assistant");
    const you = [...(s.messages || [])].reverse().find((m) => m.role === "user");
    let y = b.y;
    if (you) { text(this.g, clip(this.g, `Você: ${you.content}`, b.w, 28), b.x, y + 30, 28, C.muted); y += 50; }
    if (s.approval) {
      this.paragraph(`A Aurora pede permissão: ${s.approval.description || s.approval.tool || "executar uma ação"}`, { x: b.x, y, w: b.w, h: 200 }, 32, C.warn);
      this.button(b.x, b.y + b.h - 90, 300, 80, "Permitir", "approve", { tone: "ok" });
      this.button(b.x + 320, b.y + b.h - 90, 300, 80, "Negar", "deny", { tone: "bad" });
      return;
    }
    const body = s.busy ? (s.partial ? `${s.partial} …` : s.stage || "Pensando…") : last?.content || "Toque em Falar e peça qualquer coisa. Ex.: \"mostra a operação\", \"o que mudou?\".";
    this.paragraph(body, { x: b.x, y, w: b.w, h: b.h - (y - b.y) - 180 }, 34, s.busy ? C.muted : C.fg);
    const by = b.y + b.h - 90; const bw = (b.w - 30) / 4;
    this.button(b.x, by, bw, 80, s.listening ? "Ouvindo… parar" : "Falar", "mic", { on: s.listening });
    this.button(b.x + bw + 10, by, bw, 80, s.busy ? "Cancelar" : "Repetir", s.busy ? "cancel" : "repeat");
    this.button(b.x + 2 * (bw + 10), by, bw, 80, "O que mudou?", "ask", { arg: "O que mudou na operação desde a última atualização?" });
    this.button(b.x + 3 * (bw + 10), by, bw, 80, "Resumo", "ask", { arg: "Resuma a operação do Power BI aberto agora, em 3 frases." });
  }

  operacao(s, b) {
    const L = s.twin; const g = this.g;
    if (!L) { this.paragraph("Carregando a operação…", b); return; }
    text(g, clip(g, L.title || "Operação", b.w - 260, 36), b.x, b.y + 36, 36, C.fg, 700);
    text(g, L.live?.text || "", b.x + b.w - 250, b.y + 36, 26, L.live?.stale ? C.warn : C.muted);
    let y = b.y + 64;
    const cols = 3; const cw = (b.w - 20) / cols;
    L.numbers.slice(0, 6).forEach((n, i) => {
      const x = b.x + (i % cols) * (cw + 10); const yy = y + Math.floor(i / cols) * 106;
      g.fillStyle = C.surface; round(g, x, yy, cw, 96, 16); g.fill();
      text(g, clip(g, n.name, cw - 24, 24), x + 14, yy + 34, 24, C.muted);
      text(g, clip(g, n.value, cw - 24, 40), x + 14, yy + 80, 40, C.fg, 700);
    });
    y += Math.ceil(Math.min(6, L.numbers.length) / cols) * 106 + 8;
    if (s.picked) {
      const e = s.picked;
      text(g, clip(g, `${e.name} · ${e.status || ""}${e.place ? ` · ${e.place}` : ""}${e.late ? " · atrasado" : ""}`, b.w, 32), b.x, y + 34, 32, C.accent2, 700); y += 52;
    } else if (L.note) { text(g, clip(g, `Aurora: ${L.note}`, b.w, 30), b.x, y + 32, 30, "#d9b3ff"); y += 50; }
    (L.notes || []).slice(0, 2).forEach((n) => { text(g, clip(g, n, b.w, 26), b.x, y + 30, 26, C.muted); y += 40; });
    if (L.seal) text(g, L.seal.text, b.x, y + 34, 28, L.seal.ok ? C.ok : C.warn, 700);
    const by = b.y + b.h - 90;
    const units = (L.units || []).filter(Boolean);
    const bw = (b.w - 30) / 4;
    this.button(b.x, by, bw, 80, "Atualizar", "refresh");
    this.button(b.x + bw + 10, by, bw, 80, units.length > 1 ? `Unidade ${units.indexOf(L.unit) + 1}/${units.length}` : "Unidade única", "unit");
    this.button(b.x + 2 * (bw + 10), by, bw, 80, s.mode === "mr" ? "Pôr na mesa" : "Trazer maquete", "place");
    this.button(b.x + 3 * (bw + 10), by, bw, 80, s.twinVisible === false ? "Mostrar" : "Ocultar", "twin:toggle");
  }

  cenarios(s, b) {
    const g = this.g; const cur = s.view === "cenario" && s.scene;
    text(g, clip(g, cur ? s.scene.title : "Cenários", b.w, 36), b.x, b.y + 36, 36, C.fg, 700);
    const say = s.sceneBusy ? `A Aurora está montando: ${s.scenePrompt}…` : cur ? `${s.scene.items.length} coisas. Pegue qualquer uma com a mão: ela cresce para você ver de perto e volta ao lugar quando você solta.${s.scene.note ? ` Aurora: ${s.scene.note}` : ""}`
      : "Toque em Falar e peça uma maquete: \"faz uma fazenda com vacas e um trator\". Ou escolha um exemplo.";
    this.paragraph(say, { x: b.x, y: b.y + 50, w: b.w, h: 150 }, 28, s.sceneBusy ? C.warn : C.muted);
    const ex = ["Uma fazenda com vacas, cavalos e um trator", "Uma cidade com carros andando", "O sistema solar", "Um parque de dinossauros"];
    const bw = (b.w - 10) / 2;
    ex.forEach((x, i) => this.button(b.x + (i % 2) * (bw + 10), b.y + 220 + Math.floor(i / 2) * 90, bw, 80, x, "scene:make", { arg: x, size: 26 }));
    const by = b.y + b.h - 90; const cw = (b.w - 30) / 4;
    this.button(b.x, by, cw, 80, s.listening ? "Ouvindo… parar" : "Falar", "mic", { on: s.listening });
    this.button(b.x + cw + 10, by, cw, 80, "Operação", "view:operacao", { on: s.view === "operacao" });
    this.button(b.x + 2 * (cw + 10), by, cw, 80, s.scenes?.length ? `Outra (${s.scenes.length})` : "Nenhuma salva", "scene:next");
    this.button(b.x + 3 * (cw + 10), by, cw, 80, s.mode === "mr" ? "Pôr na mesa" : "Trazer maquete", "place");
  }

  list(items, b, action, current) {
    const per = 6; const pages = Math.max(1, Math.ceil(items.length / per)); this.textPage = Math.min(this.textPage, pages - 1);
    if (!items.length) { this.paragraph("Nada aqui ainda.", b, 32, C.muted); return; }
    items.slice(this.textPage * per, this.textPage * per + per).forEach((it, i) => {
      const y = b.y + i * 98;
      this.button(b.x, y, b.w, 88, "", `${action}`, { on: it.id === current, arg: it.id });
      text(this.g, clip(this.g, it.title, b.w - 40, 32), b.x + 22, y + 40, 32, it.id === current ? "#fff" : C.fg, 600);
      if (it.sub) text(this.g, clip(this.g, it.sub, b.w - 40, 24), b.x + 22, y + 74, 24, it.id === current ? "#f1e3ff" : C.muted);
    });
    if (pages > 1) { this.button(b.x + b.w - 250, b.y + b.h - 64, 110, 56, "◀", "text:prev"); this.button(b.x + b.w - 120, b.y + b.h - 64, 110, 56, "▶", "text:next"); }
  }
  memorias(s, b) { this.list((s.memories || []).map((m) => ({ id: m.id, title: m.title || "(sem título)", sub: m.content })), b, "memory"); }
  projetos(s, b) { this.list([{ id: "", title: "Conversa geral", sub: "Sem projeto" }, ...(s.projects || []).map((p) => ({ id: p.id, title: p.name, sub: p.description || "" }))], b, "project", s.projectId || ""); }

  ajustes(s, b) {
    const t = s.tracking || {}; const g = this.g;
    const rows = [
      ["Modo", s.modeLabel || s.mode],
      ["Mãos", t.hands ? `rastreadas (${t.hands})` : "não rastreadas"],
      ["Controles", t.controllers ? String(t.controllers) : "nenhum"],
      ["Superfícies", t.planes != null ? `${t.planes} detectadas` : "—"],
      ["Âncora", t.anchor ? "presa no lugar" : "—"],
      ["Movimento", t.walking ? "andando (o painel acompanha)" : "parado"],
    ];
    rows.forEach(([k, v], i) => { text(g, k, b.x, b.y + 36 + i * 46, 28, C.muted); text(g, v, b.x + 230, b.y + 36 + i * 46, 28, C.fg); });
    const by = b.y + b.h - 180; const bw = (b.w - 20) / 3;
    this.button(b.x, by, bw, 80, "Trazer painel", "recenter");
    this.button(b.x + bw + 10, by, bw, 80, s.follow ? "Seguir: ligado" : "Seguir: desligado", "follow", { on: s.follow });
    this.button(b.x + 2 * (bw + 10), by, bw, 80, s.speakReplies ? "Voz: ligada" : "Voz: desligada", "voice", { on: s.speakReplies });
    this.button(b.x, by + 90, b.w, 80, "Sair do modo imersivo", "exit", { tone: "bad" });
  }
}

function round(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function text(g, s, x, y, size, color, weight = 400) { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.fillText(s, x, y); }
function clip(g, s, w, size) {
  g.font = g.font.replace(/\d+px/, `${size}px`); s = String(s ?? "");
  if (g.measureText(s).width <= w) return s;
  while (s.length > 1 && g.measureText(s + "…").width > w) s = s.slice(0, -1);
  return s + "…";
}
function wrap(g, str, w) {
  const out = [];
  for (const para of String(str || "").split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
