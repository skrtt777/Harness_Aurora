import { timingSafeEqual } from "node:crypto";

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

export function authorize(request, url, token, allowDev) {
  const expected = `127.0.0.1:${request.socket.localPort}`;
  if (![expected, `localhost:${request.socket.localPort}`, `[::1]:${request.socket.localPort}`].includes(request.headers.host)) {
    throw httpError(403, "Host não autorizado.");
  }
  const isPreview = /^\/api\/conversations\/[^/]+\/messages\/[^/]+\/sandbox\/preview$/.test(url.pathname);
  if (isPreview && request.method === "GET") return;
  const origin = request.headers.origin;
  const origins = [`http://${expected}`, `http://localhost:${request.socket.localPort}`];
  if (allowDev) origins.push("http://127.0.0.1:5173", "http://localhost:5173");
  if (origin && !origins.includes(origin)) throw httpError(403, "Origem não autorizada.");
  if (request.headers["sec-fetch-site"] === "cross-site") throw httpError(403, "Requisição externa bloqueada.");
  if (!url.pathname.startsWith("/api/")) return;
  if (request.method === "GET" && ["/api/session", "/api/health"].includes(url.pathname)) return;
  const supplied = Buffer.from(String(request.headers["x-harness-token"] || ""));
  const expectedToken = Buffer.from(token);
  if (supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken)) throw httpError(401, "Sessão local inválida. Reabra a interface.");
}

export function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "O corpo deve ser um objeto JSON.");
  const strings = ["name", "instructions", "title", "content", "message", "provider", "teacherProvider", "note", "goal", "model", "scope", "kind", "source", "type", "toId", "defaultProvider", "defaultTeacher", "communityManifestUrl", "sandboxDir"];
  for (const key of strings) if (body[key] !== undefined && typeof body[key] !== "string") throw httpError(400, `Campo ${key} deve ser texto.`);
  for (const key of ["projectId", "conversationId"]) if (body[key] != null && typeof body[key] !== "string") throw httpError(400, `Campo ${key} inválido.`);
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== "string") || body.tags.length > 100)) throw httpError(400, "Tags devem ser uma lista de textos (até 100).");
  if (body.contextLimit !== undefined && (!Number.isFinite(body.contextLimit) || body.contextLimit < 1000 || body.contextLimit > 64000)) throw httpError(400, "Limite de contexto inválido (1000 a 64000).");
  if (body.env !== undefined) throw httpError(400, "Campo env não é permitido.");
  return body;
}

export async function readJson(request) {
  if ((request.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") throw httpError(415, "Use application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 1_000_000) { request.resume(); throw httpError(413, "Payload muito grande."); }
    chunks.push(chunk);
  }
  try { return validateBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
  catch (error) { if (error.status) throw error; throw httpError(400, "JSON inválido."); }
}
