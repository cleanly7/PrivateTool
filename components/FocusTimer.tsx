"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";

import {
  clearPendingRecord,
  pendingToPayload,
  playChime,
  readPendingRecord,
  requestNotificationPermission,
  saveSessionRecord,
  sendNotification,
  writePendingRecord,
} from "@/lib/focus-session";
import {
  resolveStoredTimer,
  type PendingSave,
  type TimerStatus,
} from "@/lib/focus-timer";
import {
  FOCUS_SUBJECTS,
  isFocusKind,
  isFocusSubject,
  type FocusSubject,
  type SessionKind,
} from "@/lib/types";

type WakeLockLike = { release: () => Promise<void> };

const storageKey = (kind: SessionKind) => `focus-timer-${kind}`;

export default function FocusTimer({
  kind,
  defaultMinutes,
  minMinutes,
  maxMinutes,
  title,
  withSubject = false,
  onCompleted,
}: {
  kind: SessionKind;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  title: string;
  /** 专注时间需要选「学什么」（技术学习 / 日语），冥想不需要。 */
  withSubject?: boolean;
  onCompleted: () => void;
}) {
  const [plannedMinutes, setPlannedMinutes] = useState(defaultMinutes);
  const [remainingSeconds, setRemainingSeconds] = useState(defaultMinutes * 60);
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [note, setNote] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [subject, setSubject] = useState<FocusSubject | "">(
    withSubject ? (FOCUS_SUBJECTS[0]?.id ?? "") : "",
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const minutesRef = useRef(plannedMinutes);
  const noteRef = useRef(note);
  const subjectRef = useRef<FocusSubject | "">(subject);
  const wakeLockRef = useRef<WakeLockLike | null>(null);

  useEffect(() => {
    minutesRef.current = plannedMinutes;
  }, [plannedMinutes]);

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    subjectRef.current = subject;
  }, [subject]);

  const releaseWakeLock = useCallback(async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock) {
      try {
        await lock.release();
      } catch {
        // Wake Lock is best effort.
      }
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const navigatorWithWakeLock = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> };
      };
      if (!navigatorWithWakeLock.wakeLock) return;
      const lock = await navigatorWithWakeLock.wakeLock.request("screen");
      wakeLockRef.current = lock;
    } catch {
      // Wake Lock is best effort.
    }
  }, []);

  const finish = useCallback(
    async (completedAtIso: string) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      await releaseWakeLock();
      const minutes = minutesRef.current;
      const startedAt =
        startedAtRef.current ??
        new Date(Date.now() - minutes * 60000).toISOString();
      const pending: PendingSave = {
        startedAt,
        completedAt: completedAtIso,
        seconds: minutes * 60,
        subject: isFocusKind(kind) ? subjectRef.current : "",
        note: noteRef.current.trim(),
        // 倒计时这条老路径不收集大标题和分心，留空即可。
        title: "",
        distractions: [],
      };

      // 倒计时跑完了，草稿不再需要——但记录本身还没落库。
      // 先清界面回到「未开始」，再试着存；存不上就把这条记录留在
      // localStorage 里，界面上给一个明确的重试入口（以前这里是
      // 「先删草稿再发请求、失败了也不管」，记录会无声消失）。
      localStorage.removeItem(storageKey(kind));
      setStatus("idle");
      setRemainingSeconds(minutes * 60);
      setNote("");
      startedAtRef.current = null;
      endAtRef.current = null;

      const result = await saveSessionRecord(pendingToPayload(kind, pending));
      if (result.ok) {
        clearPendingRecord(kind);
        setPendingSave(null);
        setSaveError(null);
        onCompleted();
        return;
      }
      writePendingRecord(kind, pending);
      setPendingSave(pending);
      setSaveError(result.error);
    },
    [kind, onCompleted, releaseWakeLock],
  );

  const tick = useCallback(() => {
    if (endAtRef.current === null) return;
    const remaining = Math.max(
      0,
      Math.round((endAtRef.current - Date.now()) / 1000),
    );
    setRemainingSeconds(remaining);
    if (remaining <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      playChime();
      sendNotification(title);
      void finish(new Date().toISOString());
    }
  }, [finish, title]);

  const begin = useCallback(
    (seconds: number, startedAt: string) => {
      const endAt = Date.now() + seconds * 1000;
      endAtRef.current = endAt;
      startedAtRef.current = startedAt;
      setStatus("running");
      localStorage.setItem(
        storageKey(kind),
        JSON.stringify({
          status: "running",
          endAt,
          plannedMinutes: minutesRef.current,
          startedAt,
          subject: subjectRef.current,
          note: noteRef.current,
        }),
      );
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(tick, 250);
      tick();
      void requestWakeLock();
      requestNotificationPermission();
    },
    [kind, requestWakeLock, tick],
  );

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as { subject?: unknown; note?: unknown };
      const restored = resolveStoredTimer(stored, Date.now());
      if (!restored.ok) {
        // Nothing valid to restore (or storage corrupted by the old
        // ms-vs-seconds bug) — clear it and start fresh.
        localStorage.removeItem(storageKey(kind));
        return;
      }
      // 切走再切回来时保留上次选的科目，不然「日语」会被悄悄变回「技术学习」。
      if (withSubject && isFocusSubject(stored.subject)) {
        subjectRef.current = stored.subject;
        setSubject(stored.subject);
      }
      // 备注同样要保住：中途刷新页面再倒计时结束，写过的内容不能丢。
      if (typeof stored.note === "string" && stored.note !== "") {
        const restoredNote = stored.note.slice(0, 200);
        noteRef.current = restoredNote;
        setNote(restoredNote);
      }
      minutesRef.current = restored.plannedMinutes;
      setPlannedMinutes(restored.plannedMinutes);
      startedAtRef.current = restored.startedAt;
      if (restored.status === "running") {
        setRemainingSeconds(restored.remainingSeconds);
        begin(
          restored.resumeSeconds,
          restored.startedAt ?? new Date().toISOString(),
        );
      } else if (restored.status === "paused") {
        setRemainingSeconds(restored.remainingSeconds);
        setStatus("paused");
      } else {
        setRemainingSeconds(0);
        void finish(restored.completedAtIso);
      }
    } catch {
      localStorage.removeItem(storageKey(kind));
    }
    // Restore the running timer only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  // 上次没存成功的那条记录还在本地：重开窗口也要看得见。
  useEffect(() => {
    const pending = readPendingRecord(kind);
    if (pending) {
      setPendingSave(pending);
      setSaveError("上次没有保存成功");
    }
  }, [kind]);

  const retrySave = async () => {
    if (!pendingSave) return;
    const result = await saveSessionRecord(pendingToPayload(kind, pendingSave));
    if (result.ok) {
      clearPendingRecord(kind);
      setPendingSave(null);
      setSaveError(null);
      onCompleted();
      return;
    }
    setSaveError(result.error);
  };

  const dismissPending = () => {
    if (!window.confirm("丢掉这条没保存成功的记录？")) return;
    clearPendingRecord(kind);
    setPendingSave(null);
    setSaveError(null);
  };

  // 计时中写的备注随时存进 localStorage，刷新/关掉窗口也不会丢。
  useEffect(() => {
    if (status === "idle") return;
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as Record<string, unknown>;
      localStorage.setItem(
        storageKey(kind),
        JSON.stringify({ ...stored, note }),
      );
    } catch {
      // Storage is best effort.
    }
  }, [kind, note, status]);

  const start = () => {
    if (status === "idle") {
      begin(minutesRef.current * 60, new Date().toISOString());
    } else if (status === "paused") {
      begin(remainingSeconds, startedAtRef.current ?? new Date().toISOString());
    }
  };

  const pause = () => {
    if (endAtRef.current === null) return;
    const remaining = Math.max(
      0,
      Math.round((endAtRef.current - Date.now()) / 1000),
    );
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    endAtRef.current = null;
    setRemainingSeconds(remaining);
    setStatus("paused");
    localStorage.setItem(
      storageKey(kind),
      JSON.stringify({
        status: "paused",
        remainingSeconds: remaining,
        plannedMinutes: minutesRef.current,
        startedAt: startedAtRef.current ?? new Date().toISOString(),
        subject: subjectRef.current,
        note: noteRef.current,
      }),
    );
    void releaseWakeLock();
  };

  const reset = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    endAtRef.current = null;
    startedAtRef.current = null;
    setStatus("idle");
    setRemainingSeconds(minutesRef.current * 60);
    setNote("");
    localStorage.removeItem(storageKey(kind));
    void releaseWakeLock();
  };

  const changeMinutes = (delta: number) => {
    if (status !== "idle") return;
    const next = Math.min(
      maxMinutes,
      Math.max(minMinutes, plannedMinutes + delta),
    );
    setPlannedMinutes(next);
    setRemainingSeconds(next * 60);
  };

  const totalSeconds = plannedMinutes * 60;
  const progress =
    totalSeconds > 0
      ? Math.min(1, (totalSeconds - remainingSeconds) / totalSeconds)
      : 0;
  const minutesText = String(Math.floor(remainingSeconds / 60)).padStart(
    2,
    "0",
  );
  const secondsText = String(remainingSeconds % 60).padStart(2, "0");
  const statusLabel =
    status === "running"
      ? "专注中"
      : status === "paused"
        ? "已暂停"
        : "未开始";

  return (
    <div className="panel timer-panel">
      <div className="panel-title">
        <span>{title}</span>
        <span className="panel-hint">{statusLabel}</span>
      </div>
      {pendingSave && (
        <p className="timer-alert err">
          <AlertTriangle size={16} />
          <span>
            上一段 {Math.round(pendingSave.seconds / 60)} 分钟没有保存成功
            {saveError ? `：${saveError}` : ""}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => void retrySave()}>
            重试
          </button>
          <button type="button" className="btn btn-sm" onClick={dismissPending}>
            丢掉
          </button>
        </p>
      )}
      {withSubject && (
        <div className="focus-subject">
          <span className="field-label">专注内容</span>
          <div className="segmented compact" role="group" aria-label="专注内容">
            {FOCUS_SUBJECTS.map((option) => (
              <button
                key={option.id}
                className={subject === option.id ? "active" : ""}
                aria-pressed={subject === option.id}
                onClick={() => {
                  subjectRef.current = option.id;
                  setSubject(option.id);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="timer-ring"
        style={{
          background: `conic-gradient(var(--accent) ${progress * 360}deg, #eef0f3 0deg)`,
        }}
      >
        <div className="timer-face">
          <div className="timer-time">
            {minutesText}:{secondsText}
          </div>
          <div className="timer-sub">{plannedMinutes} 分钟</div>
        </div>
      </div>
      <div className="duration-control">
        <button
          className="btn-icon"
          disabled={status !== "idle"}
          onClick={() => changeMinutes(-5)}
          aria-label="减少 5 分钟"
          title="减少 5 分钟"
        >
          <Minus size={16} />
        </button>
        <div className="duration-display">
          <strong>{plannedMinutes}</strong>
          <span>分钟</span>
        </div>
        <button
          className="btn-icon"
          disabled={status !== "idle"}
          onClick={() => changeMinutes(5)}
          aria-label="增加 5 分钟"
          title="增加 5 分钟"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="timer-note-field">
        <label className="field-label" htmlFor="timer-note">
          {withSubject ? "这次学到了什么" : "备注"}
        </label>
        <textarea
          id="timer-note"
          className="textarea timer-note"
          rows={2}
          placeholder={
            !withSubject
              ? "写下当时的状态、感受或背景"
              : subject === "japanese"
                ? "例：N3 语法第 3 课，～ばかり 的用法"
                : "例：黑马点评第 12 集，缓存穿透处理"
          }
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="timer-actions">
        <button
          className="btn btn-primary"
          onClick={status === "running" ? pause : start}
        >
          {status === "running" ? <Pause size={18} /> : <Play size={18} />}
          {status === "running"
            ? "暂停"
            : status === "paused"
              ? "继续"
              : "开始"}
        </button>
        <button className="btn" onClick={reset}>
          <RotateCcw size={16} />
          重置
        </button>
      </div>
    </div>
  );
}
