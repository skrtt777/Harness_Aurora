// The Aurora panel's page (lib/panel.js serves it): the conversation, the answer while she writes it,
// her steps, permissions, changed files, the comprovante's marks and the resposta viva; the composer
// with the context chips and the slash commands. Plain DOM, no framework; all text is escaped
// (AuroraMarkdown.esc) and the answers go through the safe markdown of media/markdown.js.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const { renderAnswer, render, esc } = window.AuroraMarkdown;
  const COMMANDS = [
    ["explicar", "Explica o trecho selecionado ou o arquivo aberto"],
    ["corrigir", "Corrige os erros (Problemas, terminal) ou o que você disser"],
    ["testes", "Escreve e roda testes para o arquivo aberto"],
    ["revisar", "Revisa as mudanças não commitadas (git diff)"],
    ["nova", "Começa uma conversa nova"],
  ];
  const SUGGESTIONS = ["Explique este arquivo", "Encontre bugs no código aberto", "Escreva testes para este arquivo", "Revise minhas mudanças"];
  const saved = vscode.getState() || {};
  const state = { offline: null, conversation: null, messages: [], busy: false, progress: null, context: null, history: null, provider: "local", providers: {}, autocomplete: true, notice: null, error: null, live: {}, sent: null, folder: null, harness: "" };
  const post = (msg) => vscode.postMessage(msg);
  const $ = (sel, root = document) => root.querySelector(sel);

  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="top">
      <button class="title" id="title" title="Conversas desta pasta"><span class="spark">✦</span><span id="titleText">Aurora</span><span class="caret">▾</span></button>
      <div class="actions">
        <select id="provider" title="Quem responde nas conversas novas"></select>
        <button class="icon" id="new" title="Conversa nova">＋</button>
        <button class="icon" id="settings" title="Configurações da Aurora">⚙</button>
      </div>
    </header>
    <div id="history" class="history" hidden></div>
    <main id="log" class="log" aria-live="polite"></main>
    <div id="working" class="working" hidden></div>
    <div id="notice" class="notice" hidden></div>
    <footer class="composer">
      <div id="slash" class="slash" hidden></div>
      <div id="chips" class="chips"></div>
      <div class="box">
        <textarea id="input" rows="1" placeholder="Peça à Aurora… ( / para comandos )"></textarea>
        <button id="send" class="send" title="Enviar (Enter)">➤</button>
      </div>
      <div class="hint"><span id="hintText">Enter envia · Shift+Enter quebra a linha · Ctrl+I edita no código</span><label class="toggle" title="Sugestões em cinza enquanto você digita, do modelo local"><input type="checkbox" id="auto"> autocompletar</label></div>
    </footer>
    <div id="card" class="card" hidden></div>`;
  const input = $("#input"), log = $("#log");
  input.value = saved.draft || "";

  // ---------- the conversation ----------
  function sealOf(proof, outdated) {
    if (!proof || !proof.total) return "";
    const ok = proof.proven === proof.total;
    return `<div class="seal ${ok ? "ok" : "part"}" title="Passe o mouse nos números marcados para ver de onde vieram">${ok ? "✓ Comprovado" : "⚠ Comprovado em parte"}${outdated ? " na hora da resposta" : ""}: ${proof.proven} de ${proof.total} número${proof.total === 1 ? "" : "s"} com fonte</div>`;
  }
  function liveBanner(m) {
    const live = state.live[m.id] || m.live;
    if (!live) return "";
    const files = (live.files || []).filter((f) => f.changed || f.missing);
    if (!files.length) return "";
    const names = files.map((f) => esc(f.name)).join(", ");
    if (live.verdict === "vale") return `<div class="live vale">✓ ${names} mudou depois desta resposta; os ${live.checked} números dela continuam iguais.</div>`;
    const items = live.claims.filter((c) => c.status === "mudou" || c.status === "sumiu").slice(0, 6);
    return `<div class="live mudou"><p><strong>${names} mudou depois desta resposta</strong> · ${live.changed === 1 ? "1 número não vale mais" : `${live.changed} números não valem mais`}</p>
      <ul>${items.map((c) => `<li><s>${esc(c.raw)}</s> ${c.status === "mudou" ? `→ <strong>${esc(c.now)}</strong>${c.where ? ` <small>(${esc(c.where)})</small>` : ""}` : `<small>${esc(c.why || "")}</small>`}</li>`).join("")}</ul>
      <button class="link-btn" data-redo="${esc(files.map((f) => f.name).join(", "))}">Refazer com os dados novos</button></div>`;
  }
  function changesBlock(m) {
    if (!m.changes?.length) return "";
    const edited = m.changes.filter((c) => !c.created && c.backup);
    return `<div class="changes"><div class="changes-head">${m.changes.length} arquivo${m.changes.length === 1 ? "" : "s"} ${m.changes.some((c) => !c.created) ? "alterado" : "criado"}${m.changes.length === 1 ? "" : "s"}</div>
      <ul>${m.changes.slice(0, 20).map((c) => `<li><span class="tag ${c.created ? "new" : "edit"}">${c.created ? "novo" : "editado"}</span><a href="#" data-open="${esc(c.file)}">${esc(shortPath(c.file))}</a></li>`).join("")}</ul>
      <div class="row">${edited.length ? `<button data-review="${esc(m.id)}">Revisar no editor</button><button class="ghost" data-diffs="${esc(m.id)}">Ver diferenças (${edited.length})</button>` : ""}<button class="ghost danger" data-undo="${esc(m.id)}">Desfazer</button></div></div>`;
  }
  function stepsBlock(m) {
    if (!m.steps?.length) return "";
    const failed = m.steps.filter((s) => !s.ok).length;
    return `<details class="steps"><summary>${m.steps.length} passo${m.steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} com erro` : ""}</summary><ul>${m.steps.map((s) => `<li class="${s.ok ? "" : "bad"}">${s.ok ? "✓" : "✗"} ${esc(s.summary)}</li>`).join("")}</ul></details>`;
  }
  function messageHtml(m) {
    if (m.role === "user") {
      const shown = m.content.replace(/\n\n\[Contexto do VS Code\][\s\S]*$/, "");
      const hasContext = shown !== m.content;
      return `<div class="msg user" data-msg="${esc(m.id || "")}"><div class="bubble">${esc(shown).replace(/\n/g, "<br>")}</div>${hasContext ? `<div class="ctx-note">com o contexto do VS Code</div>` : ""}</div>`;
    }
    const body = renderAnswer(m.content, m.proof);
    return `<div class="msg aurora" data-msg="${esc(m.id || "")}"><div class="who"><span class="spark">✦</span> Aurora${m.provider && m.provider !== "local" ? ` <small>· ${esc(state.providers[m.provider] || m.provider)}</small>` : ""}</div>
      ${stepsBlock(m)}<div class="md">${body}</div>${sealOf(m.proof, (state.live[m.id] || m.live)?.verdict === "mudou")}${liveBanner(m)}${changesBlock(m)}</div>`;
  }
  function applyLive(root) {
    // The numbers that changed after the answer: struck, with the new value beside them.
    for (const el of root.querySelectorAll(".msg.aurora")) {
      const m = state.messages.find((x) => x.id === el.dataset.msg);
      const live = m && (state.live[m.id] || m.live);
      if (!live) continue;
      for (const c of live.claims || []) {
        const mark = el.querySelector(`mark.proof[data-proof="${c.i}"]`);
        if (!mark) continue;
        mark.classList.add(c.status);
        if (c.status === "mudou" && c.now) mark.innerHTML = `<s>${esc(c.raw)}</s> <span class="now">${esc(c.now)}</span>`;
      }
    }
  }
  function renderLog() {
    if (state.offline) {
      log.innerHTML = `<div class="empty"><div class="big">⊘</div><h2>O Harness Aurora está fechado</h2><p>A Aurora do VS Code usa o Harness deste computador: o mesmo modelo local, as memórias e as ferramentas. Nada sai do PC.</p>
        ${state.offline.installed ? `<button class="primary" data-act="openHarness">Abrir o Harness</button>` : `<p>Não achei o Harness instalado. Instale-o, ou diga onde ele está em <a href="#" data-act="settings">Configurações</a>.</p>`}
        <button class="ghost" data-act="ready">Tentar de novo</button></div>`;
      return;
    }
    if (!state.conversation) { log.innerHTML = `<div class="empty"><div class="big spin">✦</div><p>Conectando ao Harness…</p></div>`; return; }
    if (!state.messages.length && !state.sent) {
      log.innerHTML = `<div class="empty"><div class="big">✦</div><h2>Oi! Sou a Aurora.</h2><p>Trabalho na pasta <strong>${esc(state.folder || "aberta")}</strong> com o modelo ${state.conversation.provider === "local" ? "local, sem nada sair do PC" : esc(state.providers[state.conversation.provider] || state.conversation.provider)}.</p>
        <div class="sugs">${SUGGESTIONS.map((s) => `<button class="sug" data-sug="${esc(s)}">${esc(s)}</button>`).join("")}</div>
        <p class="small">Dica: selecione um trecho e aperte <kbd>Ctrl</kbd>+<kbd>I</kbd> para a Aurora mudar só ele, com aceitar e recusar.</p></div>`;
      return;
    }
    log.innerHTML = state.messages.map(messageHtml).join("") + (state.sent ? `<div class="msg user pending"><div class="bubble">${esc(state.sent.text).replace(/\n/g, "<br>")}</div>${contextNote(state.sent.context)}</div>` : "");
    applyLive(log);
    log.scrollTop = log.scrollHeight;
  }
  function contextNote(c) {
    if (!c) return "";
    const parts = [c.file && `${esc(c.file)}${c.lines ? `:${esc(c.lines)}` : ""}`, c.problems && `${c.problems} problema${c.problems === 1 ? "" : "s"}`, c.terminal && `terminal: ${esc(c.terminal.slice(0, 40))}`].filter(Boolean);
    return parts.length ? `<div class="ctx-note">com ${parts.join(" · ")}</div>` : "";
  }

  // ---------- while she works ----------
  function renderWorking() {
    const w = $("#working");
    const p = state.progress;
    if (!state.busy) { w.hidden = true; w.innerHTML = ""; return; }
    w.hidden = false;
    const steps = (p?.steps || []).filter((s) => s.summary);
    const order = p?.order ? [...(p.order.deliver || []).map((d) => `Entregar: ${d}`), ...(p.order.rules || []).map((r) => `Regra: ${r}`)] : [];
    w.innerHTML = `<div class="msg aurora live-answer"><div class="who"><span class="spark spin">✦</span> Aurora <small>· ${esc(p?.stage || "pensando…")}</small><button class="stop" data-act="stop" title="Parar">■ Parar</button></div>
      ${order.length ? `<div class="order"><strong>Ordem de serviço</strong><ul>${order.slice(0, 6).map((o) => `<li>${esc(o)}</li>`).join("")}</ul></div>` : ""}
      ${p?.plan?.length ? `<ul class="plan">${p.plan.map((i) => `<li class="${i.status}">${i.status === "done" ? "✓" : i.status === "in_progress" ? "◐" : "○"} ${esc(i.text)}</li>`).join("")}</ul>` : ""}
      ${steps.length ? `<ul class="steps-live">${steps.slice(-8).map((s) => `<li class="${s.status === "running" ? "run" : s.ok ? "" : "bad"}">${s.status === "running" ? "◌" : s.ok ? "✓" : "✗"} ${esc(s.summary)}</li>`).join("")}</ul>` : ""}
      ${p?.approval ? `<div class="approval"><div><strong>A Aurora pede autorização</strong></div><div>${esc(p.approval.summary)}</div>${p.approval.detail ? `<pre>${esc(String(p.approval.detail).slice(0, 400))}</pre>` : ""}
        <div class="row"><button class="primary" data-approve="${esc(p.approval.id)}">Permitir</button><button data-always="${esc(p.approval.id)}" class="ghost" title="Permitir sempre este tipo de pedido">Sempre</button><button class="ghost danger" data-deny="${esc(p.approval.id)}">Negar</button></div></div>` : ""}
      ${p?.partial ? `<div class="md typing">${render(p.partial)}<span class="caret-blink">▍</span></div>` : ""}</div>`;
    log.scrollTop = log.scrollHeight;
  }

  // ---------- the composer ----------
  function renderChips() {
    const c = state.context;
    const chips = [];
    if (c?.file) chips.push(chip("file", `📄 ${c.file}`, c.use.file));
    if (c?.file && c.lines) chips.push(chip("selection", `✂ linhas ${c.lines}`, c.use.selection && c.use.file));
    if (c?.problems) chips.push(chip("problems", `⚠ ${c.problems} problema${c.problems === 1 ? "" : "s"}`, c.use.problems));
    if (c?.terminal) chips.push(chip("terminal", `⌨ falhou: ${c.terminal.command}`, c.use.terminal));
    $("#chips").innerHTML = chips.join("") + (c?.terminal && !state.busy ? `<button class="chip action" data-fix-terminal>Corrigir o erro do terminal</button>` : "") + (c?.workspaceProblems && !c?.terminal && !state.busy ? `<button class="chip action" data-fix-problems>${c.workspaceProblems === 1 ? "Corrigir o problema" : `Corrigir os ${c.workspaceProblems} problemas`}</button>` : "");
  }
  const chip = (key, label, on) => `<button class="chip ${on ? "on" : "off"}" data-chip="${key}" title="${on ? "Vai junto com a mensagem: clique para tirar" : "Fora da mensagem: clique para pôr"}">${esc(label)}</button>`;
  function renderHeader() {
    $("#titleText").textContent = state.conversation?.title?.replace(/^VS Code:\s*/, "") || "Aurora";
    const sel = $("#provider");
    sel.innerHTML = Object.entries(state.providers).map(([k, v]) => `<option value="${esc(k)}"${k === state.provider ? " selected" : ""}>${esc(v)}</option>`).join("");
    $("#auto").checked = state.autocomplete;
    $("#send").textContent = state.busy ? "■" : "➤";
    $("#send").title = state.busy ? "Parar" : "Enviar (Enter)";
    $("#send").classList.toggle("busy", state.busy);
  }
  function renderSlash() {
    const s = $("#slash");
    const m = /^\/(\w*)$/.exec(input.value.trim());
    const list = m ? COMMANDS.filter(([c]) => c.startsWith(m[1])) : [];
    s.hidden = !list.length;
    s.innerHTML = list.map(([c, d], i) => `<button class="${i === 0 ? "first" : ""}" data-cmd="${c}"><strong>/${c}</strong> <span>${esc(d)}</span></button>`).join("");
  }
  function notice(text, kind = "info") {
    const n = $("#notice");
    n.hidden = !text; n.className = `notice ${kind}`; n.textContent = text || "";
    clearTimeout(notice.t);
    if (text) notice.t = setTimeout(() => { n.hidden = true; }, kind === "error" ? 12000 : 4000);
  }
  function grow() { input.style.height = "auto"; input.style.height = `${Math.min(200, input.scrollHeight)}px`; }
  function send(text = input.value) {
    const t = String(text).trim();
    if (state.busy) { post({ type: "stop" }); return; }
    if (!t) return;
    post({ type: "send", text: t });
    if (text === input.value) { input.value = ""; grow(); vscode.setState({ draft: "" }); }
    renderSlash();
  }

  // ---------- the proof card ----------
  function cardFor(mark) {
    const msgEl = mark.closest(".msg");
    const m = state.messages.find((x) => x.id === msgEl?.dataset.msg);
    const claim = m?.proof?.claims?.[Number(mark.dataset.proof)];
    if (!claim) return "";
    const live = (state.live[m.id] || m.live)?.claims?.find((c) => c.i === Number(mark.dataset.proof));
    const s = claim.source;
    let html = "";
    if (live?.status === "mudou") html += `<div class="card-live">Depois desta resposta, ${esc(live.where || "a fonte")} passou a dizer <strong>${esc(live.now)}</strong></div>`;
    if (live?.status === "sumiu") html += `<div class="card-live">${esc(live.why || "A fonte não está mais lá.")}</div>`;
    if (claim.status === "fonte" && s) {
      html += `<div class="card-head">${live?.status === "mudou" ? "Na hora da resposta: " : ""}${esc(s.name || shortPath(s.file))}${s.sheet ? ` › ${esc(s.sheet)}` : ""}${s.cell ? ` › ${esc(s.cell)}` : s.line ? ` › linha ${s.line}` : ""}</div>`;
      if (s.header && s.row) html += `<table><tr>${s.header.map((h) => `<th${h === s.column ? ' class="lit"' : ""}>${esc(h)}</th>`).join("")}</tr><tr>${s.row.map((v, i) => `<td${s.header[i] === s.column ? ' class="lit"' : ""}>${esc(v)}</td>`).join("")}</tr></table>`;
      else if (s.text) html += `<div class="card-text">${esc(String(s.text).slice(0, 240))}</div>`;
      if (s.file) html += `<a href="#" data-open="${esc(s.file)}">Abrir o arquivo</a>`;
    } else if (claim.status === "conta") html += `<div class="card-head">Conta</div><div class="card-text">${esc(claim.formula || "")}</div>`;
    else if (claim.status === "pedido") html += `<div class="card-head">Você disse este número</div>`;
    else html += `<div class="card-head warn">Sem fonte</div><div class="card-text">A Aurora não achou de onde veio este número. Confira antes de usar.</div>`;
    return html;
  }
  let cardTimer = null;
  document.addEventListener("mouseover", (e) => {
    const mark = e.target.closest?.("mark.proof");
    const card = $("#card");
    if (mark) {
      clearTimeout(cardTimer);
      const html = cardFor(mark);
      if (!html) return;
      card.innerHTML = html; card.hidden = false;
      const r = mark.getBoundingClientRect();
      const w = Math.min(340, window.innerWidth - 16);
      card.style.width = `${w}px`;
      card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
      const below = r.bottom + 6 + card.offsetHeight < window.innerHeight;
      card.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - card.offsetHeight - 6)}px`;
    } else if (!e.target.closest?.("#card")) cardTimer = setTimeout(() => { card.hidden = true; }, 250);
  });

  // ---------- events ----------
  input.addEventListener("input", () => { grow(); renderSlash(); vscode.setState({ draft: input.value }); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const first = $("#slash button.first");
      if (first && !$("#slash").hidden && !/\s/.test(input.value.trim())) { input.value = `/${first.dataset.cmd} `; renderSlash(); return; }
      send();
    }
    if (e.key === "Escape" && state.busy) post({ type: "stop" });
  });
  $("#send").addEventListener("click", () => send());
  $("#new").addEventListener("click", () => post({ type: "new" }));
  $("#settings").addEventListener("click", () => post({ type: "settings" }));
  $("#provider").addEventListener("change", (e) => { state.provider = e.target.value; post({ type: "provider", provider: state.provider }); });
  $("#auto").addEventListener("change", (e) => { state.autocomplete = e.target.checked; post({ type: "autocomplete", on: state.autocomplete }); });
  $("#title").addEventListener("click", () => {
    const h = $("#history");
    if (!h.hidden) { h.hidden = true; return; }
    h.hidden = false; h.innerHTML = `<div class="small">Carregando…</div>`; post({ type: "history" });
  });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) { if (!e.target.closest("#history, #title")) $("#history").hidden = true; return; }
    const d = t.dataset;
    if (t.tagName === "A") e.preventDefault();
    if (d.open) post({ type: "open", path: d.open });
    else if (d.href) post({ type: "open", path: d.href });
    else if (d.act === "stop") post({ type: "stop" });
    else if (d.act) post({ type: d.act });
    else if (d.sug) send(d.sug);
    else if (d.cmd) { input.value = `/${d.cmd} `; input.focus(); renderSlash(); }
    else if (d.chip) post({ type: "use", key: d.chip, on: !state.context.use[d.chip] });
    else if ("fixTerminal" in d) send("/corrigir o erro do último comando no terminal");
    else if ("fixProblems" in d) send("/corrigir");
    else if (d.approve) post({ type: "approve", id: d.approve, approved: true });
    else if (d.always) post({ type: "approve", id: d.always, approved: true, always: true });
    else if (d.deny) post({ type: "approve", id: d.deny, approved: false });
    else if (d.review || d.diffs || d.undo) {
      const m = state.messages.find((x) => x.id === (d.review || d.diffs || d.undo));
      if (!m) return;
      if (d.review) post({ type: "review", changes: m.changes });
      else if (d.diffs) post({ type: "diffs", changes: m.changes.filter((c) => !c.created && c.backup) });
      else post({ type: "undo", messageId: m.id, count: m.changes.length });
    } else if (d.redo) send(`Os dados de ${d.redo} mudaram depois da sua resposta. Leia de novo e refaça a resposta com os números atuais.`);
    else if ("copy" in d || "insert" in d) {
      const code = t.closest(".code")?.querySelector("code")?.textContent || "";
      post({ type: "copy" in d ? "copy" : "insert", code, text: code });
    } else if (d.pick) { $("#history").hidden = true; post({ type: "pick", id: d.pick }); }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "offline": state.offline = { installed: msg.installed }; state.busy = false; state.sent = null; break;
      case "conversation":
        Object.assign(state, { offline: null, conversation: msg.conversation, messages: msg.messages, provider: msg.provider, providers: msg.providers, autocomplete: msg.autocomplete, folder: msg.folder, harness: msg.harness, live: {}, busy: msg.busy && state.busy, sent: msg.busy ? state.sent : null });
        if (!msg.busy) state.progress = null;
        break;
      case "context": state.context = msg; renderChips(); return;
      case "sent": state.sent = { text: msg.text, context: msg.context }; state.busy = true; state.progress = null; break;
      case "progress": state.progress = msg; renderWorking(); return;
      case "answer":
        if (state.sent) state.messages.push({ id: `u-${Date.now()}`, role: "user", content: state.sent.text });
        state.messages.push(msg.message); state.sent = null; state.busy = false; state.progress = null; break;
      case "stopped": state.busy = false; state.progress = null; if (state.sent) state.messages.push({ id: `u-${Date.now()}`, role: "user", content: state.sent.text }); state.sent = null; notice("Parado."); break;
      case "error": state.busy = false; state.progress = null; if (state.sent) { input.value ||= state.sent.text; grow(); } state.sent = null; if (msg.offline) state.offline = { installed: true }; notice(msg.text, "error"); break;
      case "notice": notice(msg.text); return;
      case "live": state.live = msg.live || {}; break;
      case "draft": input.value = msg.text; grow(); input.focus(); renderSlash(); return;
      case "history": {
        const h = $("#history");
        h.innerHTML = msg.items.length ? msg.items.map((c) => `<button class="${c.current ? "current" : ""}" data-pick="${esc(c.id)}"><span>${esc(String(c.title || "").replace(/^VS Code:\s*/, ""))}</span><small>${esc(state.providers[c.provider] || c.provider || "")}${c.updatedAt ? ` · ${new Date(c.updatedAt).toLocaleDateString("pt-BR")}` : ""}</small></button>`).join("") : `<div class="small">Nenhuma conversa ainda.</div>`;
        return;
      }
      default: return;
    }
    renderHeader(); renderLog(); renderWorking(); renderChips();
  });

  function shortPath(p) { const parts = String(p).split(/[\\/]/); return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : String(p); }
  renderHeader(); renderLog(); grow();
  post({ type: "ready" });
})();
