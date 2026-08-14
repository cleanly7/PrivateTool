import { Pencil, Trash2 } from "lucide-react";

import { CategoryIcon, categoryColor } from "./CategoryIcon";
import type { Transaction } from "@/lib/types";

const formatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function TransactionList({
  transactions,
  onEdit,
  onDelete,
}: {
  transactions: Transaction[];
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  if (transactions.length === 0) {
    return <div className="empty">本月还没有记录</div>;
  }

  return (
    <div className="tx-list">
      {transactions.map((transaction) => (
        <div className="tx-item" key={transaction.id}>
          <span
            className="cat-icon"
            style={{
              background: `${categoryColor(transaction.category)}1a`,
              color: categoryColor(transaction.category),
            }}
          >
            <CategoryIcon name={transaction.category} />
          </span>
          <div className="tx-main">
            <div className="tx-title">
              {transaction.category}
              {transaction.note && (
                <span className="tx-note"> · {transaction.note}</span>
              )}
            </div>
            <div className="tx-date">{transaction.date}</div>
          </div>
          <div className={`tx-amount ${transaction.type}`}>
            {transaction.type === "income" ? "+" : "-"}
            {formatter.format(transaction.amount)}
          </div>
          <div className="tx-actions">
            <button
              className="btn-icon btn-sm"
              onClick={() => onEdit(transaction)}
              aria-label="编辑这笔记录"
              title="编辑"
            >
              <Pencil size={15} />
            </button>
            <button
              className="btn-icon btn-sm"
              onClick={() => onDelete(transaction)}
              aria-label="删除这笔记录"
              title="删除"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
