/**
 * Pure state-restore logic for FocusTimer.
 *
 * Kept free of React/DOM so the timer restore rules can be unit-tested
 * without mounting the component (see lib/focus-timer.test.ts).
 *
 * History: the running-restore path used to pass MILLISECONDS as the resume
 * duration while `begin()` interprets its argument as SECONDS. Each remount
 * (e.g. switching away from the tab and back) therefore inflated the timer
 * 1000x and wrote the inflated endAt back to localStorage, compounding on
 * every switch. The bug fix here is (a) resuming in seconds and (b) dropping
 * stored timers whose remaining time is implausibly large — the leftover
 * corruption already written by the old versions.
 */

import {
  isFocusSubject,
  MAX_DISTRACTIONS,
  MAX_DISTRACTION_REASON_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  type DistractionInput,
  type FocusSubject,
} from "./types.ts";

export type TimerStatus = "idle" | "running" | "paused";

export interface StoredTimer {
  status: TimerStatus;
  endAt?: number;
  remainingSeconds?: number;
  plannedMinutes: number;
  startedAt: string;
}

export type RestoreResult =
  | {
      ok: true;
      status: "running";
      plannedMinutes: number;
      startedAt: string | null;
      remainingSeconds: number;
      resumeSeconds: number;
    }
  | {
      ok: true;
      status: "paused";
      plannedMinutes: number;
      startedAt: string | null;
      remainingSeconds: number;
    }
  | {
      ok: true;
      status: "finished";
      plannedMinutes: number;
      startedAt: string | null;
      completedAtIso: string;
    }
  | { ok: false };

/**
 * Anything beyond this remaining time cannot come from a real session
 * (max duration is 120 minutes) and is treated as corrupt storage left
 * behind by the old ms-vs-seconds bug, which produced values ≥ ~4.5e10 s.
 */
const MAX_RESTORE_SECONDS = 24 * 60 * 60;

export function resolveStoredTimer(
  stored: unknown,
  now: number,
): RestoreResult {
  if (
    typeof stored !== "object" ||
    stored === null ||
    typeof (stored as StoredTimer).plannedMinutes !== "number"
  ) {
    return { ok: false };
  }
  const timer = stored as StoredTimer;

  if (timer.status === "running" && typeof timer.endAt === "number") {
    const remainingSeconds = Math.round((timer.endAt - now) / 1000);
    if (remainingSeconds > MAX_RESTORE_SECONDS) {
      return { ok: false };
    }
    if (remainingSeconds > 0) {
      return {
        ok: true,
        status: "running",
        plannedMinutes: timer.plannedMinutes,
        startedAt: timer.startedAt ?? null,
        remainingSeconds,
        // SECONDS — `begin(seconds)` computes endAt = now + seconds * 1000.
        resumeSeconds: remainingSeconds,
      };
    }
    return {
      ok: true,
      status: "finished",
      plannedMinutes: timer.plannedMinutes,
      startedAt: timer.startedAt ?? null,
      completedAtIso: new Date(timer.endAt).toISOString(),
    };
  }

  if (timer.status === "paused" && typeof timer.remainingSeconds === "number") {
    if (timer.remainingSeconds > MAX_RESTORE_SECONDS) {
      return { ok: false };
    }
    return {
      ok: true,
      status: "paused",
      plannedMinutes: timer.plannedMinutes,
      startedAt: timer.startedAt ?? null,
      remainingSeconds: timer.remainingSeconds,
    };
  }

  return { ok: false };
}

/* ---------------------------------------------------------------- *
 * 正计时（专注时间）
 * ---------------------------------------------------------------- */

/** 一段超过 90 分钟，保存前提醒确认一次（可能中途走开过）。 */
export const LONG_SESSION_MS = 90 * 60 * 1000;
/** 超过 12 小时还在跑，界面上提醒「是不是忘记结束了」。 */
export const FORGOT_STOP_MS = 12 * 60 * 60 * 1000;
/** 单段专注的硬上限：超过 24 小时按数据坏了处理，不入库。 */
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
/**
 * 「一档」= 45 分钟。正计时没有终点，所以给一个软刻度：每到一档就轻轻提醒一次
 * （响一下、发个通知），绝不暂停你的计时——什么时候停始终由你决定。
 */
