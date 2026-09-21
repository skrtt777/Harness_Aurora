import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const legacyMemoryFile = join(dataDir, "memory.json");

// Resolved lazily (inside getDb(), not at module load time): Electron's main
// process sets HARNESS_DB_FILE only after app.whenReady(), which runs after
// this module's static `import` chain has already been evaluated. Reading
// process.env.HARNESS_DB_FILE here at the top level would permanently bake in
// the default path (inside app/data, read-only once packaged into an asar).
function resolveDbFile() {
  return process.env.HARNESS_DB_FILE || join(dataDir, "harness.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'codex',
  teacher_provider TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  provider TEXT,
  memory_access TEXT NOT NULL DEFAULT '[]',
  memory_created TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global','project','conversation')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','extracted','imported')),
  source TEXT,
  embedding BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('belonging','thematic','derivation','correction')),
  created_at TEXT NOT NULL,
  UNIQUE(from_id, to_id, type)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON memory_relations(to_id);
`;

let instance = null;
let initialization = null;

// `CREATE TABLE IF NOT EXISTS` only shapes brand-new databases — an existing
// database (like a real user's) keeps whatever columns it had when it was
// first created. Adding a column to an existing table needs an explicit
// ALTER TABLE, checked for idempotently via PRAGMA table_info.
function migrateSchema(db) {
  const messageColumns = db.prepare("PRAGMA table_info(messages)").all();
  if (!messageColumns.some(c => c.name === "memory_status")) db.exec("ALTER TABLE messages ADD COLUMN memory_status TEXT NOT NULL DEFAULT 'none'");
  if (!messageColumns.some(c => c.name === "execution")) db.exec("ALTER TABLE messages ADD COLUMN execution TEXT");
  if (!messageColumns.some(c => c.name === "correction_of")) db.exec("ALTER TABLE messages ADD COLUMN correction_of TEXT REFERENCES messages(id) ON DELETE SET NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_message_correction ON messages(correction_of) WHERE correction_of IS NOT NULL");
  const conversationColumns = db.prepare("PRAGMA table_info(conversations)").all();
  if (!conversationColumns.some((c) => c.name === "teacher_provider")) {
    db.exec("ALTER TABLE conversations ADD COLUMN teacher_provider TEXT");
  }
  // Marco 3 (ROADMAP_MELHORIAS.md): busca de memória por similaridade —
  // vetor de embedding por memória, calculado sob demanda via Ollama.
  // NULL em memórias existentes/sem Ollama disponível é o estado normal,
  // não um erro: selectRelevantMemories() cai de volta pra palavras-chave.
  const memoryColumns = db.prepare("PRAGMA table_info(memories)").all();
  if (!memoryColumns.some((c) => c.name === "embedding")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding BLOB");
  }
  if (!memoryColumns.some(c => c.name === "embedding_model")) db.exec("ALTER TABLE memories ADD COLUMN embedding_model TEXT");
  if (!memoryColumns.some(c => c.name === "revision")) db.exec("ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
}

function migrateLegacyMemory(db) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM memories").get();
  if (count > 0 || !existsSync(legacyMemoryFile)) return;

  try {
    const raw = JSON.parse(readFileSync(legacyMemoryFile, "utf8"));
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    if (!nodes.length) return;
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO memories (id, scope, project_id, conversation_id, title, content, tags, kind, source, created_at, updated_at)
      VALUES (?, 'global', NULL, NULL, ?, ?, '[]', 'imported', 'Migrado de memory.json', ?, ?)
    `);
    db.exec("BEGIN");
    try {
      for (const node of nodes) {
        const createdAt = node.createdAt || now;
        insert.run(
          `legacy-${node.id || Math.random().toString(36).slice(2)}`,
          String(node.label || node.title || "Memória importada"),
          String(node.content || ""),
          createdAt,
          createdAt
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch {
    // A legacy file that cannot be parsed is skipped; nothing is destroyed.
  }
}

export async function getDb() {
  if (instance) return instance;
  if (!initialization) initialization = (async () => {
    const dbFile = resolveDbFile();
    await mkdir(dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    try {
      db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
      db.exec(SCHEMA);
      migrateSchema(db);
      db.exec("UPDATE messages SET memory_status = 'interrupted' WHERE memory_status = 'pending'");
      migrateLegacyMemory(db);
      instance = db;
      return db;
    } catch (error) { db.close(); throw error; }
  })().finally(() => { initialization = null; });
  return initialization;
}

export function resetDbForTests(file) {
  instance?.close();
  instance = new DatabaseSync(file || ":memory:");
  instance.exec("PRAGMA foreign_keys = ON");
  instance.exec(SCHEMA);
  migrateSchema(instance);
  return instance;
}

export async function readLegacyMemoryFile() {
  try {
    return JSON.parse(await readFile(legacyMemoryFile, "utf8"));
  } catch {
    return { nodes: [], edges: [] };
  }
}
