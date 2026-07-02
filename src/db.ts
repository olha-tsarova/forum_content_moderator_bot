import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type MessageType =
  | "text"
  | "photo"
  | "document"
  | "video"
  | "audio"
  | "sticker"
  | "voice"
  | "video_note"
  | "animation";

type TopicRuleRow = {
  topic_id: number;
  restricted_types: string | null;
};

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.join(dataDir, "bot.db");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);

function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_rules (
      chat_id INTEGER NOT NULL,
      topic_id INTEGER NOT NULL,
      restricted_types TEXT NOT NULL,
      updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, topic_id)
    );
  `);

  const columns = db
    .prepare("PRAGMA table_info(topic_rules)")
    .all() as Array<{ name: string }>;
  const hasRestrictedTypes = columns.some(
    (column) => column.name === "restricted_types"
  );
  const hasAllowedTypes = columns.some((column) => column.name === "allowed_types");
  if (!hasRestrictedTypes && hasAllowedTypes) {
    db.exec("ALTER TABLE topic_rules ADD COLUMN restricted_types TEXT;");
    db.exec(
      "UPDATE topic_rules SET restricted_types = allowed_types WHERE restricted_types IS NULL"
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_settings (
      chat_id INTEGER PRIMARY KEY,
      warning_ttl_ms INTEGER NOT NULL DEFAULT 5000
    );
  `);
}

initDb();

export function getRestrictedTypes(
  chatId: number,
  topicId: number
): MessageType[] | null {
  const row = db
    .prepare(
      "SELECT restricted_types FROM topic_rules WHERE chat_id = ? AND topic_id = ?"
    )
    .get(chatId, topicId) as { restricted_types: string | null } | undefined;

  if (!row || !row.restricted_types) return null;
  return JSON.parse(row.restricted_types) as MessageType[];
}

export function setRestrictedTypes(
  chatId: number,
  topicId: number,
  restrictedTypes: MessageType[],
  updatedBy: number
): void {
  db.prepare(
    `INSERT INTO topic_rules (chat_id, topic_id, restricted_types, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id, topic_id) DO UPDATE SET
       restricted_types = excluded.restricted_types,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).run(chatId, topicId, JSON.stringify(restrictedTypes), updatedBy);
}

export function resetTopicRule(chatId: number, topicId: number): void {
  db.prepare("DELETE FROM topic_rules WHERE chat_id = ? AND topic_id = ?").run(
    chatId,
    topicId
  );
}

export function listTopicRules(
  chatId: number
): Array<{ topicId: number; restrictedTypes: MessageType[] }> {
  const rows = db
    .prepare(
      "SELECT topic_id, restricted_types FROM topic_rules WHERE chat_id = ? ORDER BY topic_id ASC"
    )
    .all(chatId) as TopicRuleRow[];

  return rows.map((row) => ({
    topicId: row.topic_id,
    restrictedTypes: row.restricted_types
      ? (JSON.parse(row.restricted_types) as MessageType[])
      : [],
  }));
}

export function getWarningTtl(chatId: number): number {
  const row = db
    .prepare("SELECT warning_ttl_ms FROM chat_settings WHERE chat_id = ?")
    .get(chatId) as { warning_ttl_ms: number } | undefined;
  return row?.warning_ttl_ms ?? 5000;
}
