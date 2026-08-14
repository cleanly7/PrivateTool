import { CategoryIcon, categoryColor } from "./CategoryIcon";
import type { Transaction } from "@/lib/types";

const formatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
});

export default function CategoryBreakdown({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const expenses = transactions.filter((item) => item.type === "expense");
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const groups = new Map<string, number>();
  for (const item of expenses) {
    groups.set(item.category, (groups.get(item.category) ?? 0) + item.amount);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="panel-title">
        <span>支出分类</span>
        <span className="panel-hint">共 {expenses.length} 笔</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">暂无支出数据</div>
      ) : (
        rows.map(([name, amount]) => (
          <div className="category-row" key={name}>
            <span
              className="cat-icon"
              style={{
                background: `${categoryColor(name)}1a`,
                color: categoryColor(name),
              }}
            >
              <CategoryIcon name={name} />
            </span>
            <div className="cat-meta">
              <div className="cat-line">
                <span>{name}</span>
                <strong>{formatter.format(amount)}</strong>
              </div>
              <div className="progress">
                <span
                  style={{
                    width: `${(amount / total) * 100}%`,
                    background: categoryColor(name),
                  }}
                />
              </div>
            </div>
            <span className="cat-percent">
              {Math.round((amount / total) * 100)}%
            </span>
          </div>
        ))
      )}
    </div>
  );
}
