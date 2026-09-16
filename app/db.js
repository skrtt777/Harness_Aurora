import DatabaseConstructor from "better-sqlite3";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const dbFile = process.env.HARNESS_DB_FILE || join(dataDir, "harness.db");
const legacyMemoryFile = join(dataDir, "memory.json");

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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_id, conversation_id);
`;

let instance = null;

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
      VALUES (@id, 'global', NULL, NULL, @title, @content, '[]', 'imported', 'Migrado de memory.json', @created_at, @created_at)
    `);
    const insertMany = db.transaction((items) => {
      for (const node of items) {
        insert.run({
          id: `legacy-${node.id || Math.random().toString(36).slice(2)}`,
          title: String(node.label || node.title || "Memória importada"),
          content: String(node.content || ""),
          created_at: node.createdAt || now,
        });
      }
    });
    insertMany(nodes);
  } catch {
    // A legacy file that cannot be parsed is skipped; nothing is destroyed.
  }
}

export async function getDb() {
  if (instance) return instance;
  await mkdir(dataDir, { recursive: true });
  instance = new DatabaseConstructor(dbFile);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.exec(SCHEMA);
  migrateLegacyMemory(instance);
  return instance;
}

export function resetDbForTests(file) {
  instance = new DatabaseConstructor(file || ":memory:");
  instance.pragma("foreign_keys = ON");
  instance.exec(SCHEMA);
  return instance;
}

export async function readLegacyMemoryFile() {
  try {
    return JSON.parse(await readFile(legacyMemoryFile, "utf8"));
  } catch {
    return { nodes: [], edges: [] };
  }
}
