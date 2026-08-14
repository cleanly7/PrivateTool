import type { SessionInput, TransactionInput } from "./types";

export function parseTransactionInput(body: unknown): TransactionInput | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;

  const type =
    record.type === "income" || record.type === "expense"
      ? record.type
      : null;
  const amount =
    typeof record.amount === "string" ? Number(record.amount) : record.amount;
  const note = typeof record.note === "string" ? record.note.trim() : "";

  if (
    !type ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    typeof record.category !== "string" ||
    record.category.trim() === "" ||
    typeof record.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.date)
  ) {
    return null;
  }

  return {
    type,
    amount,
    category: record.category.trim(),
    note,
    date: record.date,
  };
}

export function parseSessionInput(body: unknown): SessionInput | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;

  const kind =
    record.kind === "meditation" || record.kind === "pomodoro"
      ? record.kind
      : null;
  const plannedMinutes =
    typeof record.planned_minutes === "string"
      ? Number(record.planned_minutes)
      : record.planned_minutes;
  const note = typeof record.note === "string" ? record.note.trim() : "";

  if (
    !kind ||
    typeof plannedMinutes !== "number" ||
    !Number.isInteger(plannedMinutes) ||
    plannedMinutes < 1 ||
    plannedMinutes > 180 ||
    typeof record.started_at !== "string" ||
    typeof record.completed_at !== "string" ||
    Number.isNaN(Date.parse(record.started_at)) ||
    Number.isNaN(Date.parse(record.completed_at)) ||
    new Date(record.completed_at).getTime() <
      new Date(record.started_at).getTime()
  ) {
    return null;
  }

  return {
    kind,
    planned_minutes: plannedMinutes,
    started_at: record.started_at,
    completed_at: record.completed_at,
    note: note.slice(0, 200),
  };
}
