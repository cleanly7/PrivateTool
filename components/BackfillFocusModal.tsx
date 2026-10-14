"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { BACKFILL_DEFAULT_MINUTES, checkBackfill } from "@/lib/backfill";
import { toLocalDateTimeInput } from "@/lib/date";
import { saveSessionRecord } from "@/lib/focus-session";
import { readSubjectMemory } from "@/lib/focus-prefs";
import {
  FOCUS_SUBJECTS,
  FOCUS_UNCLASSIFIED,
  MAX_SESSION_TITLE_LENGTH,
  type FocusSubject,
} from "@/lib/types";

/**
 * B1：忘开计时器时，事后补录一整段专注。
 *
 * 保存**必须**走 `lib/focus-session.ts` 的 `saveSessionRecord`（规格 R7），
 * 和计时结束那条路径完全一样：失败时弹窗不关、显示错误、按钮变「重试保存」。
 *
 * 时间口径：`datetime-local` 是本地时间字符串 → `lib/backfill.ts` 的
 * `checkBackfill` 负责按本地时区解析并算出 UTC ISO 的起止时刻；归属日期
 * 由统计层按 `started_at` 落在开始那天（跨零点也算开始那天）。
 */
export default function BackfillFocusModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [subject, setSubject] = useState<FocusSubject | "">("tech");
  const [startValue, setStartValue] = useState("");
  const [minutesText, setMinutesText] = useState(String(BACKFILL_DEFAULT_MINUTES));
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // 每次打开都重置：现在开始、60 分钟；科目取 A4 的记忆值（没有记忆就技术学习）。
    setSubject(readSubjectMemory() ?? "tech");
    setStartValue(toLocalDateTimeInput(new Date()));
    setMinutesText(String(BACKFILL_DEFAULT_MINUTES));
    setTitle("");
    setNote("");
    setError(null);
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const stepMinutes = (delta: number) => {
    const current = Number(minutesText.trim());
    const base = Number.isInteger(current) ? current : BACKFILL_DEFAULT_MINUTES;
    setMinutesText(String(Math.min(1440, Math.max(1, base + delta))));
  };

  const submit = async () => {
    const check = checkBackfill(startValue, minutesText);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveSessionRecord({
      kind: "focus",
      startedAt: check.startedAt,
      completedAt: check.completedAt,
      seconds: check.seconds,
      note: note.trim(),
      subject,
      title: title.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await onSaved();
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modal modal-small"
        role="dialog"
        aria-modal="true"
        aria-label="补录一段专注"
      >
        <div className="modal-head">
          <h2>补录一段专注</h2>
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            disabled={saving}
          >
            <X size={18} />
          </button>
        </div>
        <form
          // 原生约束校验会静默拦掉 submit（详见 SessionNoteModal 里的说明），
          // 这里同样关掉，交给 checkBackfill 给出可见错误。
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <span className="field-label">科目</span>
            <div className="segmented compact" role="group" aria-label="科目">
              {FOCUS_SUBJECTS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={subject === item.id ? "active" : ""}
                  aria-pressed={subject === item.id}
                  onClick={() => setSubject(item.id)}
                  disabled={saving}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className={subject === "" ? "active" : ""}
                aria-pressed={subject === ""}
                onClick={() => setSubject("")}
                disabled={saving}
              >
                {FOCUS_UNCLASSIFIED.label}
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="backfill-start">
              开始时间
            </label>
            <input
              id="backfill-start"
              className="input"
              type="datetime-local"
              step={60}
              value={startValue}
              onChange={(event) => setStartValue(event.target.value)}
              disabled={saving}
            />
            <p className="field-hint">这段算在开始那天</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="backfill-minutes">
              时长
            </label>
            <div className="duration-control">
              <button
                type="button"
                className="btn-icon"
                onClick={() => stepMinutes(-5)}
                aria-label="减少 5 分钟"
                title="减少 5 分钟"
                disabled={saving}
              >
                <Minus size={16} />
              </button>
              <input
                id="backfill-minutes"
                className="duration-input"
                type="number"
                min={1}
                max={1440}
                step={1}
                inputMode="numeric"
                value={minutesText}
                onChange={(event) => setMinutesText(event.target.value)}
                aria-label="分钟"
                disabled={saving}
              />
              <span className="duration-unit">分钟</span>
              <button
                type="button"
                className="btn-icon"
                onClick={() => stepMinutes(5)}
                aria-label="增加 5 分钟"
                title="增加 5 分钟"
                disabled={saving}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="backfill-title">
              这段时间在做什么
            </label>
            <input
              id="backfill-title"
              className="input"
              type="text"
              maxLength={MAX_SESSION_TITLE_LENGTH}
              placeholder="例：黑马点评 第 12 集"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="backfill-note">
              这次学到了什么
            </label>
            <textarea
              id="backfill-note"
              className="textarea"
              rows={4}
              maxLength={200}
              placeholder="比如：黑马点评第 12 集 / N3 语法 てしまう"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={saving}
            />
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "保存中…" : error ? "重试保存" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
