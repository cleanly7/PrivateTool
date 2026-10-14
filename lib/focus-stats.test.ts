import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectDistractions,
  focusYears,
  formatCompact,
  formatDuration,
  formatHours,
  formatSeconds,
  formatSecondsHours,
  formatSecondsText,
  recentFocusTitles,
  secondsToMinutes,
  sessionSeconds,
  summarizeFocusAllTime,
  summarizeFocusDay,
  summarizeFocusWeek,
  summarizeFocusYear,
} from "./focus-stats.ts";
import type { FocusSubject, SessionKind, SessionRecord } from "./types.ts";

let counter = 0;

function session(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minutes: number,
  options: {
    kind?: SessionKind;
    subject?: FocusSubject | "";
    note?: string;
    actualSeconds?: number;
    title?: string;
    distractions?: { at: string; reason: string }[];
  } = {},
): SessionRecord {
  const startedAt = new Date(year, monthIndex, day, hour, 0, 0);
  const completedAt = new Date(year, monthIndex, day, hour + 1, 0, 0);
  counter += 1;
  return {
    id: `s${counter}`,
    kind: options.kind ?? "focus",
    planned_minutes: minutes,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    note: options.note ?? "",
    subject: options.subject ?? "",
    actual_seconds: options.actualSeconds ?? null,
    title: options.title ?? "",
    distractions:
      options.distractions?.map((item, index) => ({
        id: `d${counter}-${index}`,
        at: item.at,
        reason: item.reason,
      })) ?? [],
  };
}

// 2026-03-04 是周三，本周为 3/2(周一) – 3/8(周日)。
const wednesday = new Date(2026, 2, 4, 20, 0, 0);

test("今日统计按科目拆出技术学习与日语，忽略其他日期和冥想记录", () => {
  const sessions = [
    session(2026, 2, 4, 9, 60, { subject: "tech" }),
    session(2026, 2, 4, 11, 30, { subject: "japanese" }),
    session(2026, 2, 4, 14, 45, { subject: "" }),
    session(2026, 2, 4, 15, 20, { kind: "meditation" }),
    session(2026, 2, 3, 9, 90, { subject: "tech" }),
  ];

  const day = summarizeFocusDay(sessions, wednesday);
  assert.equal(day.dateKey, "2026-03-04");
  assert.equal(day.count, 3);
  assert.equal(day.seconds, 135 * 60);
  assert.equal(day.bySubject.tech, 60 * 60);
  assert.equal(day.bySubject.japanese, 30 * 60);
  // 老记录没有科目，算未分类，不能悄悄算进技术或日语。
  assert.equal(day.bySubject.unclassified, 45 * 60);
});

test("实际时长优先于计划时长（提前收工也按真实时间记账）", () => {
  const sessions = [
    // 有计划 45 分钟，但实际只专注了 20 分钟
    session(2026, 2, 4, 9, 45, { subject: "tech", actualSeconds: 20 * 60 }),
    // 老记录没有 actual_seconds，回退到 planned_minutes
    session(2026, 2, 4, 11, 30, { subject: "japanese" }),
  ];

  assert.equal(sessionSeconds(sessions[0]), 1200);
  assert.equal(sessionSeconds(sessions[1]), 1800);

  const day = summarizeFocusDay(sessions, wednesday);
  assert.equal(day.seconds, 3000);
  assert.equal(day.bySubject.tech, 1200);
});

test("跨零点的专注算在开始那天（复盘数字要对得上）", () => {
  counter += 1;
  const startedAt = new Date(2026, 2, 4, 23, 40, 0);
  const completedAt = new Date(2026, 2, 5, 0, 20, 0);
  const overnight: SessionRecord = {
    id: `s${counter}`,
    kind: "focus",
    planned_minutes: 40,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    note: "",
    subject: "tech",
    actual_seconds: 40 * 60,
    title: "",
    distractions: [],
  };

  const beforeMidnight = new Date(2026, 2, 4, 23, 50, 0);
  const afterMidnight = new Date(2026, 2, 5, 0, 30, 0);

  assert.equal(summarizeFocusDay([overnight], beforeMidnight).seconds, 2400);
  assert.equal(summarizeFocusDay([overnight], afterMidnight).seconds, 0);
});

