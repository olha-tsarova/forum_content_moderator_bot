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
  allowed_types: string;
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
      allowed_types TEXT NOT NULL,
      updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, topic_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_settings (
      chat_id INTEGER PRIMARY KEY,
      warning_ttl_ms INTEGER NOT NULL DEFAULT 5000
    );
  `);
}

initDb();

export function getAllowedTypes(
  chatId: number,
  topicId: number
): MessageType[] | null {
  const row = db
    .prepare(
      "SELECT allowed_types FROM topic_rules WHERE chat_id = ? AND topic_id = ?"
    )
    .get(chatId, topicId) as { allowed_types: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.allowed_types) as MessageType[];
}

export function setAllowedTypes(
  chatId: number,
  topicId: number,
  allowedTypes: MessageType[],
  updatedBy: number
): void {
  db.prepare(
    `INSERT INTO topic_rules (chat_id, topic_id, allowed_types, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id, topic_id) DO UPDATE SET
       allowed_types = excluded.allowed_types,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).run(chatId, topicId, JSON.stringify(allowedTypes), updatedBy);
}

export function resetTopicRule(chatId: number, topicId: number): void {
  db.prepare("DELETE FROM topic_rules WHERE chat_id = ? AND topic_id = ?").run(
    chatId,
    topicId
  );
}

export function listTopicRules(
  chatId: number
): Array<{ topicId: number; allowedTypes: MessageType[] }> {
  const rows = db
    .prepare(
      "SELECT topic_id, allowed_types FROM topic_rules WHERE chat_id = ? ORDER BY topic_id ASC"
    )
    .all(chatId) as TopicRuleRow[];

  return rows.map((row) => ({
    topicId: row.topic_id,
    allowedTypes: JSON.parse(row.allowed_types) as MessageType[],
  }));
}

export function getWarningTtl(chatId: number): number {
  const row = db
    .prepare("SELECT warning_ttl_ms FROM chat_settings WHERE chat_id = ?")
    .get(chatId) as { warning_ttl_ms: number } | undefined;
  return row?.warning_ttl_ms ?? 5000;
}
