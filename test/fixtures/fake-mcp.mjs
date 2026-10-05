// A tiny MCP server over stdio for the tests: a calendar with one read-only tool and one that writes.
import { createInterface } from "node:readline";

const tools = [
  { name: "ler_agenda", description: "Lista os compromissos de um dia", inputSchema: { type: "object", properties: { dia: { type: "string" } }, required: ["dia"] }, annotations: { readOnlyHint: true } },
  { name: "criar_evento", description: "Cria um compromisso", inputSchema: { type: "object", properties: { titulo: { type: "string" } }, required: ["titulo"] } },
];
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
console.log("servidor de agenda iniciado (uma linha de log que não é JSON-RPC)");

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return; // notifications
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize") return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "agenda-falsa", version: "1" } });
  if (message.method === "tools/list") return reply({ tools });
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    if (name === "ler_agenda") return reply({ content: [{ type: "text", text: `${args.dia}: 09:00 Reunião com o Financeiro; 14:00 Dentista` }] });
    if (name === "criar_evento") return reply(args.titulo ? { content: [{ type: "text", text: `Criei "${args.titulo}".` }] } : { isError: true, content: [{ type: "text", text: "Falta o título." }] });
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Método desconhecido: ${message.method}` } });
});
