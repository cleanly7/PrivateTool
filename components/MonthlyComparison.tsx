import { useMemo } from "react";

import type { Transaction } from "@/lib/types";

const formatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
});

export default function MonthlyComparison({
  transactions,
  month,
}: {
  transactions: Transaction[];
  month: string;
}) {
  const months = useMemo(() => {
    const [year, monthNum] = month.split("-").map(Number);
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(year, monthNum - 6 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const total = transactions
        .filter(
          (item) => item.type === "expense" && item.date.startsWith(key),
        )
        .reduce((sum, item) => sum + item.amount, 0);
      return {
        key,
        label: `${date.getMonth() + 1}月`,
        total,
      };
    });
  }, [transactions, month]);

  const max = Math.max(...months.map((item) => item.total), 0);
  const current = months[months.length - 1];
  const previous = months[months.length - 2];

  let deltaLabel = "";
  if (previous.total > 0) {
    const percent = ((current.total - previous.total) / previous.total) * 100;
    deltaLabel = `较上月 ${percent >= 0 ? "+" : ""}${percent.toFixed(0)}%`;
  } else if (previous.total === 0 && current.total > 0) {
    deltaLabel = "本月新增支出";
  }

  return (
    <div>
      <div className="panel-title">
        <span>近 6 个月支出</span>
        {deltaLabel && (
          <span
            className={`delta ${
              current.total > previous.total ? "up" : "down"
            }`}
          >
            {deltaLabel}
          </span>
        )}
      </div>
      {max === 0 ? (
        <div className="empty">暂无支出数据</div>
      ) : (
        <div className="bar-chart month-chart">
          {months.map((item) => (
            <div
              className="bar-wrap"
              key={item.key}
              title={`${item.key} 支出 ${item.total.toFixed(2)} 元`}
            >
              <div
                className="bar month-bar"
                style={{
                  height: item.total
                    ? `${Math.max((item.total / max) * 100, 4)}%`
                    : "2px",
                }}
              />
              <span className="bar-day">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
