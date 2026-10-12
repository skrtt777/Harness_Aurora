// The Aurora XR client: talks to the XR bridge of the PC (app/xrBridge.js, /xr/v1, the same routes
// the Quest app used), or only reads the twin (app/twinServer.js: a read-only page of the open Power BI).
// fetch and storage are passed in, so the tests run it in Node against the real bridge handler.

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

export class BridgeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/**
 * base: the bridge's origin ("" for the same origin). storage: { get(key), set(key, value), remove(key) }.
 */
export function createBridgeClient({ base = "", fetch = globalThis.fetch.bind(globalThis), storage, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 900 } = {}) {
  const keyToken = "aurora-xr-token";
  const keyDevice = "aurora-xr-device";
  let token = storage?.get(keyToken) || "";
  const call = async (path, method = "GET", body) => {
    const r = await fetch(`${base}/xr/v1${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try { data = await r.json(); } catch { /* an empty answer */ }
    if (r.status === 401 && token) { token = ""; storage?.remove(keyToken); }
    if (!r.ok) throw new BridgeError(data.error || `Falha ${r.status}`, r.status);
    return data;
  };
  /** A change on the PC: sent with an id, then followed until it finishes (never sent twice). */
  const submit = async (path, body = {}, { onWait, signal } = {}) => {
    const requestId = newId();
    let op = await call(path, "POST", { ...body, requestId });
    while (op.state === "pending") {
      if (signal?.aborted) throw new BridgeError("Interrompido.", 499);
      await sleep(pollMs);
      if (onWait) await onWait().catch(() => {});
      op = await call(`/operations/${requestId}`);
    }
    if (op.state !== "complete") throw new BridgeError(op.error || "Operação não concluída.", op.state === "uncertain" ? 409 : 502);
    return op.result;
  };
  return {
    kind: "bridge",
    get paired() { return !!token; },
    async health() { return call("/health"); },
    /** Pairs this browser with the 6-digit code shown on the PC (or none from the PC itself). */
    async pair(code, name) {
      const r = await call("/pair", "POST", { code: String(code || "").trim(), name: String(name || "Navegador").slice(0, 80) });
      token = r.token; storage?.set(keyToken, r.token); storage?.set(keyDevice, r.deviceId);
      return r;
    },
    forget() { token = ""; storage?.remove(keyToken); storage?.remove(keyDevice); },
    capabilities: () => call("/capabilities"),
    projects: () => call("/projects"),
    conversations: (projectId) => call(`/conversations${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
    conversation: (id) => call(`/conversations/${id}`),
    pending: (id) => call(`/conversations/${id}/pending`),
    memories: (params = {}) => call(`/memories?${new URLSearchParams(params)}`),
    twin: () => call("/twin"),
    newConversation: (title, projectId) => submit("/conversations", { title, provider: "local", ...(projectId ? { projectId } : {}) }),
    send: (conversationId, message, opts) => submit(`/conversations/${conversationId}/messages`, { message }, opts),
    remember: (data) => submit("/memories", data),
    transcribe: (audio) => submit("/transcribe", { audio }),
    speak: (text) => submit("/speak", { text }),
    /** A scene from the Aurora's local model, its answer held to the schema (app/xrScene.js): { text }. */
    scene: (system, prompt, schema) => submit("/scene", { system, prompt, schema }),
    approve: (conversationId, id, approved) => call(`/conversations/${conversationId}/approval`, "POST", { id, approved }),
    cancel: (conversationId) => call(`/conversations/${conversationId}/cancel`, "POST", {}),
  };
}

/** Only the twin, read-only (the page served by app/twinServer.js: ./state next to it). */
export function createTwinClient({ stateUrl = "./state", fetch = globalThis.fetch.bind(globalThis) } = {}) {
  return {
    kind: "twin",
    paired: true,
    async twin() { const r = await fetch(stateUrl, { cache: "no-store" }); if (!r.ok) throw new BridgeError("Estado indisponível.", r.status); return r.json(); },
    capabilities: async () => ({ chat: false, twin: true }),
  };
}

/**
 * A conversation with the Aurora over the bridge: keeps (or creates) one conversation, sends, and gives
 * the answer with the stage while it works ("Lendo o arquivo…", the partial answer).
 */
export function createChat(client, storage) {
  const key = "aurora-xr-conversation";
  let conversationId = storage?.get(key) || "";
  return {
    get id() { return conversationId; },
    use(id) { conversationId = id || ""; if (id) storage?.set(key, id); else storage?.remove(key); },
    async history() {
      if (!conversationId) return [];
      try { return (await client.conversation(conversationId)).messages || []; } catch (e) { if (e.status === 404) this.use(""); return []; }
    },
    async send(text, { onStage, projectId } = {}) {
      if (!conversationId) {
        const c = await client.newConversation(String(text).slice(0, 60) || "Aurora XR", projectId);
        this.use(c.id);
      }
      const id = conversationId;
      // While it works: the stage, the answer as it grows, and a permission the agent asks for.
      const result = await client.send(id, text, { onWait: async () => { onStage?.(await client.pending(id)); } });
      return result.message || { role: "assistant", content: result.error || "" };
    },
  };
}