test("本周统计覆盖周一到周日，并排除本周之外的记录", () => {
  const sessions = [
    session(2026, 2, 2, 9, 45, { subject: "tech" }),
    session(2026, 2, 3, 9, 30, { subject: "japanese" }),
    session(2026, 2, 4, 9, 60, { subject: "tech", note: "看完黑马点评第 12 集" }),
    session(2026, 2, 8, 9, 25, { subject: "tech" }),
    // 下周一、上周日、冥想都不算进本周
    session(2026, 2, 9, 9, 120, { subject: "tech" }),
    session(2026, 2, 1, 9, 120, { subject: "tech" }),
    session(2026, 2, 4, 7, 20, { kind: "meditation" }),
  ];

  const week = summarizeFocusWeek(sessions, wednesday);
  assert.equal(week.startKey, "2026-03-02");
  assert.equal(week.endKey, "2026-03-08");
  assert.equal(week.days.length, 7);
  assert.equal(week.count, 4);
  assert.equal(week.totalSeconds, 160 * 60);
  assert.equal(week.bySubject.tech, 130 * 60);
  assert.equal(week.bySubject.japanese, 30 * 60);
  assert.equal(week.maxDaySeconds, 60 * 60);
  assert.equal(week.days[0].weekday, "周一");
  assert.equal(week.days[6].weekday, "周日");
  assert.equal(week.days[2].isToday, true);
  assert.equal(week.days[0].isToday, false);
});

test("周一和周三算出来是同一周（周一开始）", () => {
  const monday = new Date(2026, 2, 2, 8, 0, 0);
  const sunday = new Date(2026, 2, 8, 23, 0, 0);
  assert.equal(summarizeFocusWeek([], monday).startKey, "2026-03-02");
  assert.equal(summarizeFocusWeek([], sunday).startKey, "2026-03-02");
});

test("本周学习备注只收集有内容的记录，按时间倒序并带科目", () => {
  const sessions = [
    session(2026, 2, 2, 9, 45, { subject: "tech", note: "看完黑马点评第 12 集" }),
    session(2026, 2, 4, 9, 60, { subject: "japanese", note: "N3 语法第 3 课" }),
    session(2026, 2, 5, 9, 30, { subject: "tech", note: "   " }),
  ];

  const week = summarizeFocusWeek(sessions, wednesday);
  assert.equal(week.notes.length, 2);
  assert.equal(week.notes[0].note, "N3 语法第 3 课");
  assert.equal(week.notes[0].subject, "japanese");
  assert.equal(week.notes[0].weekday, "周三");
  assert.equal(week.notes[0].seconds, 60 * 60);
  assert.equal(week.notes[1].note, "看完黑马点评第 12 集");
  assert.equal(week.notes[1].dateKey, "2026-03-02");
});

test("复盘用的小时/时长格式", () => {
  assert.equal(formatHours(150), "2.5");
  assert.equal(formatHours(120), "2");
  assert.equal(formatHours(0), "0");
  assert.equal(formatDuration(150), "2 小时 30 分");
  assert.equal(formatDuration(120), "2 小时");
  assert.equal(formatDuration(45), "45 分钟");
  assert.equal(formatDuration(0), "0 分钟");

  assert.equal(secondsToMinutes(8100), 135);
  assert.equal(formatSecondsHours(9000), "2.5");
  assert.equal(formatSecondsHours(70 * 60), "1.2");
  assert.equal(formatSeconds(9000), "2 小时 30 分");
  assert.equal(formatSeconds(2700), "45 分钟");
  assert.equal(formatSeconds(40), "40 秒");
  assert.equal(formatSeconds(0), "0 分钟");
});

