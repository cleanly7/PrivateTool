"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import type { SessionRecord } from "@/lib/types";

export default function SessionNoteModal({
  open,
  session,
  onClose,
  onSave,
}: {
  open: boolean;
  session: SessionRecord | null;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open && session) setNote(session.note);
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

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-small"
        role="dialog"
        aria-modal="true"
        aria-label="编辑备注"
      >
        <div className="modal-head">
          <h2>编辑备注</h2>
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(note.trim());
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="session-note">
              备注
            </label>
            <textarea
              id="session-note"
              className="textarea"
              rows={4}
              maxLength={200}
              placeholder="写下当时的状态、感受或背景"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
