"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
} from "lucide-react";

import CategoryBreakdown from "./CategoryBreakdown";
import DailyChart from "./DailyChart";
import BudgetModal from "./BudgetModal";
import MonthlyComparison from "./MonthlyComparison";
import SummaryCards from "./SummaryCards";
import TransactionList from "./TransactionList";
import TransactionModal from "./TransactionModal";
import { localMonth, monthLabel } from "@/lib/date";
import type { Transaction, TransactionInput } from "@/lib/types";

type TypeFilter = "all" | "income" | "expense";

export default function BookkeepingApp() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(() => localMonth());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);

  const loadTransactions = useCallback(async () => {
    try {
      const response = await fetch("/api/transactions");
      if (!response.ok) throw new Error("加载失败");
      const data = await response.json();
      setTransactions(data.transactions ?? []);
      setLoadError("");
    } catch {
      setLoadError("数据加载失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const loadBudget = useCallback(async (targetMonth: string) => {
    try {
      const response = await fetch(`/api/budget?month=${targetMonth}`);
      if (!response.ok) return;
      const data = await response.json();
      setBudget(typeof data.amount === "number" ? data.amount : null);
    } catch {
      setBudget(null);
    }
  }, []);

  useEffect(() => {
    loadBudget(month);
  }, [month, loadBudget]);

  const monthTransactions = useMemo(
    () => transactions.filter((item) => item.date.startsWith(month)),
    [transactions, month],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return monthTransactions.filter((item) => {
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const matchesQuery =
        keyword === "" ||
        item.category.toLowerCase().includes(keyword) ||
        item.note.toLowerCase().includes(keyword);
      return matchesType && matchesQuery;
    });
  }, [monthTransactions, typeFilter, query]);

  const totals = useMemo(() => {
    return monthTransactions.reduce(
      (acc, item) => {
        if (item.type === "income") {
          acc.income += item.amount;
        } else {
          acc.expense += item.amount;
        }
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [monthTransactions]);

  const shiftMonth = (offset: number) => {
    const [year, monthNum] = month.split("-").map(Number);
    const date = new Date(year, monthNum - 1 + offset, 1);
    setMonth(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (transaction: Transaction) => {
    setEditing(transaction);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleSave = async (input: TransactionInput) => {
    const url = editing
      ? `/api/transactions/${editing.id}`
      : "/api/transactions";
    const method = editing ? "PATCH" : "POST";
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      window.alert("保存失败，请重试");
      return;
    }
    closeModal();
    await loadTransactions();
  };

  const handleDelete = async (transaction: Transaction) => {
    const label = transaction.type === "income" ? "收入" : "支出";
    if (!window.confirm(`确定删除这笔${label}记录吗？`)) return;
    const response = await fetch(`/api/transactions/${transaction.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      window.alert("删除失败，请重试");
      return;
    }
    await loadTransactions();
  };

  const handleSaveBudget = async (amount: number) => {
    const response = await fetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, amount }),
    });
    if (!response.ok) {
      window.alert("预算保存失败，请重试");
      return;
    }
    setBudget(amount);
    setBudgetModalOpen(false);
  };

  const handleClearBudget = async () => {
    const response = await fetch(`/api/budget?month=${month}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      window.alert("清除失败，请重试");
      return;
    }
    setBudget(null);
    setBudgetModalOpen(false);
  };

  const exportCsv = () => {
    const rows = [
      ["日期", "类型", "分类", "金额", "备注"],
      ...filtered.map((item) => [
        item.date,
        item.type === "income" ? "收入" : "支出",
        item.category,
        item.amount.toFixed(2),
        item.note,
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
            .join(","),
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `记账-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <main className="app-shell">
      <div className="tool-header">
        <h2 className="tool-title">记账</h2>
        <div className="top-actions">
          <button
            className="btn"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="导出当前筛选结果为 CSV"
          >
            <Download size={16} />
            <span className="btn-export-label">导出 CSV</span>
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={18} />
            记一笔
          </button>
        </div>
      </div>
      <div className="month-bar">
          <div className="month-nav">
            <button
              className="btn-icon"
              onClick={() => shiftMonth(-1)}
              aria-label="上个月"
              title="上个月"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{monthLabel(month)}</span>
            <button
              className="btn-icon"
              onClick={() => shiftMonth(1)}
              aria-label="下个月"
              title="下个月"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {loadError && <span className="load-error">{loadError}</span>}
        </div>

        <SummaryCards
          income={totals.income}
          expense={totals.expense}
          balance={totals.income - totals.expense}
          budget={budget}
          onEditBudget={() => setBudgetModalOpen(true)}
        />

        <div className="dashboard-grid">
          <div className="left-col">
            <div className="panel">
              <MonthlyComparison
                transactions={monthTransactions}
                month={month}
              />
            </div>
            <div className="panel">
              <DailyChart transactions={monthTransactions} month={month} />
            </div>
            <div className="panel">
              <CategoryBreakdown transactions={monthTransactions} />
            </div>
          </div>
          <div className="panel list-panel">
            <div className="list-header">
              <div className="list-filters">
                <div className="segmented compact">
                  <button
                    className={typeFilter === "all" ? "active" : ""}
                    onClick={() => setTypeFilter("all")}
                  >
                    全部
                  </button>
                  <button
                    className={typeFilter === "expense" ? "active" : ""}
                    onClick={() => setTypeFilter("expense")}
                  >
                    支出
                  </button>
                  <button
                    className={typeFilter === "income" ? "active" : ""}
                    onClick={() => setTypeFilter("income")}
                  >
                    收入
                  </button>
                </div>
                <div className="search-wrap">
                  <Search size={15} />
                  <input
                    className="input"
                    type="search"
                    placeholder="搜索分类或备注"
                    aria-label="搜索记录"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>
              <span className="panel-hint">{filtered.length} 笔</span>
            </div>
            {loading ? (
              <div className="empty">正在加载…</div>
            ) : (
              <TransactionList
                transactions={filtered}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            )}
          </div>
        </div>
    </main>

    <TransactionModal
      open={modalOpen}
      transaction={editing}
      onClose={closeModal}
      onSave={handleSave}
    />
    <BudgetModal
      open={budgetModalOpen}
      month={month}
      initialAmount={budget}
      onClose={() => setBudgetModalOpen(false)}
      onSave={handleSaveBudget}
      onClear={handleClearBudget}
    />
    </>
  );
}
