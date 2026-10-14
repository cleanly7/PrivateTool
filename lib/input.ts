import {
  isFocusKind,
  isFocusSubject,
  MAX_DISTRACTIONS,
  MAX_DISTRACTION_REASON_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  type DistractionInput,
  type SessionInput,
  type TransactionInput,
  type WaterSettings,
  // 显式带 .ts 后缀：这些纯校验函数要被 node --test 直接加载。
} from "./types.ts";

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

/** 一段专注最长按 24 小时算，超过就当数据坏了。 */
const MAX_SESSION_SECONDS = 24 * 60 * 60;

/**
 * 分心解析：**不合法就整条请求失败**（返回 null），不要静默丢几条——
 * 丢掉的用户根本不知道自己少记了。上限 200 条（防呆），原因 trim 后截断 100 字。
 * 没传这个字段（老客户端、冥想记录）当成空数组。
 */
function parseDistractions(value: unknown): DistractionInput[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_DISTRACTIONS) return null;
  const parsed: DistractionInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    // 分心是「按一下就记下」的数据，宁可整条请求被拒（界面上重试一次就行），
    // 也不要静默丢掉几条——丢了用户根本不知道自己少记了。
    if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) {
      return null;
    }
    if (record.reason !== undefined && typeof record.reason !== "string") {
      return null;
    }
    parsed.push({
      at: record.at,
      reason: (record.reason ?? "")
        .trim()
        .slice(0, MAX_DISTRACTION_REASON_LENGTH),
    });
  }
  return parsed;
}

/**
 * 事后改分心（编辑已保存的记录）：没传这个字段 = 不动原有分心（返回 undefined）；
 * 传了就走和创建时同一套校验，不合法返回 null → 整条请求 400，
 * 免得用户改了原因却发现自己少了几条。显式传 null 当成清空。
 */
export function parseDistractionsPatch(
  value: unknown,
): DistractionInput[] | null | undefined {
  if (value === undefined) return undefined;
  return parseDistractions(value);
}

export function parseSessionInput(body: unknown): SessionInput | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;

  const kind =
    record.kind === "meditation" ||
    record.kind === "focus" ||
    record.kind === "pomodoro"
      ? record.kind
      : null;
  const plannedMinutes =
    typeof record.planned_minutes === "string"
      ? Number(record.planned_minutes)
      : record.planned_minutes;
  const note = typeof record.note === "string" ? record.note.trim() : "";
  // 科目只属于专注记录，冥想记录一律留空。
  const subject =
    kind !== null && isFocusKind(kind) && isFocusSubject(record.subject)
      ? record.subject
      : "";
  // 实际有效秒数（正计时）。老客户端不发这个字段，那就存 null，
  // 统计时回退成 planned_minutes * 60。
  const actualSeconds =
    record.actual_seconds === undefined || record.actual_seconds === null
      ? null
      : typeof record.actual_seconds === "string"
        ? Number(record.actual_seconds)
        : record.actual_seconds;
  const title = typeof record.title === "string" ? record.title.trim() : "";

  if (
    !kind ||
    typeof plannedMinutes !== "number" ||
    !Number.isInteger(plannedMinutes) ||
    plannedMinutes < 1 ||
    plannedMinutes > 1440 ||
    (actualSeconds !== null &&
      (typeof actualSeconds !== "number" ||
        !Number.isInteger(actualSeconds) ||
        actualSeconds < 1 ||
        actualSeconds > MAX_SESSION_SECONDS)) ||
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
    subject,
    actual_seconds: actualSeconds,
    title: title.slice(0, MAX_SESSION_TITLE_LENGTH),
    distractions: [],
  };
}

/** `parseSessionInput` 的带原因版本：路由要把「分心不合法」和「别的字段不合法」分开报。 */
export type SessionInputResult =
  | { ok: true; input: SessionInput }
  | { ok: false; error: "记录字段不合法" | "分心记录不合法" };

export function parseSessionInputResult(body: unknown): SessionInputResult {
  const base = parseSessionInput(body);
  if (!base) return { ok: false, error: "记录字段不合法" };
  const distractions = parseDistractions(
    (body as Record<string, unknown>).distractions,
  );
  if (!distractions) return { ok: false, error: "分心记录不合法" };
  return { ok: true, input: { ...base, distractions } };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

export function isWaterSettings(value: unknown): value is WaterSettings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const goal = toNumber(record.daily_goal_cups);
  const cupMl = toNumber(record.cup_ml);
  const interval = toNumber(record.remind_interval_min);
  const start = record.active_start;
  const end = record.active_end;

  return (
    Number.isInteger(goal) &&
    goal >= 1 &&
    goal <= 24 &&
    Number.isFinite(cupMl) &&
    cupMl >= 50 &&
    cupMl <= 1000 &&
    Number.isInteger(interval) &&
    interval >= 5 &&
    interval <= 240 &&
    typeof start === "string" &&
    typeof end === "string" &&
    TIME_PATTERN.test(start) &&
    TIME_PATTERN.test(end) &&
    start < end
  );
}

export function parseWaterSettings(body: unknown): WaterSettings | null {
  return isWaterSettings(body) ? (body as WaterSettings) : null;
}
