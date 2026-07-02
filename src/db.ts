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

type RuleCountRow = {
  count: number;
};

type LegacyRuleRow = {
  chat_id: number;
  topic_id: number;
  types: string;
};

const configuredDbPath = process.env.DB_PATH?.trim();
const dbPath =
  configuredDbPath && configuredDbPath.length > 0
    ? path.resolve(configuredDbPath)
    : path.resolve(process.cwd(), "data", "bot.db");
const dataDir = path.dirname(dbPath);
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);

export function getDatabasePath(): string {
  return dbPath;
}

function getTopicRuleCount(database: Database.Database): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM topic_rules")
    .get() as RuleCountRow;
  return row.count;
}

function getLegacyTypeColumnName(
  database: Database.Database
): "restricted_types" | "allowed_types" | null {
  const columns = database
    .prepare("PRAGMA table_info(topic_rules)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "restricted_types")) {
    return "restricted_types";
  }
  if (columns.some((column) => column.name === "allowed_types")) {
    return "allowed_types";
  }
  return null;
}

function getLegacyDbCandidates(): string[] {
  const rawCandidates = [
    path.resolve(process.cwd(), "bot.db"),
    path.resolve(process.cwd(), "data", "bot.db"),
    "/app/bot.db",
    "/app/data/bot.db",
  ];

  return Array.from(new Set(rawCandidates)).filter(
    (candidate) => candidate !== dbPath
  );
}

function importRulesFromLegacyDb(legacyDbPath: string): number {
  if (!fs.existsSync(legacyDbPath)) return 0;
  const stats = fs.statSync(legacyDbPath);
  if (!stats.isFile() || stats.size === 0) return 0;

  const legacyDb = new Database(legacyDbPath, { readonly: true });

  try {
    const tableExists = legacyDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic_rules'"
      )
      .get() as { name: string } | undefined;
    if (!tableExists) return 0;

    const typeColumn = getLegacyTypeColumnName(legacyDb);
    if (!typeColumn) return 0;

    const rows = legacyDb
      .prepare(
        `SELECT chat_id, topic_id, ${typeColumn} AS types
         FROM topic_rules
         WHERE ${typeColumn} IS NOT NULL`
      )
      .all() as LegacyRuleRow[];

    if (rows.length === 0) return 0;

    const upsert = db.prepare(
      `INSERT INTO topic_rules (chat_id, topic_id, restricted_types, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(chat_id, topic_id) DO UPDATE SET
         restricted_types = excluded.restricted_types,
         updated_at = datetime('now')`
    );

    const transaction = db.transaction((items: LegacyRuleRow[]) => {
      for (const item of items) {
        upsert.run(item.chat_id, item.topic_id, item.types);
      }
    });
    transaction(rows);

    return rows.length;
  } finally {
    legacyDb.close();
  }
}

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

  if (getTopicRuleCount(db) > 0) return;

  for (const legacyDbPath of getLegacyDbCandidates()) {
    const importedCount = importRulesFromLegacyDb(legacyDbPath);
    if (importedCount > 0) {
      console.log(
        `[db] imported ${importedCount} topic rules from legacy DB: ${legacyDbPath}`
      );
      return;
    }
  }
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
