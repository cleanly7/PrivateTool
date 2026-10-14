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

export type SessionKind = "focus" | "pomodoro" | "meditation";

/**
 * 专注时间改成「正计时」后存 kind = "focus"：统计的是真实有效时长，
 * 而不是预设的倒计时长度。以前存的 "pomodoro" 由 lib/db.ts 的迁移改名；
 * "pomodoro" 这个值留给以后的番茄钟模块（倒计时、循环、休息），
 * 所以判断「是不是专注类记录」两个值都要认。
 */
export const FOCUS_KIND: SessionKind = "focus";

export function isFocusKind(kind: SessionKind | string): boolean {
  return kind === "focus" || kind === "pomodoro";
}

/** 专注内容：只统计这两种（复盘表里要记的「技术学习」和「日语」）。 */
export type FocusSubject = "tech" | "japanese";

export const FOCUS_SUBJECTS: readonly {
  id: FocusSubject;
  label: string;
  color: string;
}[] = [
  { id: "tech", label: "技术学习", color: "#2563eb" },
  { id: "japanese", label: "日语", color: "#7c3aed" },
];

/** 老记录没有科目时的显示色（图表里的「未分类」段）。 */
export const FOCUS_UNCLASSIFIED = { label: "未分类", color: "#8796ad" };

export const FOCUS_SUBJECT_LABELS: Record<FocusSubject, string> = {
  tech: "技术学习",
  japanese: "日语",
};

export function isFocusSubject(value: unknown): value is FocusSubject {
  return value === "tech" || value === "japanese";
}

/** 一段专注里最多记 200 次分心（防呆上限，正常一天到不了）。 */
export const MAX_DISTRACTIONS = 200;
/** 分心原因一句话的长度上限。 */
export const MAX_DISTRACTION_REASON_LENGTH = 100;
/** 大标题（这段时间在做什么）的长度上限。 */
export const MAX_SESSION_TITLE_LENGTH = 120;

/**
 * 分心：一次「刚刚走神了」的记录，只记时间点和一句原因，跟时长完全解耦。
 * 对外形状就是这三项（数据库里还有 target_kind / target_id，只用于归属，不暴露给界面）。
 */
export interface DistractionRecord {
  id: string;
  /** 分心发生的时刻（ISO）。 */
  at: string;
  /** 为什么分心（可以留空，只记次数也成立）。 */
  reason: string;
}

/** 新建记录时带上的分心（还没有 id，落库时生成）。 */
export interface DistractionInput {
  at: string;
  reason: string;
}

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  /** 兼容字段（老的记录时长口径），正计时记录里是四舍五入后的分钟数。 */
  planned_minutes: number;
  started_at: string;
  completed_at: string;
  note: string;
  /** 旧记录和冥想记录是空字符串，统计时算作「未分类」。 */
  subject: FocusSubject | "";
  /**
   * 实际有效秒数（正计时里已经扣掉暂停）。老记录是 null，
   * 统计时回退成 planned_minutes * 60。
   */
  actual_seconds: number | null;
  /** 这段专注做的是什么（比如「黑马点评第 12 集」）。 */
  title: string;
  /** 这段专注里的分心记录（按发生时间正序）。 */
  distractions: DistractionRecord[];
}

export interface SessionInput {
  kind: SessionKind;
  planned_minutes: number;
  started_at: string;
  completed_at: string;
  note: string;
  subject: FocusSubject | "";
  actual_seconds: number | null;
  title: string;
  /** 随记录一起落库的分心（可选，老客户端不发这个字段）。 */
  distractions: DistractionInput[];
}

export interface WaterIntake {
  id: string;
  amount_ml: number;
  logged_at: string;
}

export interface WaterSettings {
  daily_goal_cups: number;
  cup_ml: number;
  remind_interval_min: number;
  active_start: string;
  active_end: string;
}

export const DEFAULT_WATER_SETTINGS: WaterSettings = {
  daily_goal_cups: 8,
  cup_ml: 250,
  remind_interval_min: 60,
  active_start: "08:00",
  active_end: "22:00",
};