test("分心按发生时间正序摊平，跟着记录一起算", () => {
  const sessions = [
    session(2026, 2, 4, 18, 45, {
      subject: "tech",
      title: "黑马点评第 12 集",
      distractions: [
        { at: new Date(2026, 2, 4, 18, 20).toISOString(), reason: "手机消息" },
        { at: new Date(2026, 2, 4, 18, 5).toISOString(), reason: "" },
      ],
    }),
    session(2026, 2, 4, 9, 30, {
      subject: "japanese",
      distractions: [
        { at: new Date(2026, 2, 4, 9, 10).toISOString(), reason: "想别的事" },
      ],
    }),
  ];

  const all = collectDistractions(sessions);
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((item) => [item.time, item.reason]),
    [
      ["09:10", "想别的事"],
      ["18:05", ""],
      ["18:20", "手机消息"],
    ],
  );
  assert.equal(all[2].sessionId, sessions[0].id);
  assert.equal(all[2].title, "黑马点评第 12 集");

  const day = summarizeFocusDay(sessions, new Date(2026, 2, 4, 20, 0));
  assert.equal(day.distractionCount, 3);
  assert.equal(day.distractions.length, 3);

  const week = summarizeFocusWeek(sessions, new Date(2026, 2, 4, 20, 0));
  assert.equal(week.distractionCount, 3);
  assert.equal(week.days[2].distractionCount, 3);
  assert.equal(week.days[0].distractionCount, 0);
});

test("没记分心的记录不会把统计弄成 NaN", () => {
  const sessions = [session(2026, 2, 4, 10, 25)];
  const day = summarizeFocusDay(sessions, new Date(2026, 2, 4, 12, 0));
  assert.equal(day.distractionCount, 0);
  assert.deepEqual(day.distractions, []);
  assert.deepEqual(collectDistractions([]), []);
});

test("紧凑时长一律分钟精度：0m / 45m / 2h / 2h5m（不许出现 2.5h）", () => {
  assert.equal(formatCompact(0), "0m");
  assert.equal(formatCompact(59), "1m"); // 59 秒四舍五入成 1 分钟
  assert.equal(formatCompact(60), "1m");
  assert.equal(formatCompact(45 * 60), "45m");
  assert.equal(formatCompact(59 * 60), "59m");
  assert.equal(formatCompact(60 * 60), "1h");
  assert.equal(formatCompact(2 * 60 * 60 + 5 * 60), "2h5m");
  assert.equal(formatCompact(2 * 60 * 60 + 30 * 60), "2h30m");
  // 负数（理论上不该出现）也只回 0m，不吐 NaN。
  assert.equal(formatCompact(-10), "0m");
});

test("formatSecondsText 是给人读的中文分钟精度文案", () => {
  assert.equal(formatSecondsText(0), "0 分钟");
  assert.equal(formatSecondsText(45 * 60), "45 分钟");
  assert.equal(formatSecondsText(60 * 60), "1 小时");
  assert.equal(formatSecondsText(2 * 60 * 60 + 30 * 60), "2 小时 30 分");
});

test("最近标题：只认专注记录与非空标题，倒序去重，最多 5 条", () => {
  const sessions = [
    session(2026, 2, 4, 9, 30, { title: "黑马点评第 12 集" }),
    session(2026, 2, 3, 9, 30, { title: "黑马点评第 12 集" }), // 重复，占位不算
    session(2026, 2, 2, 9, 30, { title: "  " }), // 空白标题忽略
    session(2026, 2, 1, 9, 30, { kind: "meditation", title: "冥想不该出现" }),
    session(2026, 1, 28, 9, 30, { kind: "pomodoro", title: "Redis 分布式锁" }),
    session(2026, 1, 27, 9, 30, { title: "N3 语法" }),
    session(2026, 1, 26, 9, 30, { title: "缓存穿透" }),
    session(2026, 1, 25, 9, 30, { title: "排序算法" }),
    session(2026, 1, 24, 9, 30, { title: "第六个标题" }),
  ];

  assert.deepEqual(recentFocusTitles(sessions), [
    "黑马点评第 12 集",
    "Redis 分布式锁",
    "N3 语法",
    "缓存穿透",
    "排序算法",
  ]);
  assert.deepEqual(recentFocusTitles([]), []);
  assert.deepEqual(recentFocusTitles(sessions, 2), [
    "黑马点评第 12 集",
    "Redis 分布式锁",
  ]);
});

test("本周备注列表带上大标题", () => {
  const sessions = [
    session(2026, 2, 4, 9, 45, {
      subject: "tech",
      note: "缓存穿透的三层防护",
      title: "黑马点评第 12 集",
    }),
  ];
  const week = summarizeFocusWeek(sessions, new Date(2026, 2, 4, 20, 0));
  assert.equal(week.notes.length, 1);
  assert.equal(week.notes[0].title, "黑马点评第 12 集");
  assert.equal(week.notes[0].note, "缓存穿透的三层防护");
});

