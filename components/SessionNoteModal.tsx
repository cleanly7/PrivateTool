"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { secondsToMinutes, sessionSeconds } from "@/lib/focus-stats";
import { formatTime } from "@/lib/date";
import {
  MAX_DISTRACTION_REASON_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  FOCUS_SUBJECTS,
  FOCUS_UNCLASSIFIED,
  isFocusKind,
  isFocusSubject,
  type DistractionInput,
  type FocusSubject,
  type SessionRecord,
} from "@/lib/types";

/** 记录页弹窗收上来的东西；`minutes` 是分钟精度，落库时换算成秒。 */
export interface SessionNotePayload {
  note: string;
  subject: FocusSubject | "";
  minutes: number;
  title: string;
  /** 事后补过原因、删过条目之后的分心列表（专注记录才有意义）。 */
  distractions: DistractionInput[];
}

/**
 * 记录页的编辑弹窗：改备注、科目、这段在做什么，以及**实际时长**。
 *
 * 时长按分钟存（秒数会被舍去）：复盘要的是「有效技术小时数」这种能直接写进
 * 表格的数字，不需要秒。冥想记录也能改时长，但没有标题字段。
 *
 * onSave 返回 `null` 表示保存成功；返回字符串则是失败原因——失败时弹窗
 * **不关闭**，让用户看得见、能重试。
 */
export default function SessionNoteModal({
  open,
  session,
  onClose,
  onSave,
}: {
  open: boolean;
  session: SessionRecord | null;
  onClose: () => void;
  onSave: (payload: SessionNotePayload) => Promise<string | null>;
}) {
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState<FocusSubject | "">("");
  const [title, setTitle] = useState("");
  const [minutesText, setMinutesText] = useState("1");
  const [distractions, setDistractions] = useState<DistractionInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && session) {
      setNote(session.note);
      setSubject(isFocusSubject(session.subject) ? session.subject : "");
      setTitle(session.title);
      setMinutesText(String(Math.max(1, secondsToMinutes(sessionSeconds(session)))));
      // 只留弹窗用得上的字段：`id` 是库里的行号，替换语义下没有意义。
      setDistractions(
        session.distractions.map((item) => ({ at: item.at, reason: item.reason })),
      );
      setError(null);
      setSaving(false);
    }
  }, [open, session]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !session) return null;

  const isFocus = isFocusKind(session.kind);

  const stepMinutes = (delta: number) => {
    const current = Number(minutesText.trim());
    const base = Number.isInteger(current) ? current : 1;
    setMinutesText(String(Math.min(1440, Math.max(1, base + delta))));
  };

  const changeReason = (index: number, reason: string) => {
    setDistractions((current) =>
      current.map((item, position) =>
        position === index
          ? { ...item, reason: reason.slice(0, MAX_DISTRACTION_REASON_LENGTH) }
          : item,
      ),
    );
  };

  const removeDistraction = (index: number) => {
    setDistractions((current) => current.filter((_, position) => position !== index));
  };

  const submit = async () => {
    const parsed = Number(minutesText.trim());
    // 就地拦住：0 / 1441 / 小数 / 空都不发请求，服务端规则不用改。
    if (
      minutesText.trim() === "" ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > 1440
    ) {
      setError("时长需为 1–1440 的整数");
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await onSave({
      note: note.trim(),
      subject: isFocus ? subject : "",
      minutes: parsed,
      title: isFocus ? title.trim() : "",
      distractions: isFocus ? distractions : [],
    });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
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
        aria-label={isFocus ? "编辑专注记录" : "编辑备注"}
      >
        <div className="modal-head">
          <h2>{isFocus ? "编辑专注记录" : "编辑备注"}</h2>
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
          // number 输入自带 min/max/step 的原生约束，越界时浏览器会**静默**拦掉 submit，
          // 用户点保存就跟没点一样。这里关掉原生校验，交给我们自己的 minutesText 检查，
          // 才能就地给出「时长需为 1–1440 的整数」。
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {isFocus && (
            <div className="field">
              <label className="field-label" htmlFor="session-title">
                这段时间在做什么
              </label>
              <input
                id="session-title"
                className="input"
                type="text"
                maxLength={MAX_SESSION_TITLE_LENGTH}
                placeholder="例：黑马点评 第 12 集"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={saving}
              />
            </div>
          )}

          {isFocus && (
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
          )}

          <div className="field">
            <label className="field-label" htmlFor="session-minutes">
              {isFocus ? "这段实际学了多久" : "这段实际多久"}
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
                id="session-minutes"
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
            <p className="field-hint">按分钟保存，秒数会被舍去</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="session-note">
              {isFocus ? "这次学到了什么" : "备注"}
            </label>
            <textarea
              id="session-note"
              className="textarea"
              rows={4}
              maxLength={200}
              placeholder={
                isFocus
                  ? "比如：黑马点评第 12 集 / N3 语法 てしまう"
                  : "写下当时的状态、感受或背景"
              }
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={saving}
            />
          </div>

          {isFocus && (
            <div className="focus-distractions">
              <div className="focus-distraction-head">
                <span className="focus-distraction-count">
                  {distractions.length > 0
                    ? `这段分心了 ${distractions.length} 次`
                    : "这段没有记录到分心"}
                </span>
                {distractions.length > 0 && (
                  <span className="focus-distraction-hint">
                    原因可以现在补，记错的那条也能删掉
                  </span>
                )}
              </div>
              {distractions.length > 0 && (
                <ul className="focus-distraction-list">
                  {distractions.map((item, index) => (
                    <li
                      // 分心的身份是时间点；同一条可能被改过原因，所以再带上位置。
                      key={`${item.at}-${index}`}
                      className="focus-distraction-row"
                    >
                      <span className="focus-distraction-time">
                        {formatTime(item.at)}
                      </span>
                      <input
                        className="input"
                        type="text"
                        maxLength={MAX_DISTRACTION_REASON_LENGTH}
                        placeholder="这次是什么让你分心？（可不填）"
                        value={item.reason}
                        onChange={(event) => changeReason(index, event.target.value)}
                        aria-label={`第 ${index + 1} 次分心的原因`}
                        disabled={saving}
                      />
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => removeDistraction(index)}
                        aria-label="删掉这次分心记录"
                        title="删掉这次分心记录"
                        disabled={saving}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
