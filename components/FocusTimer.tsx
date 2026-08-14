"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";

import type { SessionKind } from "@/lib/types";

type TimerStatus = "idle" | "running" | "paused";

interface StoredTimer {
  status: TimerStatus;
  endAt?: number;
  remainingSeconds?: number;
  plannedMinutes: number;
  startedAt: string;
}

type WakeLockLike = { release: () => Promise<void> };

const storageKey = (kind: SessionKind) => `focus-timer-${kind}`;

function playChime() {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const context = new AudioContextClass();
    [0, 0.25, 0.5].forEach((delay, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = "sine";
      oscillator.frequency.value = 660 + index * 110;
      const startAt = context.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.7);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.75);
    });
  } catch {
    // Audio is best effort and may be blocked by the browser.
  }
}

function requestNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // Notifications are best effort.
  }
}

function sendNotification(title: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body: "计时结束" });
    }
  } catch {
    // Notifications are best effort.
  }
}

export default function FocusTimer({
  kind,
  defaultMinutes,
  minMinutes,
  maxMinutes,
  title,
  onCompleted,
}: {
  kind: SessionKind;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  title: string;
  onCompleted: () => void;
}) {
  const [plannedMinutes, setPlannedMinutes] = useState(defaultMinutes);
  const [remainingSeconds, setRemainingSeconds] = useState(defaultMinutes * 60);
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [note, setNote] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const minutesRef = useRef(plannedMinutes);
  const noteRef = useRef(note);
  const wakeLockRef = useRef<WakeLockLike | null>(null);

  useEffect(() => {
    minutesRef.current = plannedMinutes;
  }, [plannedMinutes]);

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

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
      localStorage.removeItem(storageKey(kind));
      const minutes = minutesRef.current;
      const startedAt =
        startedAtRef.current ??
        new Date(Date.now() - minutes * 60000).toISOString();
      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            planned_minutes: minutes,
            started_at: startedAt,
            completed_at: completedAtIso,
            note: noteRef.current,
          }),
        });
        if (response.ok) onCompleted();
      } catch {
        // Keep the local state consistent even if the request fails.
      }
      setStatus("idle");
      setRemainingSeconds(minutes * 60);
      setNote("");
      startedAtRef.current = null;
      endAtRef.current = null;
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
      const stored = JSON.parse(raw) as StoredTimer;
      if (typeof stored.plannedMinutes !== "number") return;
      minutesRef.current = stored.plannedMinutes;
      setPlannedMinutes(stored.plannedMinutes);
      startedAtRef.current = stored.startedAt ?? null;
      if (stored.status === "running" && typeof stored.endAt === "number") {
        const remainingMs = stored.endAt - Date.now();
        if (remainingMs > 0) {
          setRemainingSeconds(Math.round(remainingMs / 1000));
          begin(remainingMs, stored.startedAt);
        } else {
          setRemainingSeconds(0);
          void finish(new Date(stored.endAt).toISOString());
        }
      } else if (
        stored.status === "paused" &&
        typeof stored.remainingSeconds === "number"
      ) {
        setRemainingSeconds(stored.remainingSeconds);
        setStatus("paused");
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
      <input
        className="input timer-note"
        type="text"
        placeholder="本次备注（可选）"
        maxLength={100}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
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
