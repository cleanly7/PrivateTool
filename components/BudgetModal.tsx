"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { monthLabel } from "@/lib/date";

export default function BudgetModal({
  open,
  month,
  initialAmount,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  month: string;
  initialAmount: number | null;
  onClose: () => void;
  onSave: (amount: number) => void;
  onClear: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(initialAmount === null ? "" : String(initialAmount));
    setError("");
  }, [open, initialAmount]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = () => {
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) {
      setError("请输入大于 0 的预算金额");
      return;
    }
    onSave(value);
  };

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
        aria-label="设置预算"
      >
        <div className="modal-head">
          <h2>设置预算</h2>
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
            handleSubmit();
          }}
        >
          <div className="field">
            <span className="field-label">月份</span>
            <input className="input" type="text" value={monthLabel(month)} readOnly />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="budget-amount">
              支出上限
            </label>
            <input
              id="budget-amount"
              className="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            {initialAmount !== null && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={onClear}
              >
                清除预算
              </button>
            )}
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
