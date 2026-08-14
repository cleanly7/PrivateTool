"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarCheck2,
  Clock3,
  Flower2,
  Pencil,
  Timer,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import SessionNoteModal from "./SessionNoteModal";
import { formatDateLabel, formatTime, toLocalDateKey } from "@/lib/date";
import type { SessionKind, SessionRecord } from "@/lib/types";

type Filter = "all" | SessionKind;

const kindMeta: Record<
  SessionKind,
  { label: string; icon: LucideIcon; color: string }
> = {
  meditation: { label: "冥想", icon: Flower2, color: "#7c3aed" },
  pomodoro: { label: "番茄钟", icon: Timer, color: "#e5484d" },
};

export default function RecordsApp() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<SessionRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions");
      const data = await response.json();
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? sessions
        : sessions.filter((session) => session.kind === filter),
    [sessions, filter],
  );

  const stats = useMemo(() => {
    const today = toLocalDateKey(new Date());
    return filtered.reduce(
      (acc, session) => {
        acc.totalCount += 1;
        acc.totalMinutes += session.planned_minutes;
        if (toLocalDateKey(session.completed_at) === today) {
          acc.todayCount += 1;
          acc.todayMinutes += session.planned_minutes;
        }
        return acc;
      },
      { totalCount: 0, totalMinutes: 0, todayCount: 0, todayMinutes: 0 },
    );
  }, [filtered]);

  const groups = useMemo(() => {
    const map = new Map<string, SessionRecord[]>();
    for (const session of filtered) {
      const key = toLocalDateKey(session.completed_at);
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const handleSaveNote = async (note: string) => {
    if (!editing) return;
    const response = await fetch(`/api/sessions/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (response.ok) {
      const data = await response.json();
      setSessions((current) =>
        current.map((session) =>
          session.id === data.session.id ? data.session : session,
        ),
      );
      setEditing(null);
    } else {
      window.alert("备注保存失败，请重试");
    }
  };

  const handleDelete = async (session: SessionRecord) => {
    const label = kindMeta[session.kind].label;
    if (!window.confirm(`确定删除这笔${label}记录吗？`)) return;
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setSessions((current) =>
        current.filter((item) => item.id !== session.id),
      );
    } else {
      window.alert("删除失败，请重试");
    }
  };

  return (
    <main className="app-shell">
      <div className="tool-header">
        <h2 className="tool-title">记录</h2>
        <span className="panel-hint">共 {filtered.length} 条</span>
      </div>

      <section className="records-stats" aria-label="记录统计">
        <div className="summary-card">
          <span className="summary-icon balance">
            <CalendarCheck2 size={20} />
          </span>
          <div className="summary-copy">
            <div className="summary-label">累计次数</div>
            <div className="summary-value">{stats.totalCount} 次</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon budget">
            <Clock3 size={20} />
          </span>
          <div className="summary-copy">
            <div className="summary-label">累计时长</div>
            <div className="summary-value">{stats.totalMinutes} 分钟</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon income">
            <CalendarCheck2 size={20} />
          </span>
          <div className="summary-copy">
            <div className="summary-label">今日完成</div>
            <div className="summary-value">
              {stats.todayCount} 次 · {stats.todayMinutes} 分钟
            </div>
          </div>
        </div>
      </section>

      <div className="list-filters records-filter">
        <div className="segmented compact">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            全部
          </button>
          <button
            className={filter === "meditation" ? "active" : ""}
            onClick={() => setFilter("meditation")}
          >
            冥想
          </button>
          <button
            className={filter === "pomodoro" ? "active" : ""}
            onClick={() => setFilter("pomodoro")}
          >
            番茄钟
          </button>
        </div>
      </div>

      {loading ? (
        <div className="panel empty">正在加载…</div>
      ) : groups.length === 0 ? (
        <div className="panel empty">还没有完成记录</div>
      ) : (
        groups.map(([dateKey, items]) => {
          const minutes = items.reduce(
            (sum, session) => sum + session.planned_minutes,
            0,
          );
          return (
            <section className="record-group" key={dateKey}>
              <div className="record-date">
                <span>{formatDateLabel(dateKey)}</span>
                <span className="panel-hint">
                  {items.length} 次 · {minutes} 分钟
                </span>
              </div>
              <div className="panel">
                {items.map((session) => {
                  const meta = kindMeta[session.kind];
                  const Icon = meta.icon;
                  return (
                    <div className="record-row" key={session.id}>
                      <span
                        className="cat-icon"
                        style={{
                          background: `${meta.color}1a`,
                          color: meta.color,
                        }}
                      >
                        <Icon size={18} />
                      </span>
                      <div className="record-main">
                        <div className="tx-title">
                          {meta.label} · {session.planned_minutes} 分钟
                        </div>
                        {session.note && (
                          <div className="record-note">{session.note}</div>
                        )}
                      </div>
                      <div className="record-time">
                        {formatTime(session.completed_at)}
                      </div>
                      <div className="tx-actions">
                        <button
                          className="btn-icon btn-sm"
                          onClick={() => setEditing(session)}
                          aria-label="编辑备注"
                          title="编辑备注"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="btn-icon btn-sm"
                          onClick={() => handleDelete(session)}
                          aria-label="删除记录"
                          title="删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <SessionNoteModal
        open={editing !== null}
        session={editing}
        onClose={() => setEditing(null)}
        onSave={handleSaveNote}
      />
    </main>
  );
}
