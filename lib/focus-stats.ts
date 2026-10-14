/**
 * 专注时间的统计逻辑。
 *
 * 保持纯函数：输入 sessions 记录 + 参考时间，输出今日/本周的实际时长与科目
 * 拆分，方便单测（见 lib/focus-stats.test.ts），也方便直接对应到复盘
 * 「数字」栏里要填的两行：当天有效技术小时数、当天日语小时数。
 *
 * 两条口径（2026-10 改成正计时时定下，别再改回去）：
 *   1. 时长用 actual_seconds（真实有效秒数，暂停不算）；老记录没有这个字段，
 *      回退成 planned_minutes * 60。
 *   2. 归属日期看 started_at，不看 completed_at：跨零点的那一段算在开始那天。
 */

import {
  addLocalDays,
  formatTime,
  shortDateLabel,
  startOfLocalWeek,
  toLocalDateKey,
  weekdayMondayFirst,
  // 显式带 .ts 后缀：node --test 直接跑 TS 时不做扩展名补全（Next 打包不受影响）。
} from "./date.ts";
import {
  FOCUS_SUBJECTS,
  FOCUS_UNCLASSIFIED,
  isFocusKind,
  type FocusSubject,
  type SessionRecord,
} from "./types.ts";

/** 科目 -> 秒数；旧记录没有科目，算进 unclassified。 */
export interface SubjectSeconds {
  tech: number;
  japanese: number;
  unclassified: number;
}

export function emptySubjectSeconds(): SubjectSeconds {
  return { tech: 0, japanese: 0, unclassified: 0 };
}

function subjectKey(subject: FocusSubject | ""): keyof SubjectSeconds {
  return subject === "" ? "unclassified" : subject;
}

/** 一段专注的真实有效秒数（老记录回退到预设分钟数）。 */
export function sessionSeconds(session: SessionRecord): number {
  return session.actual_seconds ?? session.planned_minutes * 60;
}

function sumSeconds(sessions: SessionRecord[]): number {
  return sessions.reduce((sum, session) => sum + sessionSeconds(session), 0);
}

function collectSubjects(sessions: SessionRecord[]): SubjectSeconds {
  const totals = emptySubjectSeconds();
  for (const session of sessions) {
    totals[subjectKey(session.subject)] += sessionSeconds(session);
  }
  return totals;
}

/**
 * 只保留专注记录（冥想的 kind 是 meditation）。仍然认老值 "pomodoro"，
 * 免得迁移没跑到时老记录在界面上凭空消失；等番茄钟模块真做出来了，
 * 这里再收紧成 `session.kind === FOCUS_KIND`。
 */
export function focusSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.filter((session) => isFocusKind(session.kind));
}

/** 一次分心：谁记的、什么时候、为什么。 */
export interface FocusDistraction {
  sessionId: string;
  at: string;
  time: string;
  reason: string;
  title: string;
}

