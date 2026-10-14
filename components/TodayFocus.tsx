"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import {
  formatCompact,
  formatSeconds,
  formatSecondsText,
  summarizeFocusDay,
} from "@/lib/focus-stats";
import {
  FOCUS_SUBJECTS,
  FOCUS_UNCLASSIFIED,
  type SessionRecord,
} from "@/lib/types";

/**
 * 今天学了多久：技术学习 / 日语 / 未分类三行 + 分心次数。
 *
 * 时长一律分钟精度（`2h30m`）——「2.5h」这种小数对人没有意义。
 * 右下角一键复制成中文写法，直接粘进当天的复盘。
 */
export default function TodayFocus({ refreshKey }: { refreshKey: number }) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const day = summarizeFocusDay(sessions);
  const unclassifiedSeconds = day.bySubject.unclassified;
  const copyText = () =>
    [
      ...FOCUS_SUBJECTS.map(
        (subject) =>
          `${subject.label} ${formatSecondsText(day.bySubject[subject.id])}`,
      ),
      `合计 ${formatSecondsText(day.seconds)}`,
      day.distractionCount > 0 ? `分心 ${day.distractionCount} 次` : "",
    ]
      .filter((part) => part !== "")
      .join("、");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText());
      setCopied(true);
    } catch {
      window.alert(`复制失败，手动记一下：${copyText()}`);
    }
  };

  return (
    <div className="panel today-panel">
      <div className="panel-title">
        <span>今日专注</span>
        <span className="panel-hint">
          {loading
            ? "加载中…"
            : `${day.count} 次 · ${formatSeconds(day.seconds)}${
                day.distractionCount > 0
                  ? ` · 分心 ${day.distractionCount} 次`
                  : ""
              }`}
        </span>
      </div>

      <div className="focus-rows">
        {FOCUS_SUBJECTS.map((subject) => {
          const seconds = day.bySubject[subject.id];
          return (
            <div className="focus-row" key={subject.id}>
              <span
                className="focus-dot"
                style={{ background: subject.color }}
                aria-hidden
              />
              <div className="focus-row-main">
                <span className="focus-row-label">{subject.label}</span>
                <span className="focus-row-hours">
                  {formatCompact(seconds)}
                </span>
              </div>
              <span className="focus-row-sub">{formatSeconds(seconds)}</span>
            </div>
          );
        })}
        {unclassifiedSeconds > 0 && (
          <div className="focus-row">
            <span
              className="focus-dot"
              style={{ background: FOCUS_UNCLASSIFIED.color }}
              aria-hidden
            />
            <div className="focus-row-main">
              <span className="focus-row-label">{FOCUS_UNCLASSIFIED.label}</span>
              <span className="focus-row-hours">
                {formatCompact(unclassifiedSeconds)}
              </span>
            </div>
            <span className="focus-row-sub">{formatSeconds(unclassifiedSeconds)}</span>
          </div>
        )}
      </div>

      {day.distractionCount > 0 && (
        <div className="today-distractions">
          <span className="focus-distraction-count">
            今天记了 {day.distractionCount} 次分心
          </span>
          <ul className="focus-distraction-list">
            {day.distractions.slice(0, 6).map((item, index) => (
              <li key={`${item.at}-${index}`} className="focus-distraction-row">
                <span className="focus-distraction-time">{item.time}</span>
                <span className="focus-distraction-reason">
                  {item.reason || "（没写原因）"}
                </span>
              </li>
            ))}
          </ul>
          {day.distractions.length > 6 && (
            <p className="field-hint">
              还有 {day.distractions.length - 6} 条没显示，去记录页看全部
            </p>
          )}
        </div>
      )}

      <button className="btn btn-sm focus-copy" onClick={handleCopy}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "已复制" : "复制到复盘"}
      </button>
    </div>
  );
}