/* ------------------------- A7 总览 ------------------------- */

test("年度热力图：列 = 周、行 = 周一…周日，跨年那几天是 null", () => {
  const heatmap = summarizeFocusYear(
    [session(2026, 2, 4, 9, 45, { subject: "tech" })],
    2026,
  );

  // 2026-01-01 是周四，所以第一列从 2025-12-29（周一）开始，前三天不属于 2026。
  assert.equal(heatmap.year, 2026);
  assert.equal(heatmap.weeks.length, 53);
  for (const week of heatmap.weeks) assert.equal(week.length, 7);
  assert.equal(heatmap.weeks[0].length, 7);
  assert.equal(heatmap.weeks[0][0], null); // 2025-12-29 周一
  assert.equal(heatmap.weeks[0][1], null); // 2025-12-30 周二
  assert.equal(heatmap.weeks[0][2], null); // 2025-12-31 周三
  assert.equal(heatmap.weeks[0][3]?.dateKey, "2026-01-01"); // 周四
  assert.equal(heatmap.weeks[0][6]?.dateKey, "2026-01-04"); // 周日
  // 末列：2026-12-28 周一… 2027-01-03 周日，后三天不属于 2026。
  const lastWeek = heatmap.weeks[heatmap.weeks.length - 1];
  assert.equal(lastWeek[0]?.dateKey, "2026-12-28");
  assert.equal(lastWeek[3]?.dateKey, "2026-12-31");
  assert.equal(lastWeek[4], null);
  assert.equal(lastWeek[6], null);
});

test("年度热力图：先按年过滤，别的年份一秒都不算进来", () => {
  const sessions = [
    session(2026, 2, 4, 9, 60, { subject: "tech" }),
    session(2026, 0, 1, 9, 30, { subject: "japanese" }),
    session(2025, 11, 31, 9, 120, { subject: "tech" }), // 12/31，不能串到 2026
    session(2027, 0, 1, 9, 120, { subject: "tech" }), // 次年 1/1，也不能串进来
    session(2026, 2, 4, 9, 20, { kind: "meditation" }),
  ];
  const heatmap = summarizeFocusYear(sessions, 2026);

  assert.equal(heatmap.totalSeconds, 90 * 60);
  assert.equal(heatmap.bySubject.tech, 60 * 60);
  assert.equal(heatmap.bySubject.japanese, 30 * 60);
  assert.equal(heatmap.bySubject.unclassified, 0);
  assert.equal(heatmap.activeDays, 2);
  // 单日最大值只按这一年算：2025-12-31 的 120 分钟不能当基准。
  assert.equal(heatmap.maxDaySeconds, 60 * 60);

  // 12/31 属于第 53 列的周四（2026-12-31 是周四，week[3]）。
  const dec31 = heatmap.weeks[52][3];
  assert.equal(dec31?.dateKey, "2026-12-31");
  assert.equal(dec31?.seconds, 0);
  // 不属于该年的格子是 null，不是 0 秒的格子（不能拿来画深色）。
  assert.equal(heatmap.weeks[52][4], null);
});

test("年度热力图：空年份不炸，没有任何记录时全是 0", () => {
  const heatmap = summarizeFocusYear([], 2026);
  assert.equal(heatmap.totalSeconds, 0);
  assert.equal(heatmap.maxDaySeconds, 0);
  assert.equal(heatmap.activeDays, 0);
  assert.deepEqual(heatmap.bySubject, { tech: 0, japanese: 0, unclassified: 0 });
  const cells = heatmap.weeks.flat().filter((cell) => cell !== null);
  // 2026 年 365 天，每天都有格子，只是秒数都是 0。
  assert.equal(cells.length, 365);
  assert.equal(cells.every((cell) => cell.seconds === 0), true);
});

test("最专注的一天：平局取更早的一天，且与输入顺序无关", () => {
  const early = session(2026, 4, 10, 9, 90, { subject: "tech" });
  const late = session(2026, 4, 11, 9, 90, { subject: "tech" });

  assert.equal(summarizeFocusAllTime([early, late]).bestDay?.dateKey, "2026-05-10");
  assert.equal(summarizeFocusAllTime([late, early]).bestDay?.dateKey, "2026-05-10");
});

