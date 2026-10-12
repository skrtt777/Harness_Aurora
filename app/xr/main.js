// Aurora XR: the Aurora of the PC in any device. The same app on the headset (mixed reality with
// passthrough, or VR; hands and controllers), on the phone (AR on a table, or 3D that follows the
// phone's movement) and on the PC (3D beside the panel). It talks to the XR bridge of the PC
// (app/xrBridge.js), or, opened from "ver em 3D" (app/twinServer.js), only reads the operation.
import { createBridgeClient, createTwinClient, createChat } from "./lib/api.js";
import { twinLayout } from "./lib/twinLayout.js";
import { deviceProfile, sessionInit, MODE_LABEL } from "./lib/device.js";
import { voiceCommand, VOICE_HELP, downsample, encodeWav, toBase64, SilenceGate } from "./lib/voice.js";
import { Stage } from "./xr/stage.js";
import { legend } from "./xr/twin3d.js";

const $ = (id) => document.getElementById(id);
const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* private window */ } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Bridge mode at /xr/app/; anywhere else (the twin server's random path) it reads ./state only.
const bridgeMode = location.pathname.startsWith("/xr/app");
const client = bridgeMode ? createBridgeClient({ storage }) : createTwinClient();
const chat = bridgeMode ? createChat(client, storage) : null;

const S = {
  page: bridgeMode ? storage.get("aurora-xr-page") || "conversa" : "operacao",
  connection: { state: "wait", text: "Conectando…" },
  context: "Conversa geral", projectId: storage.get("aurora-xr-project") || "",
  messages: [], busy: false, stage: "", partial: "", approval: null, listening: false,
  twin: null, twinRaw: null, unit: "", picked: null, twinVisible: true,
  memories: [], memoryQuery: "", projects: [],
  mode: "3d", modeLabel: "3D", follow: true, speakReplies: storage.get("aurora-xr-voice") !== "0",
  tracking: {}, pairing: null, motion: false,
};

async function xrSupport(mode) { try { return !!(await navigator.xr?.isSessionSupported(mode)); } catch { return false; } }
const facts = { width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints > 0, coarse: matchMedia("(pointer: coarse)").matches, ua: navigator.userAgent, ar: await xrSupport("immersive-ar"), vr: await xrSupport("immersive-vr") };
let profile = deviceProfile(facts);

const stage = new Stage({
  canvas: $("view"), profile, storage,
  onPick: (e) => { S.picked = e; if (e && S.page !== "operacao" && S.mode === "3d") S.page = "operacao"; render(); },
  onPanelAction: (a, arg) => act(a, arg),
  onTracking: (t) => { S.tracking = t; if (S.page === "ajustes") render(); },
  onModeChange: (m) => { S.mode = m; S.modeLabel = MODE_LABEL[m] || m; document.body.classList.toggle("in-ar", m === "ar"); render(); hint(m === "mr" ? "Olhe para uma mesa e faça a pinça para pôr a maquete. Palma aberta virada para você chama o painel." : m === "ar" ? "Aponte para uma mesa e toque para pôr a maquete." : m === "vr" ? "A maquete está na mesa. Aperte o gatilho (ou faça a pinça) para mexer." : ""); },
});

// ---------- Layout (responsive) ----------
function applyLayout() {
  profile = deviceProfile({ ...facts, width: innerWidth, height: innerHeight });
  $("app").dataset.layout = profile.layout;
  $("motion").hidden = !(profile.kind === "phone" || profile.kind === "tablet");
}
addEventListener("resize", applyLayout);
applyLayout();

function modeButtons() {
  const box = $("modes"); box.innerHTML = "";
  if (S.mode !== "3d") { const b = document.createElement("button"); b.className = "exit primary"; b.textContent = "Sair"; b.onclick = () => stage.exit(); box.append(b); return; }
  profile.modes.forEach((m, i) => {
    const b = document.createElement("button"); b.textContent = MODE_LABEL[m]; if (i === 0) b.className = "primary";
    b.onclick = () => enterMode(m); box.append(b);
  });
}
async function enterMode(m) {
  try {
    await stage.enter(m, sessionInit(profile, m, m === "ar" ? document.body : null));
  } catch (e) { hint(`Não abriu o modo ${MODE_LABEL[m]}: ${e.message}`); }
}
let hintTimer;
function hint(text) { const h = $("hint"); h.hidden = !text; h.textContent = text; clearTimeout(hintTimer); if (text) hintTimer = setTimeout(() => { h.hidden = true; }, 7000); }

// ---------- Rendering (screen and panel in the room) ----------
function render() {
  modeButtons();
  const conn = $("conn"); conn.dataset.state = S.connection.state; conn.textContent = S.connection.text;
  $("ctx").textContent = S.context;
  for (const b of $("tabs").querySelectorAll("button")) {
    b.setAttribute("aria-selected", String(b.dataset.page === S.page));
    b.hidden = !bridgeMode && b.dataset.page !== "operacao";
  }
  const L = S.twin;
  $("live").textContent = L?.live?.text || ""; $("live").classList.toggle("stale", !!L?.live?.stale);
  $("seal").textContent = L?.seal?.text || ""; $("seal").classList.toggle("partial", L?.seal && !L.seal.ok);
  const page = $("page"); const keep = page.querySelector("textarea")?.value;
  page.innerHTML = PAGES[S.page]?.() || "";
  const ta = page.querySelector("textarea"); if (ta && keep) ta.value = keep;
  const msgs = page.querySelector(".msgs"); if (msgs) page.scrollTop = page.scrollHeight;
  stage.setPanel({ ...S });
}

const PAGES = {
  conversa() {
    const msgs = S.messages.slice(-30).map((m) => `<div class="msg ${m.role === "user" ? "user" : "assistant"}">${esc(m.content)}</div>`).join("");
    const live = S.busy ? `<div class="msg stage">${esc(S.partial ? `${S.partial} …` : S.stage || "Pensando…")}</div>` : "";
    const approval = S.approval ? `<div class="approval"><b>A Aurora pede permissão</b><span>${esc(S.approval.description || S.approval.tool || "executar uma ação")}</span><div class="row"><button class="btn primary" data-act="approve">Permitir</button><button class="btn danger" data-act="deny">Negar</button></div></div>` : "";
    const empty = !S.messages.length && !S.busy ? `<div class="empty">Converse com a mesma Aurora do seu PC: memórias, projetos e o Power BI aberto.<br>${esc(VOICE_HELP)}</div>` : "";
    return `<div class="msgs">${empty}${msgs}${live}</div>${approval}
      <div class="chips"><button class="chip" data-act="ask" data-arg="O que mudou na operação desde a última atualização?">O que mudou?</button><button class="chip" data-act="ask" data-arg="Resuma a operação do Power BI aberto agora, em 3 frases.">Resumo da operação</button></div>
      <form class="composer" data-act="send"><textarea rows="1" name="text" placeholder="Pergunte à Aurora…" aria-label="Mensagem"></textarea>
      <button type="button" class="round mic" data-act="mic" aria-pressed="${S.listening}" title="Falar">${S.listening ? "■" : "🎙"}</button>
      <button class="round" title="Enviar" ${S.busy ? "disabled" : ""}>➤</button></form>`;
  },
  operacao() {
    const L = S.twin;
    if (!L) return `<div class="empty">Carregando a operação…</div>`;
    if (!L.operation) return `<h2 class="op-title">${esc(L.title || "Nenhum Power BI aberto")}</h2><p class="muted">${L.title ? "Este painel tem só números (sem lugares e entidades para a maquete)." : "Peça à Aurora para abrir um Power BI (ex.: \"monta um BI da operação\") e a maquete aparece aqui."}</p>${nums(L)}`;
    const units = L.units.filter(Boolean);
    const unitSel = units.length > 1 ? `<div class="chips">${units.map((u) => `<button class="chip" data-act="unit" data-arg="${esc(u)}" ${u === L.unit ? 'style="border-color:var(--accent);color:var(--fg)"' : ""}>${esc(u)}</button>`).join("")}</div>` : "";
    const p = S.picked ? `<div class="picked"><h3>${esc(S.picked.name)}</h3><dl class="kv">${S.picked.status ? `<dt>Etapa</dt><dd>${esc(S.picked.status)}</dd>` : ""}${S.picked.place ? `<dt>Lugar</dt><dd>${esc(S.picked.place)}</dd>` : ""}${S.picked.waited != null ? `<dt>Espera</dt><dd>${esc(S.picked.waited)} min</dd>` : ""}<dt>Prazo</dt><dd>${S.picked.late ? "atrasado" : "no prazo"}</dd></dl></div>` : `<p class="muted">Toque num ${esc(singular(L.noun))} da maquete para ver os detalhes.</p>`;
    return `<h2 class="op-title">${esc(L.title)}</h2>${unitSel}${nums(L)}
      ${L.note ? `<div class="note">Aurora: ${esc(L.note)}</div>` : ""}${p}
      <div class="legend">${legend(S.twinRaw).map((x) => `<span><i style="background:${esc(x.color)}"></i>${esc(x.text)}</span>`).join("")}</div>
      ${L.notes.length ? `<div class="section"><h3>O que mudou</h3><ul class="list">${L.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
      <div class="chips"><button class="chip" data-act="refresh">Atualizar</button><button class="chip" data-act="twin:toggle">${S.twinVisible ? "Ocultar maquete" : "Mostrar maquete"}</button></div>`;
  },
  memorias() {
    const items = S.memories.filter((m) => !S.memoryQuery || `${m.title} ${m.content}`.toLowerCase().includes(S.memoryQuery.toLowerCase()));
    return `<input class="search" type="search" data-input="memoryQuery" placeholder="Buscar nas memórias" value="${esc(S.memoryQuery)}">
      ${items.length ? `<ul class="list">${items.slice(0, 80).map((m) => `<li><b>${esc(m.title || "(sem título)")}</b><small>${esc(String(m.content || "").slice(0, 220))}</small></li>`).join("")}</ul>` : `<div class="empty">Nenhuma memória${S.memoryQuery ? " com essa busca" : ""}.</div>`}`;
  },
  projetos() {
    const all = [{ id: "", name: "Conversa geral", description: "Sem projeto" }, ...S.projects];
    return `<ul class="list">${all.map((p) => `<li aria-current="${p.id === S.projectId}"><button data-act="project" data-arg="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.description || "")}</small></button></li>`).join("")}</ul>`;
  },
  ajustes() {
    const t = S.tracking;
    return `<div class="section"><h3>Este aparelho</h3><dl class="kv"><dt>Tipo</dt><dd>${esc({ headset: "Óculos", phone: "Celular", tablet: "Tablet", desktop: "Computador" }[profile.kind])}</dd>
      <dt>Modos</dt><dd>${esc(profile.modes.map((m) => MODE_LABEL[m]).join(" · ") || "3D (sem WebXR neste navegador)")}</dd>
      <dt>Mãos</dt><dd>${t.hands ? `rastreadas (${t.hands})` : "—"}</dd><dt>Superfícies</dt><dd>${t.planes ?? "—"}</dd><dt>Âncora</dt><dd>${t.anchor ? "maquete presa na mesa" : "—"}</dd><dt>Movimento</dt><dd>${t.walking ? "andando" : "parado"}</dd></dl></div>
      <div class="section"><h3>Preferências</h3><div class="chips">
      <button class="chip" data-act="voice" aria-pressed="${S.speakReplies}">${S.speakReplies ? "Aurora fala as respostas: sim" : "Aurora fala as respostas: não"}</button>
      <button class="chip" data-act="follow">${S.follow ? "Painel acompanha ao andar: sim" : "Painel acompanha ao andar: não"}</button></div></div>
      ${bridgeMode ? `<div class="section"><h3>Parear aparelho</h3>${S.pairing ? `<p>Digite no óculos ou no celular:</p><div class="code-big">${esc(S.pairing.code)}</div><p class="muted">Vale por 2 minutos. Abra no aparelho: ${S.pairing.addresses.map((a) => `<b>https://${esc(a)}:8788/xr/app/</b>`).join(" ou ")}</p>` : `<p class="muted">Gera um código para o óculos ou o celular (só funciona no próprio PC).</p>`}<div class="chips"><button class="chip" data-act="pairing">Gerar código</button><button class="chip" data-act="forget">Esquecer este aparelho</button></div></div>` : ""}`;
  },
};
function nums(L) { return L.numbers.length ? `<div class="nums">${L.numbers.map((n) => `<div class="num"><span>${esc(n.name)}</span><b>${esc(n.value)}</b></div>`).join("")}</div>` : ""; }
function singular(noun) { return String(noun || "item").replace(/ões$/, "ão").replace(/ns$/, "m").replace(/es$/, "").replace(/s$/, "") || "item"; }

// ---------- Actions (screen buttons, panel buttons, voice) ----------
async function act(a, arg) {
  if (a.startsWith("page:")) { S.page = a.slice(5); storage.set("aurora-xr-page", S.page); render(); return loadPage(); }
  switch (a) {
    case "send": case "ask": return send(arg);
    case "mic": return S.listening ? stopListening(true) : listen();
    case "repeat": { const last = [...S.messages].reverse().find((m) => m.role === "assistant"); if (last) speak(last.content); return; }
    case "cancel": if (chat?.id) client.cancel(chat.id).catch(() => {}); return;
    case "approve": case "deny": if (S.approval && chat?.id) { await client.approve(chat.id, S.approval.id, a === "approve").catch((e) => hint(e.message)); S.approval = null; render(); } return;
    case "refresh": return loadTwin(true);
    case "unit": { const units = S.twin?.units.filter(Boolean) || []; S.unit = arg || units[(units.indexOf(S.twin.unit) + 1) % units.length] || ""; S.picked = null; return drawTwin(); }
    case "twin:toggle": S.twinVisible = !S.twinVisible; stage.showTwin(S.twinVisible); return render();
    case "place": stage.place(); hint(S.mode === "mr" || S.mode === "ar" ? "Olhe (ou aponte) para a mesa e confirme com a pinça ou um toque." : ""); return;
    case "recenter": return stage.recenter();
    case "follow": S.follow = !S.follow; stage.follow = S.follow; return render();
    case "voice": S.speakReplies = !S.speakReplies; storage.set("aurora-xr-voice", S.speakReplies ? "1" : "0"); return render();
    case "exit": return stage.exit();
    case "project": S.projectId = arg || ""; storage.set("aurora-xr-project", S.projectId); chat.use(""); S.messages = []; await loadContext(); S.page = "conversa"; return render();
    case "memory": return;
    case "pairing": try { S.pairing = await (await fetch("/xr/v1/pairing", { method: "POST" })).json(); if (!S.pairing.code) throw new Error(S.pairing.error); } catch (e) { S.pairing = null; hint(e.message || "Só no próprio PC."); } return render();
    case "forget": client.forget(); location.reload(); return;
  }
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-page]"); if (tab) return act(`page:${tab.dataset.page}`);
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "FORM") return;
  e.preventDefault(); act(b.dataset.act, b.dataset.arg);
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-act='send']"); if (!f) return;
  e.preventDefault(); const text = f.text.value.trim(); if (!text) return; f.text.value = ""; send(text);
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && e.target.matches(".composer textarea")) { e.preventDefault(); e.target.form.requestSubmit(); } });
document.addEventListener("input", (e) => { const k = e.target.dataset?.input; if (k) { S[k] = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector(`[data-input="${k}"]`); el?.focus(); el?.setSelectionRange(pos, pos); } });
$("recenter").onclick = () => stage.recenter();
$("motion").onclick = async () => { S.motion = await stage.motionView(!S.motion); $("motion").setAttribute("aria-pressed", String(S.motion)); };

// ---------- Conversation ----------
async function send(text) {
  if (!chat || S.busy || !text) return;
  const command = voiceCommand(text);
  if (command && command !== "help") return runCommand(command);
  S.messages.push({ role: "user", content: text }); S.busy = true; S.stage = "Enviando ao PC…"; S.partial = ""; S.page = S.page === "operacao" && S.mode !== "3d" ? S.page : "conversa"; render();
  try {
    const reply = await chat.send(text, { projectId: S.projectId, onStage: (p) => { S.stage = p.stage || S.stage; S.partial = p.partial || ""; S.approval = p.approval || null; render(); } });
    S.messages.push({ role: "assistant", content: reply.content || "(sem resposta)" });
    if (S.speakReplies) speak(reply.content);
  } catch (e) {
    S.messages.push({ role: "assistant", content: e.status === 409 ? "A conexão caiu no meio do pedido. Confira a conversa no PC antes de repetir." : `Não consegui: ${e.message}` });
  } finally { S.busy = false; S.stage = ""; S.partial = ""; S.approval = null; render(); }
  if (/power bi|operação|maquete|bi\b/i.test(text)) loadTwin(true);
}
function runCommand(c) {
  if (c === "stop") { audio?.stop?.(); speechSynthesis?.cancel?.(); if (S.busy && chat?.id) client.cancel(chat.id).catch(() => {}); return; }
  if (c === "repeat") return act("repeat");
  if (c.startsWith("page:")) return act(c);
  if (c === "recenter") return act("recenter");
  if (c === "place") return act("place");
  if (c === "refresh") return act("refresh");
}

// ---------- Voice: the PC transcribes (the same voice services the Quest app used) ----------
let mic = null; let audio = null;
async function listen() {
  if (!bridgeMode) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1); const chunks = []; const gate = new SilenceGate();
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let peak = 0; for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]));
      if (gate.update(peak, d.length / ctx.sampleRate)) stopListening(true);
    };
    src.connect(proc); proc.connect(ctx.destination);
    mic = { stream, ctx, proc, chunks }; S.listening = true; render();
  } catch (e) { hint(`Microfone indisponível: ${e.message}`); }
}
async function stopListening(submit) {
  if (!mic) return; const m = mic; mic = null; S.listening = false; render();
  m.proc.disconnect(); m.stream.getTracks().forEach((t) => t.stop());
  const rate = m.ctx.sampleRate; await m.ctx.close().catch(() => {});
  if (!submit) return;
  const all = new Float32Array(m.chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of m.chunks) { all.set(c, o); o += c.length; }
  if (all.length < rate * 0.3) return;
  S.stage = "Transcrevendo…"; S.busy = true; render();
  try {
    const r = await client.transcribe(toBase64(encodeWav(downsample(all, rate))));
    S.busy = false; const text = String(r.text || "").trim();
    if (!text) { hint("Não ouvi nada. Toque em Falar de novo."); render(); return; }
    const c = voiceCommand(text);
    if (c === "help") { S.messages.push({ role: "assistant", content: VOICE_HELP }); render(); return; }
    if (c) return runCommand(c);
    send(text);
  } catch (e) { S.busy = false; render(); hint(e.message); }
}
async function speak(text) {
  if (!text) return;
  try {
    if (S.caps && !S.caps.speech) throw new Error("sem voz neural");
    const r = await client.speak(text.slice(0, 1500));
    const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
    const ctx = new AudioContext(); const buf = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    audio = { stop: () => { try { src.stop(); ctx.close(); } catch { /* ended */ } } };
  } catch {
    // Without the PC's neural voice: the browser's own, when it has Portuguese.
    try { const u = new SpeechSynthesisUtterance(text.slice(0, 600)); u.lang = "pt-BR"; speechSynthesis.speak(u); } catch { /* no voice */ }
  }
}

// ---------- Data ----------
async function loadTwin(force = false) {
  try {
    const raw = await client.twin();
    if (!force && S.twinRaw && raw.updatedAt === S.twinRaw.updatedAt && raw.lastRefresh === S.twinRaw.lastRefresh) return;
    S.twinRaw = raw; drawTwin();
  } catch (e) { if (!S.twin) { S.twin = twinLayout(null); S.twin.title = `Operação indisponível: ${e.message}`; render(); } }
}
function drawTwin() { S.twin = twinLayout(S.twinRaw, S.unit); stage.setTwin(S.twin); render(); }
async function loadContext() {
  if (!bridgeMode) return;
  try { S.projects = (await client.projects()).projects || []; } catch { S.projects = []; }
  const p = S.projects.find((x) => x.id === S.projectId); if (!p) S.projectId = "";
  S.context = p ? p.name : "Conversa geral";
  if (chat.id) S.messages = (await chat.history()).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
}
async function loadPage() {
  if (S.page === "memorias") { try { S.memories = (await client.memories(S.projectId ? { scope: "project", projectId: S.projectId } : {})).memories || []; } catch { S.memories = []; } render(); }
  if (S.page === "projetos") { await loadContext(); render(); }
  if (S.page === "operacao") loadTwin();
}

// ---------- Connection and pairing ----------
async function connect() {
  if (!bridgeMode) { S.connection = { state: "ok", text: "Só leitura · Power BI" }; render(); return; }
  if (!client.paired) return askPairing();
  try {
    const caps = await client.capabilities();
    S.connection = { state: "ok", text: "Aurora no PC" }; S.caps = caps;
    await loadContext(); render(); loadPage(); loadTwin();
  } catch (e) {
    if (e.status === 401) return askPairing();
    S.connection = { state: "bad", text: "PC indisponível" }; render();
    setTimeout(connect, 5000);
  }
}
async function askPairing() {
  S.connection = { state: "wait", text: "Não pareado" }; render();
  const d = $("pair");
  $("pairName").value = storage.get("aurora-xr-name") || { headset: "Óculos", phone: "Celular", tablet: "Tablet", desktop: "Este PC" }[profile.kind];
  // On the PC itself the code comes from here: one click.
  try {
    const r = await fetch("/xr/v1/pairing", { method: "POST" });
    if (r.ok) { const { code } = await r.json(); $("pairCode").value = code; $("pairWhy").textContent = "Você está no próprio PC: o código já está preenchido."; }
  } catch { /* another device */ }
  d.showModal();
  $("pairForm").onsubmit = async (e) => {
    e.preventDefault(); $("pairErr").hidden = true;
    try { storage.set("aurora-xr-name", $("pairName").value); await client.pair($("pairCode").value, $("pairName").value); d.close(); connect(); }
    catch (err) { $("pairErr").hidden = false; $("pairErr").textContent = err.message; }
  };
}

// For the lab and for debugging from the browser console.
window.auroraXR = { S, stage, act };
// ?lab=1 (only the test bridge of scripts/xr-lab answers it): the device's facts, errors and tracking go
// to the PC, to follow a test in a headset nobody can see from outside.
if (new URLSearchParams(location.search).has("lab")) {
  const report = (kind, data) => fetch("/lab/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, data, page: S.page, mode: S.mode }) }).catch(() => {});
  report("device", { facts, profile: { kind: profile.kind, modes: profile.modes, layout: profile.layout }, size: [innerWidth, innerHeight, devicePixelRatio] });
  addEventListener("error", (e) => report("error", `${e.message} @ ${e.filename}:${e.lineno}`));
  addEventListener("unhandledrejection", (e) => report("error", String(e.reason?.stack || e.reason)));
  let lastTrack = "";
  setInterval(() => { const t = JSON.stringify({ mode: S.mode, tracking: S.tracking, conn: S.connection.state }); if (t !== lastTrack) { lastTrack = t; report("state", JSON.parse(t)); } }, 2000);
}
render();
connect();
if (!bridgeMode) loadTwin();
setInterval(() => { if ((!document.hidden || S.mode !== "3d") && client.paired) loadTwin(); }, 15_000);