export const FOCUS_MARK_MS = 45 * 60 * 1000;

/** 已经过去了几个 45 分钟档位。 */
export function focusMarks(ms: number): number {
  return Math.max(0, Math.floor(ms / FOCUS_MARK_MS));
}

/** 下一档还剩多少毫秒（当前正好在档位上时返回一整档）。 */
export function msToNextMark(ms: number): number {
  const rest = ms % FOCUS_MARK_MS;
  return rest === 0 ? FOCUS_MARK_MS : FOCUS_MARK_MS - rest;
}

export const COUNT_UP_DRAFT_VERSION = 3;
/** 还能读得懂的旧草稿版本（v2 没有大标题和分心）。 */
const READABLE_DRAFT_VERSIONS = [2, 3];

/** 结束弹窗里要落库的内容；保存失败时原样留着重试。 */
export interface PendingSave {
  startedAt: string;
  completedAt: string;
  seconds: number;
  subject: FocusSubject | "";
  note: string;
  /** 这段在做什么（大标题）。 */
  title: string;
  /** 这段里的分心（按发生时间正序）。 */
  distractions: DistractionInput[];
}

/**
 * 草稿里的分心是本地存储来的，逐条校验、坏的丢掉：
 * 时间点必须能解析，原因截断到上限，总条数封顶。
 */
export function parseStoredDistractions(value: unknown): DistractionInput[] {
  if (!Array.isArray(value)) return [];
  const parsed: DistractionInput[] = [];
  for (const item of value) {
    if (parsed.length >= MAX_DISTRACTIONS) break;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) {
      continue;
    }
    const reason =
      typeof record.reason === "string"
        ? record.reason.slice(0, MAX_DISTRACTION_REASON_LENGTH)
        : "";
    parsed.push({ at: record.at, reason });
  }
  return parsed;
}

/**
 * 正计时草稿。运行中用墙上时钟算时长：`accumulatedMs` 是之前各段的累计，
 * `runStartedAt` 是当前运行段的起点。暂停只是把 runStartedAt 归零，
 * 所以暂停多久都不会被算进学习时长。
 */
export interface CountUpDraft {
  version: typeof COUNT_UP_DRAFT_VERSION;
  status: "running" | "paused";
  /** 这段专注整体开始的时间（ISO）——统计归属按它算。 */
  startedAt: string;
  runStartedAt: number | null;
  accumulatedMs: number;
  subject: FocusSubject | "";
  note: string;
  /** 这段在做什么（大标题），会在运行中途一直跟着草稿走。 */
  title: string;
  /** 已经按下的分心（时间点 + 可选原因）。 */
  distractions: DistractionInput[];
  /** 已经结束、但还没成功入库的记录。 */
  pending: PendingSave | null;
  /**
   * 上面那条 pending 是不是「保存失败」留下的。
   * false 表示只是结束弹窗还开着（刷新后原样打开，不吓唬人说保存失败）。
   */
  pendingFailed: boolean;
}

export function parsePendingSave(value: unknown): PendingSave | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const seconds = record.seconds;
  if (
    typeof record.startedAt !== "string" ||
    Number.isNaN(Date.parse(record.startedAt)) ||
    typeof record.completedAt !== "string" ||
    Number.isNaN(Date.parse(record.completedAt)) ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds * 1000 > MAX_SESSION_MS ||
    typeof record.subject !== "string" ||
    typeof record.note !== "string"
  ) {
    return null;
  }
  return {
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    seconds: Math.round(seconds),
    subject: isFocusSubject(record.subject) ? record.subject : "",
    note: record.note,
    title:
      typeof record.title === "string"
        ? record.title.slice(0, MAX_SESSION_TITLE_LENGTH)
        : "",
    distractions: parseStoredDistractions(record.distractions),
  };
}

