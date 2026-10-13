// A REST API in Node.js with no dependencies, from a resource and its fields: the CRUD routes over a JSON
// file, validation of the required fields, CORS, and tests with node:test that start the server on a
// free port. The local model asked for "uma API REST em Node.js com cadastro de jogos… e rode os
// testes" failed in three tries (tests with describe undefined, a server that listened on import, a file
// cut by the output limit, 13/10); here it only names the resource and its fields, and the tests run.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ident = (s) => fold(s).replace(/[^a-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^[^a-z]+/, "") || "item";
const TYPES = ["texto", "numero", "inteiro", "booleano", "data"];

/** The spec, cleaned: { resource: "jogos", fields: [{ name, type, required }], sample: [...] }. */
export function apiSpec(input = {}) {
  const resource = fold(input.resource || "itens").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "itens";
  const fields = (Array.isArray(input.fields) ? input.fields : []).filter((f) => f && f.name).slice(0, 15).map((f) => ({
    name: ident(f.name), label: String(f.name).slice(0, 40),
    type: TYPES.includes(fold(f.type)) ? fold(f.type) : /num|nota|preco|valor|ano|idade|quant/.test(fold(f.name)) ? (/ano|idade|quant/.test(fold(f.name)) ? "inteiro" : "numero") : "texto",
    required: f.required !== false,
  }));
  if (!fields.length) throw new Error("Diga os campos do cadastro em fields (ex.: [{\"name\":\"nome\"},{\"name\":\"genero\"},{\"name\":\"ano\",\"type\":\"inteiro\"}]).");
  if (fields.some((f) => f.name === "id")) fields.splice(fields.findIndex((f) => f.name === "id"), 1);
  const value = (f, n) => f.type === "texto" ? `${f.label} ${n}` : f.type === "inteiro" ? 2000 + n : f.type === "numero" ? 7 + n / 2 : f.type === "booleano" ? n % 2 === 0 : `2024-0${n}-1${n}`;
  const sample = (Array.isArray(input.sample) && input.sample.length ? input.sample : [1, 2, 3].map((n) => Object.fromEntries(fields.map((f) => [f.name, value(f, n)])))).slice(0, 30).map((row, i) => ({ id: i + 1, ...Object.fromEntries(fields.map((f) => [f.name, row[f.name] ?? row[f.label] ?? value(f, i + 1)])) }));
  return { resource, fields, sample, port: Number(input.port) || 3000 };
}

const server = (s) => `// API REST de ${s.resource} (Node.js puro, sem dependências): os dados ficam em data.json.
//   GET    /${s.resource}          lista (filtro: ?q=texto)
//   GET    /${s.resource}/:id      um
//   POST   /${s.resource}          cria   (JSON no corpo)
//   PUT    /${s.resource}/:id      edita  (JSON no corpo; só os campos enviados)
//   DELETE /${s.resource}/:id      apaga
// Rodar: node server.js  (porta ${s.port}, ou PORT=4000 node server.js)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIELDS = ${JSON.stringify(s.fields.map(({ name, type, required }) => ({ name, type, required })))};

function createStore(file) {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  const save = (rows) => fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  return { load, save };
}

/** The fields of a body, checked: { value } or { error }. */
function validate(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Envie um objeto JSON." };
  const value = {};
  for (const f of FIELDS) {
    const v = body[f.name];
    if (v === undefined || v === null || v === "") { if (f.required && !partial) return { error: \`O campo "\${f.name}" é obrigatório.\` }; continue; }
    if ((f.type === "numero" || f.type === "inteiro") && !Number.isFinite(Number(v))) return { error: \`O campo "\${f.name}" precisa ser um número.\` };
    if (f.type === "inteiro" && !Number.isInteger(Number(v))) return { error: \`O campo "\${f.name}" precisa ser um número inteiro.\` };
    if (f.type === "booleano" && typeof v !== "boolean") return { error: \`O campo "\${f.name}" precisa ser true ou false.\` };
    value[f.name] = f.type === "numero" || f.type === "inteiro" ? Number(v) : f.type === "texto" ? String(v).trim() : v;
  }
  return { value };
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) reject(new Error("Corpo grande demais.")); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("JSON inválido.")); } });
  });
}

function createServer({ dataFile = path.join(__dirname, "data.json") } = {}) {
  const store = createStore(dataFile);
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204);
      const url = new URL(req.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "${s.resource}" || parts.length > 2) return send(res, 404, { error: "Rota não encontrada. Use /${s.resource}." });
      const rows = store.load();
      const id = parts[1] ? Number(parts[1]) : null;
      const at = id ? rows.findIndex((r) => r.id === id) : -1;
      if (req.method === "GET" && !id) {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        return send(res, 200, q ? rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q))) : rows);
      }
      if (id && at < 0) return send(res, 404, { error: \`\${id} não existe.\` });
      if (req.method === "GET") return send(res, 200, rows[at]);
      if (req.method === "POST" && !id) {
        const { value, error } = validate(await readBody(req));
        if (error) return send(res, 400, { error });
        const row = { id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1, ...value };
        store.save([...rows, row]);
        return send(res, 201, row);
      }
      if (req.method === "PUT" && id) {
        const { value, error } = validate(await readBody(req), { partial: true });
        if (error) return send(res, 400, { error });
        rows[at] = { ...rows[at], ...value, id };
        store.save(rows);
        return send(res, 200, rows[at]);
      }
      if (req.method === "DELETE" && id) { rows.splice(at, 1); store.save(rows); return send(res, 204); }
      return send(res, 405, { error: "Método não permitido." });
    } catch (error) { return send(res, 400, { error: error.message }); }
  });
}

module.exports = { createServer, validate, FIELDS };

// Started directly (node server.js), it listens; imported by the tests, it does not.
if (require.main === module) {
  const port = Number(process.env.PORT) || ${s.port};
  createServer().listen(port, () => console.log(\`API de ${s.resource} em http://localhost:\${port}/${s.resource}\`));
}
`;

