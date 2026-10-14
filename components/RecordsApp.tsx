"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  Droplets,
  Flower2,
  Pencil,
  Timer,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";

import BackfillFocusModal from "./BackfillFocusModal";
import SessionNoteModal, { type SessionNotePayload } from "./SessionNoteModal";
import { formatDateLabel, formatTime, toLocalDateKey } from "@/lib/date";
import { secondsToMinutes, sessionSeconds } from "@/lib/focus-stats";
import {
  FOCUS_SUBJECTS,
  FOCUS_UNCLASSIFIED,
  isFocusKind,
  type FocusSubject,
  type SessionKind,
  type SessionRecord,
  type WaterIntake,
} from "@/lib/types";

type Filter = "all" | SessionKind | "water";

const kindMeta: Record<
  SessionKind,
  { label: string; icon: LucideIcon; color: string }
> = {
  meditation: { label: "冥想", icon: Flower2, color: "#7c3aed" },
  focus: { label: "专注记录", icon: Timer, color: "#e5484d" },
  pomodoro: { label: "番茄钟", icon: Timer, color: "#e5484d" },
};

const filterOptions: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "meditation", label: "冥想" },
  { id: "focus", label: "专注时间" },
  { id: "water", label: "喝水" },
];

/** 科目名 + 配色（空科目显示为「未分类」）。 */
function subjectMeta(subject: FocusSubject | ""): {
  label: string;
  color: string;
  background: string;
} {
  const color =
    subject === ""
      ? FOCUS_UNCLASSIFIED.color
      : (FOCUS_SUBJECTS.find((item) => item.id === subject)?.color ??
        FOCUS_UNCLASSIFIED.color);
  const label =
    subject === ""
      ? FOCUS_UNCLASSIFIED.label
      : (FOCUS_SUBJECTS.find((item) => item.id === subject)?.label ?? "");
  return { label, color, background: `${color}1a` };
}

type DailyItem =
  | { kind: "session"; session: SessionRecord }
  | { kind: "water"; water: WaterIntake };

function formatVolume(ml: number): string {
  if (ml >= 1000) {
    const liters = (ml / 1000).toFixed(1).replace(/\.0$/, "");
    return `${liters} L`;
  }
  return `${ml} ml`;
}

/** 删除的撤销窗口：这 8 秒里记录其实**还没删**，点撤销就什么都没发生。 */
const DELETE_UNDO_MS = 8000;

