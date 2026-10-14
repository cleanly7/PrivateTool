"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import {
  shortDateLabel,
  weekdayMondayFirst,
} from "@/lib/date";
import {
  FOCUS_HEAT_SUBJECTS,
  focusYears,
  formatCompact,
  formatSeconds,
  summarizeFocusAllTime,
  summarizeFocusWeek,
  summarizeFocusYear,
  type FocusHeatCell,
  type FocusHeatSubject,
  type SubjectSeconds,
} from "@/lib/focus-stats";
import { type SessionRecord } from "@/lib/types";

/** 总览里的「分类拆分」行。 */
interface SubjectSlice {
  key: FocusHeatSubject;
  label: string;
  color: string;
  seconds: number;
}

/**
 * 把一个 bySubject 摊成固定顺序的行（技术学习 / 日语 / 未分类）。
 * 未分类在合计为 0 时由调用方过滤掉——老记录才用得到它。
 */
function subjectSlices(bySubject: SubjectSeconds): SubjectSlice[] {
  return FOCUS_HEAT_SUBJECTS.map((subject) => ({
    key: subject.id,
    label: subject.label,
    color: subject.color,
    seconds: bySubject[subject.id],
  }));
}

/**
 * 格子深浅：按「该分类在这一年的单日最大值」归一化。
 *
 * 每张图各自缩放（共用最大值会让日语永远是一片浅色），所以行标题上必须写出
 * 这个最大值，否则会被误读成「颜色一样深 = 时长一样多」。
 * 下限 0.12，保证有记录的最浅那格也看得见（不能淡到看不见）。
 */
function cellAlpha(seconds: number, maxSeconds: number): number {
  if (seconds <= 0 || maxSeconds <= 0) return 0;
  return Math.min(1, 0.12 + 0.88 * (seconds / maxSeconds));
}

/** 2026-05-12 → 周二（本地构造，不用 new Date("2026-05-12") 那种 UTC 解析）。 */
function weekdayOfDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return weekdayMondayFirst(new Date(year, month - 1, day));
}

/** 热力图的列标题：`5月11日`。 */
function columnLabel(cell: FocusHeatCell): string {
  return shortDateLabel(cell.dateKey);
}

/** 这一列里属于该年的第一天（周一那格可能是 null 或上一年的日期）。 */
function columnAnchor(week: (FocusHeatCell | null)[]): FocusHeatCell | null {
  return week.find((cell) => cell !== null) ?? null;
}

/** 该列所属的年月（用来在时间轴上标出月份变化）。 */
function columnMonth(week: (FocusHeatCell | null)[]): string {
  const anchor = columnAnchor(week);
  return anchor === null ? "" : anchor.dateKey.slice(0, 7);
}

/**
 * 时间轴上的月份标签：只在月份发生变化的那一列画出来。
 *
 * 用 SVG 而不是 div + writing-mode：格子只有 11px 宽，竖排的「11月11日」
 * 在 18px 高的槽里会被裁掉；SVG 能旋转文字，横向溢出的部分也不会被裁
 * （CSS 里给 .heatmap-months-svg 显式写了 overflow: visible），读得完整。
 */
function monthAxis(weeks: (FocusHeatCell | null)[][]): {
  width: number;
  labels: { x: number; text: string }[];
} {
  // 11px 格子 + 2px 间距，与 .heatmap-cell / .heatmap-week 的 CSS 对得上。
  const step = 13;
  const labels: { x: number; text: string }[] = [];
  let previousMonth = "";
  weeks.forEach((week, index) => {
    const month = columnMonth(week);
    if (month === "" || month === previousMonth) return;
    previousMonth = month;
    const [, monthNumber] = month.split("-").map(Number);
    // 放在这一列中线上（11 / 2 ≈ 5.5，向上取 6）。
    labels.push({ x: index * step + 6, text: `${monthNumber}月` });
  });
  return { width: weeks.length * step, labels };
}

