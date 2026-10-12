// Aurora XR: the Aurora of the PC in any device. The same app on the headset (mixed reality with
// passthrough, or VR; hands and controllers), on the phone (AR on a table, or 3D that follows the
// phone's movement) and on the PC (3D beside the panel). It talks to the XR bridge of the PC
// (app/xrBridge.js), or, opened from "ver em 3D" (app/twinServer.js), only reads the operation.
import { createBridgeClient, createTwinClient, createChat } from "./lib/api.js";
import { twinLayout } from "./lib/twinLayout.js";
import { deviceProfile, sessionInit, MODE_LABEL } from "./lib/device.js";
import { voiceCommand, VOICE_HELP, downsample, encodeWav, toBase64, SilenceGate, spokenPart } from "./lib/voice.js";
import { isSceneRequest, sceneEdit, editScene, sceneFromPrompt, parseSceneReply, scenePrompt, mergeWithDraft, ownWords, recipeFor } from "./lib/scene.js";
import { compose, relevantTypes, resolveType } from "./lib/compose.js";
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
  // What the miniature shows: the operation of the Power BI, or a scene made by the Aurora.
  view: "operacao", scene: null, scenes: loadScenes(), sceneBusy: false, scenePrompt: "",
};
function loadScenes() { try { return JSON.parse(storage.get("aurora-xr-scenes") || "[]").slice(0, 12); } catch { return []; } }
function saveScenes() { storage.set("aurora-xr-scenes", JSON.stringify(S.scenes.slice(0, 12))); }
const SCENE_EXAMPLES = ["Uma fazenda com vacas, cavalos e um trator", "Uma cidade com carros andando", "O sistema solar", "Um parque de dinossauros", "Uma praia com barcos e peixes", "Um acampamento na floresta"];

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
  const L = S.view === "operacao" ? S.twin : null;
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
    const msgs = S.messages.slice(-30).map((m) => `<div class="msg ${m.role === "user" ? "user" : "assistant"}">${esc(shown(m))}</div>`).join("");
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
  cenarios() {
    const cur = S.view === "cenario" && S.scene;
    const head = cur ? `<h2 class="op-title">${esc(S.scene.title)}</h2><p class="muted">${esc(S.scene.count)} coisas na maquete${S.scene.loading ? ` (carregando ${esc(S.scene.loading)})` : ""}. Segure qualquer uma com a mão (ou arraste com o dedo ou o mouse): ela cresce para você ver de perto e, ao soltar, volta para o lugar.</p>${S.scene.note ? `<div class="note">Aurora: ${esc(S.scene.note)}</div>` : ""}`
      : `<h2 class="op-title">Cenários</h2><p class="muted">Peça à Aurora uma maquete de qualquer coisa: ela monta e põe na sua mesa. Os objetos se mexem, você pega com a mão, olha de perto e solta: eles voltam sozinhos.</p>`;
    const busy = S.sceneBusy ? `<div class="msg stage">A Aurora está montando: ${esc(S.scenePrompt)}…</div>` : "";
    const edit = cur ? `<p class="muted">Diga ou escreva: "adiciona 3 vacas", "coloca um foguete", "tira os carros".</p>` : "";
    return `${head}${busy}
      <form class="composer" data-act="scene"><textarea rows="1" name="text" placeholder="Ex.: uma cidade com carros andando" aria-label="Pedir um cenário"></textarea>
      <button type="button" class="round mic" data-act="mic" aria-pressed="${S.listening}" title="Falar">${S.listening ? "■" : "🎙"}</button><button class="round" title="Criar" ${S.sceneBusy ? "disabled" : ""}>➤</button></form>${edit}
      <div class="chips">${SCENE_EXAMPLES.map((x) => `<button class="chip" data-act="scene:make" data-arg="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      <div class="section"><h3>Maquetes</h3><ul class="list">
      <li aria-current="${S.view === "operacao"}"><button data-act="view:operacao"><b>Operação do Power BI</b><small>${esc(S.twin?.title || "A operação aberta pela Aurora")}</small></button></li>
      ${S.scenes.map((x) => `<li aria-current="${cur && S.scene.id === x.id}" class="row-del"><button data-act="scene:open" data-arg="${esc(x.id)}"><b>${esc(x.title)}</b><small>${esc(x.prompt)}</small></button><button class="del" data-act="scene:delete" data-arg="${esc(x.id)}" title="Apagar" aria-label="Apagar ${esc(x.title)}">×</button></li>`).join("")}
      </ul></div>`;
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
/** What a message shows: the person's own words (not the app's instruction), the reply without its JSON block. */
function shown(m) { return m.role === "user" ? ownWords(m.content) : parseSceneReply(m.content).spec ? parseSceneReply(m.content).rest || "Cenário pronto." : m.content; }
function nums(L) { return L.numbers.length ? `<div class="nums">${L.numbers.map((n) => `<div class="num"><span>${esc(n.name)}</span><b>${esc(n.value)}</b></div>`).join("")}</div>` : ""; }
function singular(noun) { return String(noun || "item").replace(/ões$/, "ão").replace(/ns$/, "m").replace(/es$/, "").replace(/s$/, "") || "item"; }

// ---------- Actions (screen buttons, panel buttons, voice) ----------
async function act(a, arg) {
  if (a.startsWith("page:")) {
    S.page = a.slice(5); storage.set("aurora-xr-page", S.page);
    // The Operation tab shows the operation again in the miniature.
    if (S.page === "operacao" && S.view !== "operacao") showOperation();
    render(); return loadPage();
  }
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
    case "scene": case "scene:make": return makeScene(arg);
    case "scene:open": { const x = S.scenes.find((y) => y.id === arg); if (x) showScene(x); return; }
    case "scene:delete": S.scenes = S.scenes.filter((y) => y.id !== arg); saveScenes(); if (S.scene?.id === arg) showOperation(); return render();
    case "scene:next": { if (!S.scenes.length) return; const i = S.scenes.findIndex((y) => y.id === S.scene?.id); return showScene(S.scenes[(i + 1) % S.scenes.length]); }
    case "view:operacao": showOperation(); return render();
  }
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-page]"); if (tab) return act(`page:${tab.dataset.page}`);
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "FORM") return;
  e.preventDefault(); act(b.dataset.act, b.dataset.arg);
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-act='send'], form[data-act='scene']"); if (!f) return;
  e.preventDefault(); const text = f.text.value.trim(); if (!text) return; f.text.value = "";
  if (f.dataset.act === "scene") makeScene(text); else send(text);
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
  // "faz uma fazenda…": a scene; "adiciona 3 vacas" while one is shown: changed here, at once.
  const edit = S.view === "cenario" && CAT && sceneEdit(text, resolve);
  if (edit) return changeScene(edit, text);
  if (isSceneRequest(text) || (S.page === "cenarios" && !S.busy)) return makeScene(text);
  S.messages.push({ role: "user", content: text }); S.busy = true; S.stage = "Enviando ao PC…"; S.partial = ""; S.page = S.page === "operacao" && S.mode !== "3d" ? S.page : "conversa"; render();
  try {
    const reply = await chat.send(text, { projectId: S.projectId, onStage: (p) => { S.stage = p.stage || S.stage; S.partial = p.partial || ""; S.approval = p.approval || null; render(); } });
    S.messages.push({ role: "assistant", content: reply.content || "(sem resposta)" });
    if (S.speakReplies) speak(shown({ role: "assistant", content: reply.content }));
  } catch (e) {
    S.messages.push({ role: "assistant", content: e.status === 409 ? "A conexão caiu no meio do pedido. Confira a conversa no PC antes de repetir." : `Não consegui: ${e.message}` });
  } finally { S.busy = false; S.stage = ""; S.partial = ""; S.approval = null; render(); }
  if (/power bi|operação|maquete|bi\b/i.test(text)) loadTwin(true);
}
function runCommand(c) {
  if (c === "stop") { silence(); if (S.busy && chat?.id) client.cancel(chat.id).catch(() => {}); return; }
  if (c === "repeat") return act("repeat");
  if (c.startsWith("page:")) return act(c);
  if (c === "recenter") return act("recenter");
  if (c === "place") return act("place");
  if (c === "refresh") return act("refresh");
  if (c === "scene:next") return act("scene:next");
}

// ---------- Scenes made by the Aurora (only here, for fun: the Power BI stays faithful to its data) ----------
// The object library: each type explained (assets/catalog.json); loaded at start, used by name.
let CAT = null;
const catalogReady = stage.assets.load().then((c) => (CAT = c)).catch((e) => { hint(`Biblioteca de objetos indisponível: ${e.message}`); return null; });
const resolve = (w) => (CAT ? resolveType(CAT, w) : null);
const sceneId = () => `cena-${Date.now().toString(36)}`;
async function showScene(x) {
  const cat = await catalogReady; if (!cat) return;
  const L = compose(x.spec, cat, x.id);
  S.scene = { id: x.id, title: L.title, count: L.things.length, note: x.note || "", missing: L.missing, loading: "" }; S.view = "cenario"; S.picked = null;
  if (S.page !== "conversa") S.page = "cenarios";
  render();
  const shown = await stage.setScene(L, (done, total) => { if (S.scene?.id !== x.id) return; S.scene.loading = done < total ? `${done}/${total} modelos` : ""; if (done === total || done % 4 === 0) render(); });
  if (shown && S.mode !== "3d") stage.showTwin(true);
  if (S.scene?.id === x.id) { S.scene.loading = ""; render(); }
}
function showOperation() { S.view = "operacao"; S.scene = null; S.picked = null; stage.sceneTicket = (stage.sceneTicket || 0) + 1; if (S.twin) stage.setTwin(S.twin); }
function keepScene(x) { S.scenes = [x, ...S.scenes.filter((y) => y.id !== x.id)].slice(0, 12); saveScenes(); }
/**
 * A scene from a request: a draft at once (the recipe of its theme and the things it names), then the
 * Aurora's, in the same conversation as everything else, told about the library's types that matter.
 */
async function makeScene(prompt) {
  prompt = String(prompt || "").trim(); if (!prompt || S.sceneBusy) return;
  const cat = await catalogReady; if (!cat) return;
  const draft = sceneFromPrompt(prompt, resolve);
  const x = { id: sceneId(), prompt, title: draft.titulo, spec: draft, note: "" };
  S.page = "cenarios"; showScene(x); hint(`Rascunho pronto. A Aurora está montando "${prompt}"…`);
  if (!chat) { keepScene(x); return render(); }
  S.sceneBusy = true; S.scenePrompt = prompt; S.messages.push({ role: "user", content: prompt }); render();
  try {
    const told = relevantTypes(cat, `${prompt} ${draft.titulo}`);
    const reply = await chat.send(prompt + scenePrompt(told, recipeFor(prompt)), { projectId: S.projectId, onStage: (p) => { S.stage = p.stage || S.stage; render(); } });
    const content = reply.content || "";
    S.messages.push({ role: "assistant", content });
    const { spec, rest } = parseSceneReply(content);
    const merged = mergeWithDraft(spec, draft, resolve, told.map((t) => t.id));
    x.spec = merged.spec; x.title = String(merged.spec.titulo || x.title).slice(0, 60);
    x.note = spokenPart(rest, 200);
    keepScene(x);
    if (S.view === "cenario" && S.scene?.id === x.id && merged.used) await showScene(x);
    hint(merged.used ? `Cenário "${x.title}" pronto. Pegue qualquer coisa com a mão para ver de perto.` : "A Aurora respondeu sem uma maquete que combine: ficou o rascunho feito com as suas palavras.");
    if (S.speakReplies && x.note) speak(x.note);
  } catch (e) {
    keepScene(x); hint(`A Aurora não respondeu (${e.message}); ficou o rascunho.`);
  } finally { S.sceneBusy = false; S.scenePrompt = ""; S.stage = ""; render(); }
}
function changeScene(edit, text) {
  const x = S.scenes.find((y) => y.id === S.scene?.id); if (!x) return;
  x.spec = editScene(x.spec, edit, resolve); x.prompt = `${x.prompt} · ${text}`.slice(0, 200);
  keepScene(x); showScene(x);
  hint(edit.op === "add" ? "Pronto, coloquei." : "Pronto, tirei.");
}

// ---------- Voice: the PC transcribes (the same voice services the Quest app used) ----------
let mic = null; let audio = null;
async function listen() {
  if (!bridgeMode) return;
  silence();              // she stops talking while you speak
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
// One voice at a time: a new reply silences the one speaking, and a voice still being made on the PC
// for an older reply is dropped when it arrives. Only the opening is spoken (the rest is on the panel).
let speechTurn = 0;
function silence() { speechTurn++; audio?.stop?.(); audio = null; try { speechSynthesis.cancel(); } catch { /* no voice */ } }
async function speak(text) {
  text = spokenPart(text); if (!text) return;
  silence(); const turn = speechTurn;
  try {
    if (S.caps && !S.caps.speech) throw new Error("sem voz neural");
    const r = await client.speak(text);
    if (turn !== speechTurn) return;
    const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
    const ctx = new AudioContext(); const buf = await ctx.decodeAudioData(bytes.buffer);
    if (turn !== speechTurn) { ctx.close(); return; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    audio = { stop: () => { try { src.stop(); ctx.close(); } catch { /* ended */ } } };
    src.onended = () => { if (turn === speechTurn) audio = null; ctx.close().catch(() => {}); };
  } catch {
    if (turn !== speechTurn) return;
    // Without the PC's neural voice: the browser's own, when it has Portuguese.
    try { const u = new SpeechSynthesisUtterance(text); u.lang = "pt-BR"; speechSynthesis.speak(u); } catch { /* no voice */ }
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
function drawTwin() { S.twin = twinLayout(S.twinRaw, S.unit); if (S.view === "operacao") stage.setTwin(S.twin); render(); }
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
window.auroraXR = { S, stage, act, makeScene };
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
