"use client";

import { useEffect, useState } from "react";

import {
  formatCompact,
  formatSeconds,
  summarizeFocusWeek,
  type SubjectSeconds,
} from "@/lib/focus-stats";
import {
  FOCUS_SUBJECTS,
  FOCUS_SUBJECT_LABELS,
  FOCUS_UNCLASSIFIED,
  type FocusSubject,
  type SessionRecord,
} from "@/lib/types";

type SubjectSlice = { key: string; label: string; color: string; seconds: number };

function slices(bySubject: SubjectSeconds): SubjectSlice[] {
  return [
    ...FOCUS_SUBJECTS.map((subject) => ({
      key: subject.id,
      label: subject.label,
      color: subject.color,
      seconds: bySubject[subject.id],
    })),
    {
      key: "unclassified",
      label: FOCUS_UNCLASSIFIED.label,
      color: FOCUS_UNCLASSIFIED.color,
      seconds: bySubject.unclassified,
    },
  ];
}

function subjectLabel(subject: FocusSubject | ""): string {
  return subject === "" ? FOCUS_UNCLASSIFIED.label : FOCUS_SUBJECT_LABELS[subject];
}

function subjectColor(subject: FocusSubject | ""): string {
  if (subject === "") return FOCUS_UNCLASSIFIED.color;
  return FOCUS_SUBJECTS.find((item) => item.id === subject)?.color ?? FOCUS_UNCLASSIFIED.color;
}

/** 半透明底 + 同色文字的小标签。 */
function badgeStyle(subject: FocusSubject | ""): {
  background: string;
  color: string;
} {
  const color = subjectColor(subject);
  return { background: `${color}1f`, color };
}

/** 每周专注数据：合计、科目拆分、每天一根柱子、以及本周写下的学习备注。 */
export default function WeeklyFocus({ refreshKey }: { refreshKey: number }) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/sessions")
      .then((response) => response.json())
      .then((data: { sessions: SessionRecord[] }) => {
        if (active) setSessions(data.sessions ?? []);
      })
      .catch(() => {
        if (active) setSessions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const week = summarizeFocusWeek(sessions);
  const legend = slices(week.bySubject).filter(
    (slice) => slice.seconds > 0 || slice.key !== "unclassified",
  );
  const max = week.maxDaySeconds;

  return (
    <section className="panel week-panel">
      <div className="panel-title">
        <span>本周专注</span>
        <span className="panel-hint">
          {loading ? "加载中…" : `${week.rangeLabel} · ${week.count} 次`}
        </span>
      </div>

      <div className="week-stats">
        <div className="week-stat">
          <strong>{formatSeconds(week.totalSeconds)}</strong>
          <span>本周合计</span>
        </div>
        {FOCUS_SUBJECTS.map((subject) => (
          <div className="week-stat" key={subject.id}>
            <strong style={{ color: subject.color }}>
              {formatCompact(week.bySubject[subject.id])}
            </strong>
            <span>{subject.label}</span>
          </div>
        ))}
        {week.distractionCount > 0 && (
          <div className="week-stat">
            <strong>{week.distractionCount} 次</strong>
            <span>分心</span>
          </div>
        )}
      </div>

      <div className="week-chart" role="img" aria-label="本周每天的专注时长">
        {week.days.map((day) => {
          const total = day.seconds;
          return (
            <div
              className={`week-col${day.isToday ? " today" : ""}`}
              key={day.dateKey}
              title={`${day.weekday} ${day.dayOfMonth} 日：${formatSeconds(total)}`}
            >
              <span className="week-col-value">
                {total > 0 ? formatCompact(total) : ""}
              </span>
              <div className="week-track">
                <div
                  className="week-fill"
                  style={{ height: max > 0 ? `${(total / max) * 100}%` : "0%" }}
                >
                  {total > 0 &&
                    slices(day.bySubject)
                      .filter((slice) => slice.seconds > 0)
                      .map((slice) => (
                        <span
                          className="week-seg"
                          key={slice.key}
                          style={{
                            height: `${(slice.seconds / total) * 100}%`,
                            background: slice.color,
                          }}
                        />
                      ))}
                </div>
              </div>
              <span className="week-col-day">
                {day.weekday.replace("周", "")}
                <em>{day.dayOfMonth}</em>
              </span>
            </div>
          );
        })}
      </div>

      <div className="week-legend">
        {legend.map((slice) => (
          <span className="legend-item" key={slice.key}>
            <span className="focus-dot" style={{ background: slice.color }} />
            {slice.label}
            <em>{formatSeconds(slice.seconds)}</em>
          </span>
        ))}
      </div>

      <div className="week-notes">
        <div className="panel-title week-notes-title">
          <span>本周学到了什么</span>
          <span className="panel-hint">{week.notes.length} 条</span>
        </div>
        {week.notes.length === 0 ? (
          <div className="empty">本周还没有写学习记录</div>
        ) : (
          week.notes.map((item) => (
            <div className="week-note" key={item.id}>
              <span className="week-note-time">
                {item.weekday} {item.time}
              </span>
              <span className="subject-badge" style={badgeStyle(item.subject)}>
                {subjectLabel(item.subject)}
              </span>
              <span className="week-note-minutes">{formatSeconds(item.seconds)}</span>
              {item.title !== "" && (
                <span className="week-note-title">{item.title}</span>
              )}
              <p className="week-note-text">{item.note}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
