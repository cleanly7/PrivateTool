import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  SessionInput,
  SessionRecord,
  Transaction,
  TransactionInput,
} from "./types";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    const dataDir = path.join(process.cwd(), "data");
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
        kind TEXT NOT NULL CHECK (kind IN ('meditation', 'pomodoro')),
        planned_minutes INTEGER NOT NULL CHECK (planned_minutes > 0),
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT ''
      );
    `);
  }
  return db;
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

export function listSessions(): SessionRecord[] {
  return getDb()
    .prepare("SELECT * FROM sessions ORDER BY completed_at DESC")
    .all() as unknown as SessionRecord[];
}

export function getSession(id: string): SessionRecord | null {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as unknown as SessionRecord | null;
}

export function createSession(input: SessionInput): SessionRecord {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, kind, planned_minutes, started_at, completed_at, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.kind,
      input.planned_minutes,
      input.started_at,
      input.completed_at,
      input.note,
    );
  return { id, ...input };
}

export function updateSessionNote(
  id: string,
  note: string,
): SessionRecord | null {
  getDb()
    .prepare("UPDATE sessions SET note = ? WHERE id = ?")
    .run(note, id);
  return getSession(id);
}

export function deleteSession(id: string): boolean {
  const result = getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}