test("全部历史累计：总数、分类、第一条、最专注的一天（秒数大的赢）", () => {
  const sessions = [
    session(2026, 2, 4, 9, 45, { subject: "tech" }),
    session(2026, 4, 10, 9, 90, { subject: "japanese" }),
    session(2026, 2, 3, 9, 30, { subject: "tech" }),
    session(2026, 4, 10, 20, 30, { subject: "tech" }), // 同一天两段要合并
    session(2026, 2, 4, 7, 20, { kind: "meditation" }), // 冥想不算
  ];
  const all = summarizeFocusAllTime(sessions);

  assert.equal(all.totalSeconds, (45 + 90 + 30 + 30) * 60);
  assert.equal(all.count, 4);
  assert.equal(all.bySubject.tech, 105 * 60);
  assert.equal(all.bySubject.japanese, 90 * 60);
  assert.equal(all.bySubject.unclassified, 0);
  assert.equal(all.firstDayKey, "2026-03-03"); // 3 月 3 日比 3 月 4 日早
  assert.equal(all.activeDays, 3);
  // 5 月 10 日合计 120 分钟 > 3 月 4 日 45 分钟
  assert.deepEqual(all.bestDay, { dateKey: "2026-05-10", seconds: 120 * 60 });

  // 老记录只有 planned_minutes 也要算对（回退口径）。
  assert.equal(summarizeFocusAllTime([session(2026, 2, 4, 9, 45)]).totalSeconds, 2700);
});

test("全部历史累计：没有记录时返回空值，不给 0m 最专注的一天", () => {
  const empty = summarizeFocusAllTime([]);
  assert.equal(empty.totalSeconds, 0);
  assert.equal(empty.count, 0);
  assert.equal(empty.firstDayKey, null);
  assert.equal(empty.bestDay, null);
  assert.equal(empty.activeDays, 0);
  assert.deepEqual(empty.bySubject, { tech: 0, japanese: 0, unclassified: 0 });

  // 只有冥想记录时等同于空：总览不该被冥想撑起来。
  const meditation = summarizeFocusAllTime([
    session(2026, 2, 4, 9, 60, { kind: "meditation" }),
  ]);
  assert.equal(meditation.totalSeconds, 0);
  assert.equal(meditation.bestDay, null);
});

test("有记录的年份降序、去重，且只认专注记录", () => {
  assert.deepEqual(focusYears([]), []);
  assert.deepEqual(
    focusYears([
      session(2026, 2, 4, 9, 45),
      session(2024, 6, 1, 9, 60),
      session(2026, 8, 1, 9, 30),
      session(2025, 0, 9, 9, 30, { kind: "pomodoro" }),
      session(2023, 0, 9, 9, 30, { kind: "meditation" }),
    ]),
    [2026, 2025, 2024],
  );
});

test("展开的那一周与 summarizeFocusWeek 对同一天算出的合计一致", () => {
  const sessions = [
    session(2026, 4, 11, 9, 45, { subject: "tech" }), // 周一
    session(2026, 4, 14, 9, 30, { subject: "japanese" }), // 周四
    session(2026, 4, 17, 9, 60, { subject: "tech" }), // 周日
    session(2026, 4, 18, 9, 60, { subject: "tech" }), // 下周一，不算本周
  ];
  const heatmap = summarizeFocusYear(sessions, 2026);
  const column = heatmap.weeks.find(
    (week) => week.some((cell) => cell?.dateKey === "2026-05-11") ?? false,
  );
  assert.deepEqual(column?.map((cell) => cell?.dateKey), [
    "2026-05-11",
    "2026-05-12",
    "2026-05-13",
    "2026-05-14",
    "2026-05-15",
    "2026-05-16",
    "2026-05-17",
  ]);

  const monday = new Date(2026, 4, 11); // 本地构造，禁止 new Date("2026-05-11")
  const week = summarizeFocusWeek(sessions, monday);
  assert.equal(week.startKey, "2026-05-11");
  const columnTotal = (column ?? []).reduce(
    (sum, cell) => sum + (cell?.seconds ?? 0),
    0,
  );
  assert.equal(columnTotal, week.totalSeconds);
  assert.equal(columnTotal, 135 * 60);
});
