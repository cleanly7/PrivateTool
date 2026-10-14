import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  DistractionInput,
  DistractionRecord,
  FocusSubject,
  SessionInput,
  SessionRecord,
  Transaction,
  TransactionInput,
  WaterIntake,
  WaterSettings,
} from "./types.ts";
import { DEFAULT_WATER_SETTINGS } from "./types.ts";
import { isWaterSettings } from "./input.ts";

let db: DatabaseSync | null = null;

function resolveDataDir(): string {
  const override = process.env.PRIVATE_TOOLBOX_DATA_DIR;
  return override ? path.resolve(override) : path.join(process.cwd(), "data");
}

export function getDb(): DatabaseSync {
  if (!db) {
    const dataDir = resolveDataDir();
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(path.join(dataDir, "bookkeeping.db"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        amount REAL NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS budgets (
        month TEXT PRIMARY KEY,
        amount REAL NOT NULL CHECK (amount > 0)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('meditation', 'focus', 'pomodoro')),
        planned_minutes INTEGER NOT NULL CHECK (planned_minutes > 0),
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        actual_seconds INTEGER,
        title TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS time_distractions (
        id TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('session', 'schedule_block')),
        target_id TEXT NOT NULL,
        at TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_time_distractions_target
        ON time_distractions (target_kind, target_id);

      CREATE TABLE IF NOT EXISTS water_intake (
        id TEXT PRIMARY KEY,
        amount_ml REAL NOT NULL CHECK (amount_ml > 0),
        logged_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    migrateSessions(db, dataDir);
  }
  return db;
}

function migrateSessions(database: DatabaseSync, dataDir: string): void {
  migrateSessionSubject(database);
  migrateSessionKindAndDuration(database, dataDir);
  migrateDistractionsTable(database);
}

/**
 * 分心表中间版本叫 `focus_distractions`（只关联专注记录）。
 * 后来改成通用表 `time_distractions`（日程模块的计时段也要记分心），
 * 这里把老表的行搬过去再删掉老表：新表建出来之前没发布过，所以只可能是本机开发时的数据。
 * 幂等：老表不存在就直接返回。
 */
function migrateDistractionsTable(database: DatabaseSync): void {
  const legacy = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'focus_distractions'",
    )
    .get();
  if (!legacy) return;
  database.exec(`
    INSERT OR IGNORE INTO time_distractions (id, target_kind, target_id, at, reason)
      SELECT id, 'session', session_id, at, reason FROM focus_distractions;
    DROP TABLE focus_distractions;
  `);
}

/**
 * 老库的 sessions 表没有 subject 列（专注内容：技术学习 / 日语），
 * 这里补一列，已有记录统一为空字符串（统计里算「未分类」）。
 */
function migrateSessionSubject(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(sessions)")
    .all() as unknown as { name: string }[];
  if (columns.some((column) => column.name === "subject")) return;
  database.exec(
    "ALTER TABLE sessions ADD COLUMN subject TEXT NOT NULL DEFAULT ''",
  );
}

/**
 * 专注时间从「倒计时」改成正计时，有两处老结构要一起升级：
 *   1. kind：老专注记录是 'pomodoro'，改成 'focus'（'pomodoro' 留给以后的番茄钟模块）；
 *   2. 新增 actual_seconds（实际有效秒数）和 title（这段在做什么）。
 * CHECK 约束改不了，只能在事务里建新表、搬数据、换名。动手前先 VACUUM INTO
 * 备份一份原库，万一搬数据出问题还能翻回去。
 */
function migrateSessionKindAndDuration(
  database: DatabaseSync,
  dataDir: string,
): void {
  const tableSql = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
    )
    .get() as { sql: string } | undefined;
  const columns = database
    .prepare("PRAGMA table_info(sessions)")
    .all() as unknown as { name: string }[];
  const hasColumn = (name: string) =>
    columns.some((column) => column.name === name);

  const needsKindMigration = !(tableSql?.sql ?? "").includes("'focus'");
  if (!needsKindMigration && hasColumn("actual_seconds") && hasColumn("title")) {
    return;
  }

  backupDatabase(database, dataDir);

  database.exec("BEGIN");
  try {
    database.exec(`
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('meditation', 'focus', 'pomodoro')),
        planned_minutes INTEGER NOT NULL CHECK (planned_minutes > 0),
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        actual_seconds INTEGER,
        title TEXT NOT NULL DEFAULT ''
      );

      INSERT INTO sessions_new (
        id, kind, planned_minutes, started_at, completed_at, note, subject, actual_seconds, title
      )
      SELECT id,
             CASE WHEN kind = 'pomodoro' THEN 'focus' ELSE kind END,
             planned_minutes,
             started_at,
             completed_at,
             note,
             subject,
             NULL,
             ''
      FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** 迁移前留一份原库快照（data/bookkeeping.backup-<时间戳>.db）。 */
function backupDatabase(database: DatabaseSync, dataDir: string): void {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const target = path.join(dataDir, `bookkeeping.backup-${stamp}.db`);
  try {
    database.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log(`[db] 迁移前已备份：${target}`);
  } catch (error) {
    // 备份失败不阻塞启动，但要说清楚：这次迁移没有快照可回退。
    console.error("[db] 迁移前备份失败，继续执行迁移", error);
  }
}

export function listTransactions(): Transaction[] {
  return getDb()
    .prepare("SELECT * FROM transactions ORDER BY date DESC, created_at DESC")
    .all() as unknown as Transaction[];
}

export function getTransaction(id: string): Transaction | null {
  return getDb()
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(id) as unknown as Transaction | null;
}

export function createTransaction(input: TransactionInput): Transaction {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO transactions (id, type, amount, category, note, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.type,
      input.amount,
      input.category,
      input.note,
      input.date,
      createdAt,
    );
  return { id, ...input, created_at: createdAt };
}

export function updateTransaction(
  id: string,
  input: TransactionInput,
): Transaction | null {
  getDb()
    .prepare(
      `UPDATE transactions
       SET type = ?, amount = ?, category = ?, note = ?, date = ?
       WHERE id = ?`,
    )
    .run(
      input.type,
      input.amount,
      input.category,
      input.note,
      input.date,
      id,
    );
  return getTransaction(id);
}

export function deleteTransaction(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM transactions WHERE id = ?")
    .run(id);
  return Number(result.changes) > 0;
}

export function getBudget(month: string): number | null {
  const row = getDb()
    .prepare("SELECT amount FROM budgets WHERE month = ?")
    .get(month) as { amount: number } | undefined;
  return row ? row.amount : null;
}

export function setBudget(month: string, amount: number): void {
  getDb()
    .prepare(
      `INSERT INTO budgets (month, amount) VALUES (?, ?)
       ON CONFLICT(month) DO UPDATE SET amount = excluded.amount`,
    )
    .run(month, amount);
}

export function deleteBudget(month: string): void {
  getDb().prepare("DELETE FROM budgets WHERE month = ?").run(month);
}

/**
 * 分心单独一张通用表 `time_distractions`（一次专注可以有很多条），读的时候挂到对应记录上。
 * 量级是「一个人一天几十条」，直接一次读出来按 target_id 分组就够。
 * **查询必须带 `target_kind = 'session'`**：日程模块的计时段共用这张表，不加条件会把它们混进来。
 */
function attachDistractions(sessions: SessionRecord[]): SessionRecord[] {
  if (sessions.length === 0) return sessions;
  const rows = getDb()
    .prepare(
      `SELECT id, target_id, at, reason FROM time_distractions
       WHERE target_kind = 'session' ORDER BY at`,
    )
    .all() as unknown as { id: string; target_id: string; at: string; reason: string }[];
  const bySession = new Map<string, DistractionRecord[]>();
  for (const row of rows) {
    const record: DistractionRecord = {
      id: row.id,
      at: row.at,
      reason: row.reason,
    };
    const list = bySession.get(row.target_id);
    if (list) list.push(record);
    else bySession.set(row.target_id, [record]);
  }
  return sessions.map((session) => ({
    ...session,
    distractions: bySession.get(session.id) ?? [],
  }));
}

export function listSessions(): SessionRecord[] {
  const sessions = getDb()
    .prepare("SELECT * FROM sessions ORDER BY started_at DESC")
    .all() as unknown as SessionRecord[];
  return attachDistractions(sessions);
}

export function getSession(id: string): SessionRecord | null {
  const session = getDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as unknown as SessionRecord | null;
  if (!session) return null;
  return attachDistractions([session])[0];
}

export function createSession(input: SessionInput): SessionRecord {
  const id = randomUUID();
  const database = getDb();
  const distractions: DistractionRecord[] = input.distractions.map((item) => ({
    id: randomUUID(),
    at: item.at,
    reason: item.reason,
  }));
  const insertSession = database.prepare(
    `INSERT INTO sessions (
       id, kind, planned_minutes, started_at, completed_at, note, subject, actual_seconds, title
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDistraction = database.prepare(
    `INSERT INTO time_distractions (id, target_kind, target_id, at, reason)
     VALUES (?, 'session', ?, ?, ?)`,
  );

  // 记录和它的分心要么一起进去，要么都不进去。
  database.exec("BEGIN");
  try {
    insertSession.run(
      id,
      input.kind,
      input.planned_minutes,
      input.started_at,
      input.completed_at,
      input.note,
      input.subject,
      input.actual_seconds,
      input.title,
    );
    for (const item of distractions) {
      insertDistraction.run(item.id, id, item.at, item.reason);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { id, ...input, distractions };
}

export interface SessionUpdate {
  note: string;
  subject: FocusSubject | "";
  /** 大标题：不传就保持原值。 */
  title?: string;
  /** 手动校正过的实际时长（秒）：不传就保持原值。 */
  actual_seconds?: number | null;
  /**
   * 事后补/删分心：不传就保持原样；传了（包括空数组）就整批替换。
   * 分心条目本身没有「就地改 id」的概念（`at` 才是它的身份），所以是替换语义。
   */
  distractions?: DistractionInput[];
}

export function updateSession(
  id: string,
  update: SessionUpdate,
): SessionRecord | null {
  const existing = getSession(id);
  if (!existing) return null;
  const title = update.title ?? existing.title;
  const actualSeconds =
    update.actual_seconds === undefined
      ? existing.actual_seconds
      : update.actual_seconds;
  // planned_minutes 的历史口径就是「折算成分钟」，改实际时长时要跟着一起改，
  // 否则这一列会和 actual_seconds 说的是两件事（显示走 sessionSeconds，看不出问题，
  // 但导出/排查数据时会被误导）。
  const plannedMinutes =
    actualSeconds === null || actualSeconds === undefined
      ? existing.planned_minutes
      : Math.max(1, Math.round(actualSeconds / 60));
  const database = getDb();
  // 记录本体和它的分心行要么一起改，要么都不改（改完分心一半失败最难查）。
  database.exec("BEGIN");
  try {
    database
      .prepare(
        `UPDATE sessions
         SET note = ?, subject = ?, title = ?, actual_seconds = ?, planned_minutes = ?
         WHERE id = ?`,
      )
      .run(update.note, update.subject, title, actualSeconds, plannedMinutes, id);
    if (update.distractions) {
      // 条件里必须含 target_kind：两种 target 共用 time_distractions，
      // 少了它会误删同 id 的日程块分心。
      database
        .prepare(
          "DELETE FROM time_distractions WHERE target_kind = 'session' AND target_id = ?",
        )
        .run(id);
      const insertDistraction = database.prepare(
        `INSERT INTO time_distractions (id, target_kind, target_id, at, reason)
         VALUES (?, 'session', ?, ?, ?)`,
      );
      for (const item of update.distractions) {
        insertDistraction.run(randomUUID(), id, item.at, item.reason);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getSession(id);
}

export function deleteSession(id: string): boolean {
  const database = getDb();
  // 表没有外键约束，删记录要自己带上分心行；条件里必须含 target_kind，
  // 否则会误删同 id 的日程块分心（两种 target 共用一张表）。
  database
    .prepare(
      "DELETE FROM time_distractions WHERE target_kind = 'session' AND target_id = ?",
    )
    .run(id);
  const result = database.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function listWaterIntake(): WaterIntake[] {
  return getDb()
    .prepare("SELECT * FROM water_intake ORDER BY logged_at DESC")
    .all() as unknown as WaterIntake[];
}

export function createWaterIntake(amountMl: number): WaterIntake {
  const id = randomUUID();
  const loggedAt = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO water_intake (id, amount_ml, logged_at) VALUES (?, ?, ?)")
    .run(id, amountMl, loggedAt);
  return { id, amount_ml: amountMl, logged_at: loggedAt };
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function readWaterSettings(): WaterSettings {
  const raw = getSetting("water");
  if (!raw) return DEFAULT_WATER_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<WaterSettings>;
    const merged: WaterSettings = { ...DEFAULT_WATER_SETTINGS, ...parsed };
    return isWaterSettings(merged) ? merged : DEFAULT_WATER_SETTINGS;
  } catch {
    return DEFAULT_WATER_SETTINGS;
  }
}