export default function RecordsApp() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [waterRecords, setWaterRecords] = useState<WaterIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<SessionRecord | null>(null);
  /** B1 手动补录弹窗：补完直接重新拉一遍列表。 */
  const [backfillOpen, setBackfillOpen] = useState(false);
  /** B2：已经被点掉、还在 8 秒撤销窗口里的那条记录（还没真的删）。 */
  const [pendingDelete, setPendingDelete] = useState<SessionRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pendingDeleteRef = useRef<SessionRecord | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [sessionRes, waterRes] = await Promise.all([
        fetch("/api/sessions"),
        fetch("/api/water?all=1"),
      ]);
      const sessionData = await sessionRes.json();
      const waterData = await waterRes.json();
      setSessions(sessionData.sessions ?? []);
      setWaterRecords(waterData.records ?? []);
    } catch {
      setSessions([]);
      setWaterRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 撤销窗口结束时真正落地删除。 */
  const commitDelete = useCallback(
    async (target: SessionRecord) => {
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      try {
        const response = await fetch(`/api/sessions/${target.id}`, {
          method: "DELETE",
        });
        // 404 说明它已经不在了（别处删过 / 重复提交），对用户来说结果一样。
        if (!response.ok && response.status !== 404) {
          setDeleteError("删除失败，请重试");
          await load();
        }
      } catch {
        setDeleteError("网络异常，删除没成功，请重试");
        await load();
      }
    },
    [load],
  );

  const handleDelete = (session: SessionRecord) => {
    setDeleteError(null);
    // 先从列表里拿掉：删掉的东西不该还杵在那儿等 8 秒。
    setSessions((current) => current.filter((item) => item.id !== session.id));
    // 上一条还在窗口里就直接落地，免得两条待删互相顶掉。
    if (pendingDeleteRef.current) void commitDelete(pendingDeleteRef.current);
    pendingDeleteRef.current = session;
    setPendingDelete(session);
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = setTimeout(() => {
      void commitDelete(session);
    }, DELETE_UNDO_MS);
  };

  const undoDelete = () => {
    const target = pendingDeleteRef.current;
    if (!target) return;
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    // 记录压根没被删，直接按 started_at 放回原来的位置。
    setSessions((current) =>
      current.some((item) => item.id === target.id)
        ? current
        : [...current, target].sort((a, b) =>
            b.started_at.localeCompare(a.started_at),
          ),
    );
  };

  // 离开记录页就把窗口里的删除落地：用户已经去别的工具页了，
  // 这时候不该再留一个「撤销」按钮。这里已经卸载，只能记日志（R6）。
  useEffect(
    () => () => {
      const target = pendingDeleteRef.current;
      if (!target) return;
      pendingDeleteRef.current = null;
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
      void fetch(`/api/sessions/${target.id}`, { method: "DELETE" }).catch(
        (error) => {
          console.error("离开记录页时落地删除失败", error);
        },
      );
    },
    [],
  );

  const filteredSessions = useMemo(
    () =>
      filter === "all" || filter === "water"
        ? sessions
        : sessions.filter((session) => session.kind === filter),
    [sessions, filter],
  );

  const showWater = filter === "all" || filter === "water";

  // 冥想/专注/喝水合并为一张按天分组的列表
  const daily = useMemo(() => {
    const map = new Map<string, DailyItem[]>();
    const push = (key: string, item: DailyItem) => {
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    };
    for (const session of filteredSessions) {
      push(toLocalDateKey(session.started_at), { kind: "session", session });
    }
    if (showWater) {
      for (const water of waterRecords) {
        push(toLocalDateKey(water.logged_at), { kind: "water", water });
      }
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredSessions, waterRecords, showWater]);

  const totals = useMemo(() => {
    let count = 0;
    let seconds = 0;
    let ml = 0;
    for (const [, items] of daily) {
      for (const item of items) {
        count += 1;
        if (item.kind === "session") {
          seconds += sessionSeconds(item.session);
        } else {
          ml += item.water.amount_ml;
        }
      }
    }
    return { count, seconds, ml };
  }, [daily]);

  /**
   * 保存弹窗里的改动。返回 `null` 表示成功，返回字符串是失败原因——
   * 失败时弹窗不关，用户能看见错、能重试，改了一半的内容不会丢。
   *
   * 时长按分钟提交（`actual_seconds = 分钟 * 60`），服务端会同步
   * `planned_minutes`，所以改完时长今日/本周合计立刻跟着变。
   * 分心也只有专注记录才提交（冥想没有分心这回事）。
   */
  const handleSaveNote = async (
    payload: SessionNotePayload,
  ): Promise<string | null> => {
    if (!editing) return "记录不存在";
    const isFocus = isFocusKind(editing.kind);
    try {
      const response = await fetch(`/api/sessions/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: payload.note,
          subject: payload.subject,
          actual_seconds: payload.minutes * 60,
          ...(isFocus
            ? { title: payload.title, distractions: payload.distractions }
            : {}),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        return data?.error ?? "保存失败，请重试";
      }
      const data = (await response.json()) as { session: SessionRecord };
      setSessions((current) =>
        current.map((session) =>
          session.id === data.session.id ? data.session : session,
        ),
      );
      return null;
    } catch {
      return "网络异常，请重试";
    }
  };

  const summaryParts = [
    `${totals.count} 次`,
    totals.seconds > 0 && `${secondsToMinutes(totals.seconds)} 分钟`,
    totals.ml > 0 && formatVolume(totals.ml),
  ].filter(Boolean) as string[];

  return (
    <main className="app-shell">
      <div className="tool-header">
        <h2 className="tool-title">记录</h2>
        <span className="panel-hint">{summaryParts.join(" · ")}</span>
        <div className="top-actions">
          <button
            className="btn"
            onClick={() => setBackfillOpen(true)}
            aria-label="补录专注"
            title="忘开计时器时，事后把这段补上"
          >
            <CalendarPlus size={16} />
            补录专注
          </button>
        </div>
      </div>

      <div className="list-filters records-filter">
        <div className="segmented compact">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              className={filter === option.id ? "active" : ""}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="panel empty">正在加载…</div>
      ) : daily.length === 0 ? (
        <div className="panel empty">还没有记录</div>
      ) : (
        daily.map(([dateKey, items]) => {
          const daySeconds = items.reduce(
            (sum, item) =>
              sum + (item.kind === "session" ? sessionSeconds(item.session) : 0),
            0,
          );
          const dayMl = items.reduce(
            (sum, item) => sum + (item.kind === "water" ? item.water.amount_ml : 0),
            0,
          );
          const dayParts = [
            `${items.length} 次`,
            daySeconds > 0 && `${secondsToMinutes(daySeconds)} 分钟`,
            dayMl > 0 && formatVolume(dayMl),
          ].filter(Boolean) as string[];
          return (
            <section className="record-group" key={dateKey}>
              <div className="record-date">
                <span>{formatDateLabel(dateKey)}</span>
                <span className="panel-hint">{dayParts.join(" · ")}</span>
              </div>
              <div className="panel">
                {items.map((item) =>
                  item.kind === "session" ? (
                    <div className="record-row" key={item.session.id}>
                      {(() => {
                        const isFocus = isFocusKind(item.session.kind);
                        const Icon = kindMeta[item.session.kind].icon;
                        const accent = isFocus
                          ? subjectMeta(item.session.subject)
                          : {
                              label: kindMeta.meditation.label,
                              color: kindMeta.meditation.color,
                              background: `${kindMeta.meditation.color}1a`,
                            };
                        return (
                          <>
                            <span
                              className="cat-icon"
                              style={{
                                background: accent.background,
                                color: accent.color,
                              }}
                            >
                              <Icon size={18} />
                            </span>
                            <div className="record-main">
                              <div className="tx-title">
                                {isFocus && (
                                  <span
                                    className="subject-badge"
                                    style={{
                                      background: accent.background,
                                      color: accent.color,
                                    }}
                                  >
                                    {accent.label}
                                  </span>
                                )}
                                {!isFocus && `${kindMeta[item.session.kind].label} · `}
                                {secondsToMinutes(sessionSeconds(item.session))} 分钟
                                {item.session.distractions.length > 0 && (
                                  <button
                                    type="button"
                                    className="distraction-badge"
                                    onClick={() => setEditing(item.session)}
                                    aria-label="补分心原因"
                                    title={`点开补原因或删掉记错的那条\n${item.session.distractions
                                      .map(
                                        (entry) =>
                                          `${formatTime(entry.at)} ${
                                            entry.reason || "没写原因"
                                          }`,
                                      )
                                      .join("\n")}`}
                                  >
                                    <Zap size={12} />
                                    分心 {item.session.distractions.length}
                                  </button>
                                )}
                              </div>
                              {item.session.title && (
                                <div className="record-title">
                                  {item.session.title}
                                </div>
                              )}
                              {item.session.note && (
                                <div className="record-note">
                                  {item.session.note}
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                      <div className="record-time">
                        {formatTime(item.session.started_at)}
                      </div>
                      <div className="tx-actions">
                        <button
                          className="btn-icon btn-sm"
                          onClick={() => setEditing(item.session)}
                          aria-label={isFocusKind(item.session.kind) ? "编辑专注记录" : "编辑备注"}
                          title={isFocusKind(item.session.kind) ? "编辑专注记录" : "编辑备注"}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="btn-icon btn-sm"
                          onClick={() => handleDelete(item.session)}
                          aria-label="删除记录"
                          title="删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="record-row" key={item.water.id}>
                      <span className="cat-icon water-cat">
                        <Droplets size={16} />
                      </span>
                      <div className="record-main">
                        <div className="tx-title">{item.water.amount_ml} ml</div>
                      </div>
                      <div className="record-time">
                        {formatTime(item.water.logged_at)}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </section>
          );
        })
      )}

      {/* 撤销窗口里的记录其实还在库里，点「撤销」什么都不用恢复。 */}
      {pendingDelete && (
        <div className="toast" role="status" aria-live="polite">
          已删除记录
          <button type="button" className="toast-undo" onClick={undoDelete}>
            撤销
          </button>
        </div>
      )}

      {deleteError && (
        <div className="toast" role="alert">
          {deleteError}
          <button
            type="button"
            className="toast-undo"
            onClick={() => setDeleteError(null)}
          >
            知道了
          </button>
        </div>
      )}

      <SessionNoteModal
        open={editing !== null}
        session={editing}
        onClose={() => setEditing(null)}
        onSave={handleSaveNote}
      />

      <BackfillFocusModal
        open={backfillOpen}
        onClose={() => setBackfillOpen(false)}
        onSaved={() => load()}
      />
    </main>
  );
}