/** 把这些记录里的分心摊平、按发生时间正序排好。 */
export function collectDistractions(
  sessions: SessionRecord[],
): FocusDistraction[] {
  return sessions
    .flatMap((session) =>
      (session.distractions ?? []).map((item) => ({
        sessionId: session.id,
        at: item.at,
        time: formatTime(item.at),
        reason: item.reason,
        title: session.title,
      })),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
}

export interface FocusDayStat {
  dateKey: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  count: number;
  seconds: number;
  bySubject: SubjectSeconds;
  /** 这一天记了几次分心（跟着记录一起统计，不单独占表）。 */
  distractionCount: number;
}

export interface FocusWeekNote {
  id: string;
  dateKey: string;
  weekday: string;
  time: string;
  subject: FocusSubject | "";
  seconds: number;
  /** 这段在做什么（大标题）；没写过就是空串。 */
  title: string;
  note: string;
}

export interface FocusWeekStat {
  startKey: string;
  endKey: string;
  rangeLabel: string;
  count: number;
  totalSeconds: number;
  bySubject: SubjectSeconds;
  days: FocusDayStat[];
  maxDaySeconds: number;
  notes: FocusWeekNote[];
  /** 这一周记了几次分心。 */
  distractionCount: number;
  distractions: FocusDistraction[];
}

export interface FocusDaySummary {
  dateKey: string;
  count: number;
  seconds: number;
  bySubject: SubjectSeconds;
  /** 今天记了几次分心。 */
  distractionCount: number;
  distractions: FocusDistraction[];
}

export function summarizeFocusDay(
  sessions: SessionRecord[],
  reference: Date = new Date(),
): FocusDaySummary {
  const dateKey = toLocalDateKey(reference);
  const daySessions = focusSessions(sessions).filter(
    (session) => toLocalDateKey(session.started_at) === dateKey,
  );
  const distractions = collectDistractions(daySessions);
  return {
    dateKey,
    count: daySessions.length,
    seconds: sumSeconds(daySessions),
    bySubject: collectSubjects(daySessions),
    distractionCount: distractions.length,
    distractions,
  };
}

export function summarizeFocusWeek(
  sessions: SessionRecord[],
  reference: Date = new Date(),
): FocusWeekStat {
  const focus = focusSessions(sessions);
  const start = startOfLocalWeek(reference);
  const todayKey = toLocalDateKey(reference);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(start, index);
    const dateKey = toLocalDateKey(date);
    const daySessions = focus.filter(
      (session) => toLocalDateKey(session.started_at) === dateKey,
    );
    return {
      dateKey,
      weekday: weekdayMondayFirst(date),
      dayOfMonth: date.getDate(),
      isToday: dateKey === todayKey,
      count: daySessions.length,
      seconds: sumSeconds(daySessions),
      bySubject: collectSubjects(daySessions),
      distractionCount: collectDistractions(daySessions).length,
      sessions: daySessions,
    };
  });

  const weekSessions = days.flatMap((day) => day.sessions);

  const notes = weekSessions
    .filter((session) => session.note.trim() !== "")
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((session) => {
      const dateKey = toLocalDateKey(session.started_at);
      const date = new Date(session.started_at);
      return {
        id: session.id,
        dateKey,
        weekday: weekdayMondayFirst(date),
        time: formatTime(session.started_at),
        subject: session.subject,
        seconds: sessionSeconds(session),
        title: session.title,
        note: session.note,
      };
    });

  const startKey = days[0].dateKey;
  const endKey = days[days.length - 1].dateKey;
  const distractions = collectDistractions(weekSessions);

  return {
    startKey,
    endKey,
    rangeLabel: `${shortDateLabel(startKey)} – ${shortDateLabel(endKey)}`,
    count: weekSessions.length,
    totalSeconds: sumSeconds(weekSessions),
    bySubject: collectSubjects(weekSessions),
    days: days.map(({ sessions: _sessions, ...day }) => day),
    maxDaySeconds: Math.max(...days.map((day) => day.seconds), 0),
    notes,
    distractionCount: distractions.length,
    distractions,
  };
}

export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

/** 复盘用的小时数：2 小时 30 分 / 45 分钟。 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 分钟";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分`;
}

/** 复盘「数字」栏习惯写的 2.5 小时这种小数。 */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1).replace(/\.0$/, "");
}

/** 秒口径的时长文案：「2 小时 30 分」。不到一分钟的照实说多少秒。 */
export function formatSeconds(seconds: number): string {
  if (seconds > 0 && seconds < 60) return `${seconds} 秒`;
  return formatDuration(secondsToMinutes(seconds));
}

/** 秒口径的小时数文案：「2.5」。 */
export function formatSecondsHours(seconds: number): string {
  return formatHours(secondsToMinutes(seconds));
}

/** 秒口径的中文时长文案：「2 小时 30 分」。给「复制到复盘」这种要读出声的地方用。 */
export function formatSecondsText(seconds: number): string {
  return formatDuration(secondsToMinutes(seconds));
}