export function readCountUpDraft(raw: unknown): CountUpDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.version !== "number" ||
    !READABLE_DRAFT_VERSIONS.includes(record.version) ||
    (record.status !== "running" && record.status !== "paused") ||
    typeof record.startedAt !== "string" ||
    Number.isNaN(Date.parse(record.startedAt)) ||
    (record.runStartedAt !== null &&
      (typeof record.runStartedAt !== "number" ||
        !Number.isFinite(record.runStartedAt))) ||
    typeof record.accumulatedMs !== "number" ||
    !Number.isFinite(record.accumulatedMs) ||
    record.accumulatedMs < 0 ||
    typeof record.subject !== "string" ||
    typeof record.note !== "string"
  ) {
    return null;
  }
  return {
    version: COUNT_UP_DRAFT_VERSION,
    status: record.status,
    startedAt: record.startedAt,
    runStartedAt:
      record.status === "running" && typeof record.runStartedAt === "number"
        ? record.runStartedAt
        : null,
    accumulatedMs: Math.round(record.accumulatedMs),
    subject: isFocusSubject(record.subject) ? record.subject : "",
    note: record.note,
    title:
      typeof record.title === "string"
        ? record.title.slice(0, MAX_SESSION_TITLE_LENGTH)
        : "",
    distractions: parseStoredDistractions(record.distractions),
    pending: parsePendingSave(record.pending),
    pendingFailed: record.pendingFailed === true,
  };
}

/** 当前累计时长（毫秒）：跑着就加上「运行段起点到 now」这一段。 */
export function elapsedMs(
  draft: {
    status: "idle" | "running" | "paused";
    runStartedAt: number | null;
    accumulatedMs: number;
  },
  now: number,
): number {
  if (draft.status !== "running" || draft.runStartedAt === null) {
    return Math.max(0, draft.accumulatedMs);
  }
  return Math.max(
    0,
    draft.accumulatedMs + Math.max(0, now - draft.runStartedAt),
  );
}

/** 大号时钟：HH:MM:SS（超过 99 小时也不再补位，够用了）。 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** 说话用的时长：「1 小时 12 分」/「42 分钟」/「38 秒」。 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** 结束弹窗里的分钟数：不足 1 分钟按 1 分钟算（记录不能是 0 分钟）。 */
export function minutesForSave(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

export function isImplausiblyLong(ms: number): boolean {
  return ms > MAX_SESSION_MS;
}

/**
 * 升级路径：老版本在 `focus-timer-pomodoro` 里存的是倒计时草稿。
 * 把它翻译成正计时草稿（已经过去的时间 = 计划时长 − 剩余时长），
 * 这样升级的那一刻正在跑的一段不会凭空消失。
 */
export function countUpFromStoredTimer(
  stored: unknown,
  now: number,
): CountUpDraft | null {
  const restored = resolveStoredTimer(stored, now);
  if (!restored.ok) return null;

  const raw = stored as Record<string, unknown>;
  const subject = isFocusSubject(raw.subject) ? raw.subject : "";
  const note = typeof raw.note === "string" ? raw.note.slice(0, 200) : "";
  const startedAt =
    restored.startedAt ?? new Date(now - restored.plannedMinutes * 60_000).toISOString();

  if (restored.status === "finished") {
    // 倒计时已经跑完：换成「暂停、已累计满」的一段，让人自己决定存不存。
    return {
      version: COUNT_UP_DRAFT_VERSION,
      status: "paused",
      startedAt,
      runStartedAt: null,
      accumulatedMs: restored.plannedMinutes * 60_000,
      subject,
      note,
      title: "",
      distractions: [],
      pending: null,
      pendingFailed: false,
    };
  }

  return {
    version: COUNT_UP_DRAFT_VERSION,
    status: restored.status === "running" ? "running" : "paused",
    startedAt,
    runStartedAt: restored.status === "running" ? now : null,
    accumulatedMs: Math.max(
      0,
      restored.plannedMinutes * 60_000 - restored.remainingSeconds * 1000,
    ),
    subject,
    note,
    title: "",
    distractions: [],
    pending: null,
    pendingFailed: false,
  };
}
