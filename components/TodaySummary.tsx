"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";

import { toLocalDateKey } from "@/lib/date";
import { secondsToMinutes, sessionSeconds } from "@/lib/focus-stats";
import type { SessionKind, SessionRecord } from "@/lib/types";

export default function TodaySummary({
  kind,
  refreshKey,
}: {
  kind: SessionKind;
  refreshKey: number;
}) {
  const [summary, setSummary] = useState({ count: 0, seconds: 0 });

  useEffect(() => {
    let active = true;
    fetch("/api/sessions")
      .then((response) => response.json())
      .then((data: { sessions: SessionRecord[] }) => {
        if (!active) return;
        const today = toLocalDateKey(new Date());
        const sessions = (data.sessions ?? []).filter(
          (session) =>
            session.kind === kind &&
            toLocalDateKey(session.started_at) === today,
        );
        setSummary({
          count: sessions.length,
          seconds: sessions.reduce(
            (sum, session) => sum + sessionSeconds(session),
            0,
          ),
        });
      })
      .catch(() => {
        if (active) setSummary({ count: 0, seconds: 0 });
      });
    return () => {
      active = false;
    };
  }, [kind, refreshKey]);

  const label = kind === "meditation" ? "冥想" : "专注";

  return (
    <div className="panel today-panel">
      <div className="panel-title">
        <span>今日{label}</span>
        <span className="panel-hint">已完成</span>
      </div>
      <div className="today-stats">
        <div className="today-stat">
          <span className="today-icon">
            <CheckCircle2 size={18} />
          </span>
          <div className="today-value">
            <strong>{summary.count}</strong>
            <span>次</span>
          </div>
        </div>
        <div className="today-stat">
          <span className="today-icon">
            <Clock3 size={18} />
          </span>
          <div className="today-value">
            <strong>{secondsToMinutes(summary.seconds)}</strong>
            <span>分钟</span>
          </div>
        </div>
      </div>
    </div>
  );
}