const tests = (s) => {
  const one = s.sample[0];
  const body = Object.fromEntries(s.fields.map((f) => [f.name, one[f.name]]));
  const firstRequired = s.fields.find((f) => f.required);
  const textField = s.fields.find((f) => f.type === "texto");
  return `// Testes da API de ${s.resource} (node:test, sem dependências). Rodar: node --test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server.js");

let server, base, dataFile;
before(async () => {
  dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "api-")), "data.json");
  fs.writeFileSync(dataFile, "[]");
  server = createServer({ dataFile });
  await new Promise((r) => server.listen(0, r));            // porta livre
  base = \`http://127.0.0.1:\${server.address().port}/${s.resource}\`;
});
after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
};

test("cria, lista, busca, edita e apaga", async () => {
  const created = await call("POST", base, ${JSON.stringify(body)});
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.data.id, 1);
  const list = await call("GET", base);
  assert.strictEqual(list.data.length, 1);
  const got = await call("GET", \`\${base}/1\`);
  assert.deepStrictEqual(got.data, created.data);
${textField ? `  const edited = await call("PUT", \`\${base}/1\`, { ${textField.name}: "Editado" });
  assert.strictEqual(edited.data.${textField.name}, "Editado");
  const found = await call("GET", \`\${base}?q=editado\`);
  assert.strictEqual(found.data.length, 1);
` : ""}  const removed = await call("DELETE", \`\${base}/1\`);
  assert.strictEqual(removed.status, 204);
  assert.strictEqual((await call("GET", \`\${base}/1\`)).status, 404);
});

test("recusa dados inválidos e rotas que não existem", async () => {
${firstRequired ? `  const missing = await call("POST", base, {});
  assert.strictEqual(missing.status, 400);
  assert.match(missing.data.error, /${firstRequired.name}/);
` : ""}  assert.strictEqual((await call("GET", \`\${base.replace("/${s.resource}", "")}/nada\`)).status, 404);
  assert.strictEqual((await call("GET", \`\${base}/999\`)).status, 404);
});
`;
};

const readme = (s) => `# API de ${s.resource}

API REST em Node.js, sem dependências. Os dados ficam em \`data.json\`.

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | /${s.resource} | lista (busca: \`?q=texto\`) |
| GET | /${s.resource}/:id | um |
| POST | /${s.resource} | cria |
| PUT | /${s.resource}/:id | edita |
| DELETE | /${s.resource}/:id | apaga |

Campos: ${s.fields.map((f) => `\`${f.name}\` (${f.type}${f.required ? ", obrigatório" : ""})`).join(", ")}.

- Rodar: \`node server.js\` e abrir http://localhost:${s.port}/${s.resource}
- Testes: \`node --test\`
`;

/** Writes the API in `dir`; returns { spec, files }. */
export async function buildApi(dir, input, { write = null } = {}) {
  const s = apiSpec(input);
  const files = {
    "server.js": server(s), "test/api.test.js": tests(s), "data.json": `${JSON.stringify(s.sample, null, 2)}\n`,
    "package.json": `${JSON.stringify({ name: `api-${s.resource}`, version: "1.0.0", private: true, scripts: { start: "node server.js", test: "node --test" } }, null, 2)}\n`,
    "README.md": readme(s),
  };
  for (const [rel, text] of Object.entries(files)) { const file = join(dir, rel); if (write) { await write(file, text); continue; } await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, text, "utf8"); }
  return { spec: s, files: Object.keys(files) };
}
