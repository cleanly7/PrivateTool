export type TransactionType = "income" | "expense";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  date: string;
  created_at: string;
}

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  date: string;
}

export type SessionKind = "meditation" | "pomodoro";

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  planned_minutes: number;
  started_at: string;
  completed_at: string;
  note: string;
}

export interface SessionInput {
  kind: SessionKind;
  planned_minutes: number;
  started_at: string;
  completed_at: string;
  note: string;
}
