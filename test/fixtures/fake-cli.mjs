// Offline subprocess fixture. Never imports or calls a real provider.
const args = process.argv.slice(2);
const claude = args.includes("--output-format");
const prompt = claude ? args[args.indexOf("-p") + 1] : args.at(-1);
const extracting = prompt?.includes("extrator de memória de longo prazo");
const correcting = prompt?.includes("modelo de IA local e pequeno respondeu");
await new Promise(resolve => setTimeout(resolve, Number(extracting ? process.env.FAKE_EXTRACTION_DELAY_MS || 0 : process.env.FAKE_CLI_DELAY_MS || 0)));
let text = extracting ? JSON.stringify([{ title: "Test fact", content: "A pessoa usa o nome de teste Alice.", tags: ["teste"] }])
  : correcting ? JSON.stringify({ answer: "Resposta corrigida de teste", memories: [] })
  : JSON.stringify({ answer: "Resposta offline", args });
if (process.env.FAKE_CLI_INVALID === "1") text = "";
if (claude) console.log(JSON.stringify({ result: text, session_id: "fixture", is_error: process.env.FAKE_CLI_ERROR === "1" }));
else console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
