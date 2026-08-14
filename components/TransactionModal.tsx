"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";

import { CategoryIcon, categoryColor, expenseCategories, incomeCategories } from "./CategoryIcon";
import { localToday } from "@/lib/date";
import type { Transaction, TransactionInput, TransactionType } from "@/lib/types";

export default function TransactionModal({
  open,
  transaction,
  onClose,
  onSave,
}: {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onSave: (input: TransactionInput) => void;
}) {
  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(expenseCategories[0]);
  const [date, setDate] = useState(localToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setType(transaction.type);
      setAmount(String(transaction.amount));
      setCategory(transaction.category);
      setDate(transaction.date);
      setNote(transaction.note);
    } else {
      setType("expense");
      setAmount("");
      setCategory(expenseCategories[0]);
      setDate(localToday());
      setNote("");
    }
    setError("");
  }, [open, transaction]);

  useEffect(() => {
    const categories = type === "income" ? incomeCategories : expenseCategories;
    if (!categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [type, category]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const categories = type === "income" ? incomeCategories : expenseCategories;

  const handleSubmit = () => {
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) {
      setError("请输入大于 0 的金额");
      return;
    }
    if (!date) {
      setError("请选择日期");
      return;
    }
    onSave({
      type,
      amount: value,
      category,
      note: note.trim(),
      date,
    });
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={transaction ? "编辑记录" : "记一笔"}
      >
        <div className="modal-head">
          <h2>{transaction ? "编辑记录" : "记一笔"}</h2>
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
            <span className="field-label">类型</span>
            <div className="segmented">
              <button
                type="button"
                className={type === "expense" ? "active" : ""}
                onClick={() => setType("expense")}
              >
                支出
              </button>
              <button
                type="button"
                className={type === "income" ? "active" : ""}
                onClick={() => setType("income")}
              >
                收入
              </button>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="amount">
              金额
            </label>
            <input
              id="amount"
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
          <div className="field">
            <span className="field-label">分类</span>
            <div className="category-grid">
              {categories.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`category-chip${category === name ? " active" : ""}`}
                  onClick={() => setCategory(name)}
                  style={
                    {
                      "--chip-color": categoryColor(name),
                    } as CSSProperties
                  }
                >
                  <span className="chip-icon">
                    <CategoryIcon name={name} />
                  </span>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="date">
                日期
              </label>
              <input
                id="date"
                className="input"
                type="date"
                value={date}
                max={localToday()}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="note">
                备注
              </label>
              <input
                id="note"
                className="input"
                type="text"
                placeholder="可选"
                maxLength={60}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              {transaction ? "保存修改" : "添加记录"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
