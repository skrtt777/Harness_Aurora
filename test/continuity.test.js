import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-continuidade-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
const store = await import("../app/store.js");
const profile = await import("../app/profile.js");
const diary = await import("../app/diary.js");

test("what the person says about themselves is learned once, the name replaced, and shown in every conversation", async () => {
  await profile.learnFromMessage("Oi! Meu nome é Rafaela e eu cuido das parcerias com criadores.");
  await profile.learnFromMessage("quanto custa o reel?");
  await profile.learnFromMessage("Trabalho com marketing de influência na agência Luz.");
  await profile.learnFromMessage("Trabalho com marketing de influência na agência Luz.");
  await profile.learnFromMessage("Pode me chamar de Rafa.");
  const { learned } = await profile.getProfile();
  assert.deepEqual(learned.map((l) => l.text), ["Trabalho com marketing de influência na agência Luz.", "Nome: Rafa"]);
  await profile.saveProfile({ text: "Prefiro respostas curtas." });
  const [block] = await profile.profileBlock();
  assert.match(block, /A pessoa se chama Rafa\. Se ela perguntar o próprio nome, é Rafa[\s\S]*Prefiro respostas curtas\.\n- Trabalho com marketing/);
});

test("the diary lists what was created and organized today and yesterday, with full paths, not older", async () => {
  const c = await store.createConversation({ provider: "local", title: "Planilha de cobrança" });
  await store.addMessage({ conversationId: c.id, role: "assistant", content: "Pronto.", execution: { toolSteps: [{ tool: "write_document", ok: true, summary: "Criei C:/Docs/cobranca.xlsx (XLSX, 10 bytes)." }, { tool: "read_file", ok: true, summary: "Li x" }] } });
  const d = await store.createConversation({ provider: "local", title: "Organizar Downloads" });
  await store.addMessage({ conversationId: d.id, role: "assistant", content: "Organizei.", execution: { toolSteps: [{ tool: "organize_folder", ok: true, summary: "Organizei" }], moves: [{ from: "a", to: "b" }, { from: "c", to: "d" }] } });
  const db = await (await import("../app/db.js")).getDb();
  const old = await store.createConversation({ provider: "local", title: "Antigo" });
  const m = await store.addMessage({ conversationId: old.id, role: "assistant", content: "x", execution: { toolSteps: [{ tool: "write_file", ok: true, summary: "Salvei C:/velho.txt (1 bytes)." }] } });
  db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 5 * 86_400_000).toISOString(), m.id);
  const [block] = await diary.diaryBlock();
  assert.match(block, /hoje .*"Planilha de cobrança": criou\/editou C:\/Docs\/cobranca\.xlsx/);
  assert.match(block, /"Organizar Downloads": organizou 2 arquivo\(s\)/);
  assert.doesNotMatch(block, /velho/, "older than yesterday is not in it");
});

test("'qual é o meu nome?' with a name in the profile is answered from it, as an observation", async () => {
  const profile = await import("../app/profile.js");
  await profile.learnFromMessage("Pode me chamar de Rafa.");
  const seen = await profile.nameObservation("qual é o meu nome?");
  assert.match(seen.block, /é Rafa\b/);
  assert.equal(await profile.nameObservation("qual é o nome do arquivo?"), null);
});