/**
 * 界面上的紧凑时长：`0m` / `45m` / `2h` / `2h5m`。
 *
 * 一律分钟精度——「2.5h」这种小数对人没有意义（要看数字的是今天学了多久，
 * 不是财务口径的小时数）。`0` 显示 `0m`，不给空字符串。
 */
export function formatCompact(seconds: number): string {
  const minutes = secondsToMinutes(seconds);
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${rest}m`;
}

/**
 * 「最近用过的标题」：给专注面板的一键复用入口。
 *
 * 只认专注记录（含老的 pomodoro）、只认非空标题，按 started_at 倒序、按文本
 * 去重（同一集看两天不该占两个位置），最多 limit 条。
 */
export function recentFocusTitles(
  sessions: SessionRecord[],
  limit = 5,
): string[] {
  const titles: string[] = [];
  const ordered = focusSessions(sessions).sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  );
  for (const session of ordered) {
    const title = session.title.trim();
    if (title === "" || titles.includes(title)) continue;
    titles.push(title);
    if (titles.length >= limit) break;
  }
  return titles;
}

/* ==========================================================================
 * A7 总览：全部历史累计 + 按分类的年度热力图
 *
 * 三条铁律（规格第 1 章 R1/R5 + A7 口径）：
 *   · 只统计 focusSessions()（含老的 pomodoro，不含冥想/喝水/记账）；
 *   · 时长 sessionSeconds()，归属日期 started_at；
 *   · 不做目标、不做连续天数、不做完成度、不做平均值——这里只回答「一共多久、
 *     哪几天在学」。要加新指标之前先回看规格第 11 章，别顺手加。
 * ========================================================================== */

/** 热力图的一行：两个真科目 + 老记录的「未分类」。 */
export type FocusHeatSubject = keyof SubjectSeconds;

/**
 * 热力图行的固定顺序与配色。颜色从 lib/types.ts 取，不在这里另写一套十六进制，
 * 免得改科目色时漏掉图表。
 */
export const FOCUS_HEAT_SUBJECTS: readonly {
  id: FocusHeatSubject;
  label: string;
  color: string;
}[] = [
  ...FOCUS_SUBJECTS.map((subject) => ({
    id: subject.id as FocusHeatSubject,
    label: subject.label,
    color: subject.color,
  })),
  {
    id: "unclassified",
    label: FOCUS_UNCLASSIFIED.label,
    color: FOCUS_UNCLASSIFIED.color,
  },
];

/** 热力图里的一个格子 = 某个分类在某一天的专注时长。 */
export interface FocusHeatCell {
  dateKey: string;
  seconds: number;
  bySubject: SubjectSeconds;
}

export interface FocusYearHeatmap {
  year: number;
  /** 列 = 周（周一起始），行 = 周一…周日；不属于该年的日期为 null */
  weeks: (FocusHeatCell | null)[][];
  maxDaySeconds: number; // 该年单日最大秒数（颜色缩放的基准）
  totalSeconds: number; // 该年合计
  bySubject: SubjectSeconds; // 该年分类拆分
  activeDays: number; // 该年有记录的天数
}

export interface FocusAllTimeSummary {
  totalSeconds: number;
  count: number;
  bySubject: SubjectSeconds;
  firstDayKey: string | null; // 第一条专注记录的归属日期
  bestDay: { dateKey: string; seconds: number } | null; // 最专注的一天；平局取更早的一天
  activeDays: number;
}

export function summarizeFocusYear(
  sessions: SessionRecord[],
  year: number,
): FocusYearHeatmap {
  // 先按年过滤再累计：12/31 与次年 1/1 必须分开算，不能因为「反正都要遍历」
  // 把别的年份混进来。
  const focus = focusSessions(sessions);
  const yearSessions = focus.filter(
    (session) => new Date(session.started_at).getFullYear() === year,
  );
  const byDateKey = new Map<string, SessionRecord[]>();
  for (const session of yearSessions) {
    const dateKey = toLocalDateKey(session.started_at);
    const list = byDateKey.get(dateKey);
    if (list) list.push(session);
    else byDateKey.set(dateKey, [session]);
  }

  // 第一列从「包含 1 月 1 日的那一周的周一」开始（可能是上一年的 12 月），
  // 最后一列是「包含 12 月 31 日的那一周的周日」（可能是次年的 1 月）。
  // 只有这样列才正好等于自然周，和 startOfLocalWeek 的周一起始口径一致。
  const firstMonday = startOfLocalWeek(new Date(year, 0, 1));
  const lastMonday = startOfLocalWeek(new Date(year, 11, 31));
  const weeks: (FocusHeatCell | null)[][] = [];
  for (let monday = firstMonday; monday <= lastMonday; ) {
    const week: (FocusHeatCell | null)[] = [];
    for (let index = 0; index < 7; index += 1) {
      const date = addLocalDays(monday, index);
      // 日期一律本地构造：new Date("2026-05-11") 是 UTC 解析，在东八区会退一天。
      if (date.getFullYear() !== year) {
        week.push(null);
        continue;
      }
      const dateKey = toLocalDateKey(date);
      const daySessions = byDateKey.get(dateKey) ?? [];
      week.push({
        dateKey,
        seconds: sumSeconds(daySessions),
        bySubject: collectSubjects(daySessions),
      });
    }
    weeks.push(week);
    monday = addLocalDays(monday, 7);
  }

  const cells = weeks.flat().filter((cell): cell is FocusHeatCell => cell !== null);
  let maxDaySeconds = 0;
  let activeDays = 0;
  for (const cell of cells) {
    if (cell.seconds > 0) {
      activeDays += 1;
      if (cell.seconds > maxDaySeconds) maxDaySeconds = cell.seconds;
    }
  }

  return {
    year,
    weeks,
    maxDaySeconds,
    totalSeconds: sumSeconds(yearSessions),
    bySubject: collectSubjects(yearSessions),
    activeDays,
  };
}

export function summarizeFocusAllTime(
  sessions: SessionRecord[],
): FocusAllTimeSummary {
  const focus = focusSessions(sessions);
  // started_at 是 ISO 串：按字典序排就等于按时间排（时区偏移一致）。
  // 不拿它直接字符串切片取日期——本地时区可能让归属日期和 UTC 日期差一天。
  const ordered = [...focus].sort((a, b) =>
    a.started_at.localeCompare(b.started_at),
  );
  const daySeconds = new Map<string, number>();
  for (const session of ordered) {
    const dateKey = toLocalDateKey(session.started_at);
    daySeconds.set(dateKey, (daySeconds.get(dateKey) ?? 0) + sessionSeconds(session));
  }

  let bestDay: { dateKey: string; seconds: number } | null = null;
  for (const [dateKey, seconds] of daySeconds) {
    // 平局取更早的一天：否则同一天数据刷新两次可能显示不同结果，看起来像 bug。
    if (
      bestDay === null ||
      seconds > bestDay.seconds ||
      (seconds === bestDay.seconds && dateKey < bestDay.dateKey)
    ) {
      bestDay = { dateKey, seconds };
    }
  }

  return {
    totalSeconds: sumSeconds(focus),
    count: focus.length,
    bySubject: collectSubjects(focus),
    firstDayKey: ordered.length > 0 ? toLocalDateKey(ordered[0].started_at) : null,
    bestDay,
    activeDays: daySeconds.size,
  };
}

/** 有记录的年份，降序（年份切换器 + 默认年份都用它） */
export function focusYears(sessions: SessionRecord[]): number[] {
  const years = new Set<number>();
  for (const session of focusSessions(sessions)) {
    years.add(new Date(session.started_at).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

