// Offline subprocess fixture. Never imports or calls a real provider.
const args = process.argv.slice(2);
const claude = args.includes("--output-format");
// Real CLIs read the prompt from stdin ("-" for Codex, no positional for Claude).
let stdin = "";
if (!process.stdin.isTTY) for await (const chunk of process.stdin) stdin += chunk;
const prompt = stdin || (claude ? args[args.indexOf("-p") + 1] : args.at(-1));
const extracting = prompt?.includes("extrator de memória de longo prazo");
const correcting = prompt?.includes("modelo de IA local e pequeno respondeu");
const reviewing = prompt?.includes("Você é o professor de um assistente local");
if (reviewing && process.env.FAKE_REVIEW_LOG) (await import("node:fs")).appendFileSync(process.env.FAKE_REVIEW_LOG, JSON.stringify({ cwd: process.cwd(), prompt }) + "\n");
await new Promise(resolve => setTimeout(resolve, Number(extracting ? process.env.FAKE_EXTRACTION_DELAY_MS || 0 : process.env.FAKE_CLI_DELAY_MS || 0)));
let text = reviewing ? (process.env.FAKE_REVIEW || JSON.stringify({ verdict: "fix", problems: ["O arquivo não imprime o resultado."], guidance: "Adicione console.log(resultado) em soma.js e rode de novo.", lessons: [{ title: "Conferir saída", content: "Depois de criar um script de linha de comando, rode-o e confira que imprime o resultado esperado.", tags: ["node"] }], skill: null }))
  : extracting ? JSON.stringify([{ title: "Test fact", content: "A pessoa usa o nome de teste Alice.", tags: ["teste"] }])
  : correcting ? JSON.stringify({ answer: "Resposta corrigida de teste", memories: [] })
  : JSON.stringify({ answer: "Resposta offline", args, promptLength: prompt?.length ?? 0 });
if (process.env.FAKE_CLI_INVALID === "1") text = "";
if (claude) console.log(JSON.stringify({ result: text, session_id: "fixture", is_error: process.env.FAKE_CLI_ERROR === "1" }));
else console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
