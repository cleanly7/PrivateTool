import { Pencil, PiggyBank, Target, TrendingDown, TrendingUp } from "lucide-react";

const formatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
});

export default function SummaryCards({
  income,
  expense,
  balance,
  budget,
  onEditBudget,
}: {
  income: number;
  expense: number;
  balance: number;
  budget: number | null;
  onEditBudget: () => void;
}) {
  const budgetPercent =
    budget !== null && budget > 0 ? (expense / budget) * 100 : 0;
  const budgetStatus =
    budget === null
      ? null
      : budgetPercent >= 100
        ? { text: `已超支 ${formatter.format(expense - budget)}`, tone: "over" }
        : {
            text: `剩余 ${formatter.format(budget - expense)}`,
            tone: budgetPercent >= 90 ? "warn" : "ok",
          };

  return (
    <section className="summary-grid" aria-label="月度汇总">
      <div className="summary-card">
        <span className="summary-icon income">
          <TrendingUp size={20} />
        </span>
        <div className="summary-copy">
          <div className="summary-label">本月收入</div>
          <div className="summary-value">{formatter.format(income)}</div>
        </div>
      </div>
      <div className="summary-card">
        <span className="summary-icon expense">
          <TrendingDown size={20} />
        </span>
        <div className="summary-copy">
          <div className="summary-label">本月支出</div>
          <div className="summary-value">{formatter.format(expense)}</div>
        </div>
      </div>
      <div className="summary-card">
        <span className="summary-icon balance">
          <PiggyBank size={20} />
        </span>
        <div className="summary-copy">
          <div className="summary-label">本月结余</div>
          <div className="summary-value">{formatter.format(balance)}</div>
        </div>
      </div>
      <div className="summary-card budget-card">
        <span className="summary-icon budget">
          <Target size={20} />
        </span>
        <div className="summary-copy">
          <div className="summary-label">本月预算</div>
          {budget === null ? (
            <div className="summary-value budget-empty">未设置</div>
          ) : (
            <>
              <div className="summary-value">{formatter.format(budget)}</div>
              <div className={`budget-status ${budgetStatus?.tone ?? ""}`}>
                {budgetStatus?.text}
              </div>
              <div className="budget-progress">
                <span
                  className={
                    budgetPercent >= 100
                      ? "over"
                      : budgetPercent >= 90
                        ? "warn"
                        : ""
                  }
                  style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                />
              </div>
            </>
          )}
        </div>
        <button
          className="btn-icon btn-sm"
          onClick={onEditBudget}
          aria-label="设置预算"
          title="设置预算"
        >
          <Pencil size={15} />
        </button>
      </div>
    </section>
  );
}
