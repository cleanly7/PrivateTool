import type { Transaction } from "@/lib/types";

export default function DailyChart({
  transactions,
  month,
}: {
  transactions: Transaction[];
  month: string;
}) {
  const expenses = transactions.filter((item) => item.type === "expense");
  const [year, monthIndex] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();

  const daily = Array.from({ length: daysInMonth }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const total = expenses
      .filter((item) => item.date === date)
      .reduce((sum, item) => sum + item.amount, 0);
    return { date, total };
  });
  const max = Math.max(...daily.map((day) => day.total), 0);

  return (
    <div>
      <div className="panel-title">
        <span>每日支出</span>
        <span className="panel-hint">{month}</span>
      </div>
      {max === 0 ? (
        <div className="empty">本月还没有支出记录</div>
      ) : (
        <div className="bar-chart">
          {daily.map((day, index) => (
            <div
              className="bar-wrap"
              key={day.date}
              title={`${day.date} 支出 ${day.total.toFixed(2)} 元`}
            >
              <div
                className="bar"
                style={{
                  height: day.total
                    ? `${Math.max((day.total / max) * 100, 4)}%`
                    : "2px",
                }}
              />
              {(index % 5 === 0 || index === daysInMonth - 1) && (
                <span className="bar-day">{index + 1}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