/**
 * 总览：全部历史累计 → 年度分类热力图 → 点某一列展开那一周。
 *
 * 三屏是一条线：先看一共多久，再看分布在哪些日子，最后点开某一周看 7 天。
 * 只读：数据全来自现成的 `GET /api/sessions`（不分页），派生结果用 useMemo 缓存。
 *
 * 刻意不做的东西（规格第 1 章 R1，别顺手加）：目标、连续天数、完成度、平均每天。
 * 这个页面只回答「一共多久、哪几天在学」。
 */
export default function FocusOverview({
  refreshKey,
  onBack,
}: {
  refreshKey: number;
  /** 回到计时视图。计时组件一直挂载着，所以切换不会动到正在跑的计时。 */
  onBack: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/sessions")
      .then((response) => response.json())
      .then((data: { sessions: SessionRecord[] }) => {
        if (active) setSessions(data.sessions ?? []);
      })
      .catch(() => {
        // 总览是只读视图：取不到就显示 0，不编造数字（面板其它地方同样处理）。
        if (active) setSessions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const years = useMemo(() => focusYears(sessions), [sessions]);
  /*
   * 默认年份 = 有记录的最近一年（years 是降序的），不是「今年」。
   * 刚过完年时今年可能一条记录都没有，默认停在今年会看到一整片空白，用户会以为数据没了。
   * 这里在渲染期就派生出来，不走 useState + useEffect：数据到达后如果只靠 effect 纠偏，
   * 会先拿「今年」算一次 summarizeFocusYear，闪一帧「这一年还没有专注记录」。
   * years 为空（还没取到数据 / 一条专注记录都没有）时退回今年，反正在那之前不渲染热力图。
   */
  const activeYear = years.includes(year) ? year : (years[0] ?? year);
  const allTime = useMemo(() => summarizeFocusAllTime(sessions), [sessions]);
  const heatmap = useMemo(
    () => summarizeFocusYear(sessions, activeYear),
    [sessions, activeYear],
  );
  const expanded = useMemo(() => {
    if (expandedKey === null) return null;
    // 传进去的 reference 必须是本地构造的那一列的周一日期。
    const [y, month, day] = expandedKey.split("-").map(Number);
    return summarizeFocusWeek(sessions, new Date(y, month - 1, day));
  }, [sessions, expandedKey]);

  /** 时间轴刻度只需要算一次，别在三行分类图里各算一遍。 */
  const monthAxisData = useMemo(() => monthAxis(heatmap.weeks), [heatmap]);

  // 换年就把展开的那一周收起来：否则「高亮列」会指向另一年的日期。
  useEffect(() => {
    setExpandedKey(null);
  }, [activeYear]);

  const yearIndex = years.indexOf(activeYear);
  const totalSlices = subjectSlices(allTime.bySubject);
  const showAllTime = allTime.count > 0;

  const goYear = (step: number) => {
    const next = years[yearIndex + step];
    if (next !== undefined) setYear(next);
  };

  return (
    <section className="overview">
      <div className="overview-head">
        <button
          type="button"
          className="btn"
          onClick={onBack}
          aria-label="返回计时"
          title="返回计时（计时不会停）"
        >
          <ChevronLeft size={16} />
          返回计时
        </button>
        <span className="overview-hint">全部专注记录 · 时长按开始那天算</span>
      </div>

      {loading ? (
        <div className="panel overview-panel">
          <div className="empty">
            <Loader2 size={16} /> 加载中…
          </div>
        </div>
      ) : !showAllTime ? (
        /* 一条专注记录都没有：连大数字都不给（显示 0m 像是「你一事无成」）。 */
        <div className="panel overview-panel">
          <div className="empty">还没有专注记录，去计时面板开始第一段吧</div>
        </div>
      ) : (
        <>
          {/* 第 1 屏 · 一共专注时间 */}
          <div className="panel overview-panel">
            <div className="panel-title">
              <span>一共专注</span>
            </div>
            {/* 这是全站唯一允许超过 24 小时的数字：用 formatCompact，不用 formatClock。 */}
            <div className="overview-total">{formatCompact(allTime.totalSeconds)}</div>

            <div className="focus-rows">
              {totalSlices
                .filter((slice) => slice.seconds > 0 || slice.key !== "unclassified")
                .map((slice) => (
                  <div className="focus-row" key={slice.key}>
                    <span
                      className="focus-dot"
                      style={{ background: slice.color }}
                      aria-hidden
                    />
                    <div className="focus-row-main">
                      <span className="focus-row-label">{slice.label}</span>
                      <span className="focus-row-hours">
                        {formatCompact(slice.seconds)}
                      </span>
                    </div>
                    <span className="focus-row-sub">{formatSeconds(slice.seconds)}</span>
                  </div>
                ))}
            </div>

            <p className="overview-meta">
              共 {allTime.count} 段 · 从 {allTime.firstDayKey} 开始
            </p>

            {/* 没有任何记录时不显示这一行，更不显示 0m。 */}
            {allTime.bestDay !== null && (
              <p className="overview-meta">
                最专注的一天 {allTime.bestDay.dateKey} ·{" "}
                {formatCompact(allTime.bestDay.seconds)}
              </p>
            )}
          </div>

          {/* 第 2 屏 · 年度热力图 */}
          <div className="panel overview-panel">
            <div className="panel-title">
              <span>年度分布</span>
              <span className="heatmap-year">
                <button
                  type="button"
                  className="btn-icon btn-sm"
                  title="上一年（只列有记录的年份）"
                  aria-label="上一年"
                  disabled={yearIndex <= 0}
                  onClick={() => goYear(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>{activeYear} 年</strong>
                <button
                  type="button"
                  className="btn-icon btn-sm"
                  title="下一年（只列有记录的年份）"
                  aria-label="下一年"
                  disabled={yearIndex < 0 || yearIndex >= years.length - 1}
                  onClick={() => goYear(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </span>
            </div>

            {heatmap.totalSeconds === 0 ? (
              <div className="empty">这一年还没有专注记录</div>
            ) : (
              <div className="heatmap">
                {/* 三行分类图共用这一个横向滚动容器，列宽才严格对齐 */}
                <div className="heatmap-scroll">
                  {/* 时间轴：月份只在变月的那一列标一次。它按 .heatmap-label
                      的宽度让出左边距，才能和下面的格子列严格对齐。 */}
                  <div className="heatmap-months" aria-hidden>
                    <svg
                      className="heatmap-months-svg"
                      width={monthAxisData.width}
                      height={18}
                      viewBox={`0 0 ${monthAxisData.width} 18`}
                    >
                      {monthAxisData.labels.map((label) => (
                        <text
                          className="heatmap-month-text"
                          key={label.text + label.x}
                          x={label.x}
                          y={18}
                          transform={`rotate(-60 ${label.x} 18)`}
                        >
                          {label.text}
                        </text>
                      ))}
                    </svg>
                  </div>
                  {FOCUS_HEAT_SUBJECTS.filter(
                    (subject) =>
                      subject.id !== "unclassified" ||
                      heatmap.bySubject.unclassified > 0,
                  ).map((subject) => {
                    // 每张图按自己分类的单日最大值缩放，所以这个数字必须写在标题上。
                    let maxSeconds = 0;
                    for (const week of heatmap.weeks) {
                      for (const cell of week) {
                        const seconds = cell?.bySubject[subject.id] ?? 0;
                        if (seconds > maxSeconds) maxSeconds = seconds;
                      }
                    }

                    return (
                      <div className="heatmap-row" key={subject.id}>
                        <div className="heatmap-label">
                          <span
                            className="focus-dot"
                            style={{ background: subject.color }}
                            aria-hidden
                          />
                          <span className="heatmap-label-text">
                            {subject.label} · 单日最多 {formatCompact(maxSeconds)}
                          </span>
                        </div>
                        <div
                          className="heatmap-cells"
                          role="group"
                          aria-label={`${subject.label} ${activeYear} 年每天专注时长，点某一列展开那一周`}
                        >
                          <div className="heatmap-weekdays" aria-hidden>
                            {["一", "二", "三", "四", "五", "六", "日"].map(
                              (day) => (
                                <span className="heatmap-axis" key={day}>
                                  {day}
                                </span>
                              ),
                            )}
                          </div>
                          {heatmap.weeks.map((week, weekIndex) => {
                            const anchor = columnAnchor(week);
                            if (anchor === null) return null;
                            const isOpen = expandedKey === anchor.dateKey;
                            return (
                              <div className="heatmap-week" key={anchor.dateKey}>
                                <button
                                  type="button"
                                  className={`heatmap-weeklabel${
                                    isOpen ? " active" : ""
                                  }`}
                                  aria-label={`展开 ${columnLabel(anchor)} 那一周`}
                                  /* 列太窄放不下日期，完整范围靠 title 说清楚 */
                                  title={`点开 ${columnLabel(anchor)} – ${columnLabel(
                                    week[6] ?? anchor,
                                  )} 那一周`}
                                  onClick={() =>
                                    setExpandedKey(isOpen ? null : anchor.dateKey)
                                  }
                                />
                                {week.map((cell, dayIndex) =>
                                  cell === null ? (
                                    // 不属于该年的日期：留空位，整列仍然对齐。
                                    <span
                                      className="heatmap-cell blank"
                                      key={`blank-${weekIndex}-${dayIndex}`}
                                      aria-hidden
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className={`heatmap-cell${
                                        isOpen ? " active" : ""
                                      }`}
                                      key={cell.dateKey}
                                      title={`${cell.dateKey} ${weekdayOfDateKey(
                                        cell.dateKey,
                                      )} · ${subject.label} ${
                                        // 只显示该分类那一天的值，没有就照实说 0m
                                        formatCompact(cell.bySubject[subject.id])
                                      }`}
                                      aria-label={`${cell.dateKey} ${weekdayOfDateKey(
                                        cell.dateKey,
                                      )} ${subject.label} ${formatCompact(
                                        cell.bySubject[subject.id],
                                      )}`}
                                      style={
                                        cell.bySubject[subject.id] > 0
                                          ? {
                                              background: subject.color,
                                              opacity: cellAlpha(
                                                cell.bySubject[subject.id],
                                                maxSeconds,
                                              ),
                                            }
                                          : undefined
                                      }
                                      onClick={() =>
                                        setExpandedKey(
                                          isOpen ? null : anchor.dateKey,
                                        )
                                      }
                                    />
                                  ),
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="heatmap-hint">
                  点某一列展开那一周 · 颜色深浅按各分类自己的最大值
                </p>
              </div>
            )}
          </div>

          {/* 第 3 屏 · 展开某一周（一次只展开一周） */}
          {expanded !== null && (
            <div className="panel week-expand">
              <div className="week-expand-head">
                <div className="week-expand-title">
                  <strong>{expanded.rangeLabel}</strong>
                  <span className="week-expand-total">
                    合计 {formatCompact(expanded.totalSeconds)}
                  </span>
                </div>
                <div className="week-expand-slices">
                  {subjectSlices(expanded.bySubject)
                    .filter(
                      (slice) => slice.seconds > 0 || slice.key !== "unclassified",
                    )
                    .map((slice) => (
                      <span className="week-expand-slice" key={slice.key}>
                        <span
                          className="focus-dot"
                          style={{ background: slice.color }}
                          aria-hidden
                        />
                        {slice.label} {formatCompact(slice.seconds)}
                      </span>
                    ))}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setExpandedKey(null)}
                  >
                    <ChevronDown size={14} />
                    收起
                  </button>
                </div>
              </div>

              {/* 7 行永远都在：无记录的那天显示 —，行数忽多忽少会让人以为看错了。 */}
              <div className="week-expand-rows">
                {expanded.days.map((day) => (
                  <div className="week-expand-row" key={day.dateKey}>
                    <span className="week-expand-day">
                      {day.weekday} {shortDateLabel(day.dateKey)}
                    </span>
                    <span className="week-expand-slices">
                      {subjectSlices(day.bySubject)
                        .filter((slice) => slice.seconds > 0)
                        .map((slice) => (
                          <span className="week-expand-slice" key={slice.key}>
                            <span
                              className="focus-dot"
                              style={{ background: slice.color }}
                              aria-hidden
                            />
                            {formatCompact(slice.seconds)}
                          </span>
                        ))}
                    </span>
                    <span className="week-expand-daytotal">
                      {day.seconds > 0 ? formatCompact(day.seconds) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
