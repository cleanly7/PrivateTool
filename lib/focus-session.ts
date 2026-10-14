/**
 * 计时结束以后「把记录存下去」这件事的公共部分：请求、提示音、系统通知，
 * 以及保存失败时留在本地的那条待重试记录。
 *
 * 正计时（components/FocusSession.tsx）和倒计时（components/FocusTimer.tsx）
 * 都走这里，别再各自写一份：以前倒计时那边是「先清掉草稿再发请求，失败
 * 也不管」，计时结束那一刻网络一抖记录就没了，用户根本不知道。
 */

import {
  parsePendingSave,
  type PendingSave,
} from "./focus-timer.ts";
import {
  isFocusSubject,
  type DistractionInput,
  type FocusSubject,
  type SessionKind,
} from "./types.ts";

export interface SessionSavePayload {
  kind: SessionKind;
  /** 这段开始的时刻（统计归属按它算）。 */
  startedAt: string;
  /** 结束的时刻（用户点「结束并保存」的那一下）。 */
  completedAt: string;
  /** 真实有效秒数。 */
  seconds: number;
  note: string;
  subject: FocusSubject | "";
  /** 这段在做什么（大标题）。 */
  title?: string;
  /** 这段里按下的分心。 */
  distractions?: DistractionInput[];
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveSessionRecord(
  payload: SessionSavePayload,
): Promise<SaveResult> {
  const seconds = Math.max(1, Math.round(payload.seconds));
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: payload.kind,
        // planned_minutes 是兼容字段，按实际时长折算成分钟。
        planned_minutes: Math.max(1, Math.round(seconds / 60)),
        started_at: payload.startedAt,
        completed_at: payload.completedAt,
        note: payload.note,
        subject: payload.subject,
        actual_seconds: seconds,
        title: payload.title ?? "",
        distractions: payload.distractions ?? [],
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      return {
        ok: false,
        error:
          body && typeof body.error === "string"
            ? body.error
            : `服务返回 ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "网络异常",
    };
  }
}

/* ------------------------------------------------------------------ *
 * 保存失败留下的那条记录
 * ------------------------------------------------------------------ */

const pendingStorageKey = (kind: SessionKind) => `focus-timer-${kind}-pending`;

export function readPendingRecord(kind: SessionKind): PendingSave | null {
  try {
    const raw = localStorage.getItem(pendingStorageKey(kind));
    if (!raw) return null;
    return parsePendingSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePendingRecord(kind: SessionKind, pending: PendingSave): void {
  try {
    localStorage.setItem(pendingStorageKey(kind), JSON.stringify(pending));
  } catch {
    // Storage is best effort.
  }
}

export function clearPendingRecord(kind: SessionKind): void {
  try {
    localStorage.removeItem(pendingStorageKey(kind));
  } catch {
    // Storage is best effort.
  }
}

export function pendingToPayload(
  kind: SessionKind,
  pending: PendingSave,
): SessionSavePayload {
  return {
    kind,
    startedAt: pending.startedAt,
    completedAt: pending.completedAt,
    seconds: pending.seconds,
    note: pending.note,
    subject: isFocusSubject(pending.subject) ? pending.subject : "",
    title: pending.title,
    distractions: pending.distractions,
  };
}

/* ------------------------------------------------------------------ *
 * 声音与系统通知（都是「能响就响」，失败不打扰用户）
 * ------------------------------------------------------------------ */

export function playChime(): void {
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

export function requestNotificationPermission(): void {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // Notifications are best effort.
  }
}

export function sendNotification(title: string, body = "计时结束"): void {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    // Notifications are best effort.
  }
}
