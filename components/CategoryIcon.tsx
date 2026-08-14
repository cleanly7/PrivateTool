import {
  Banknote,
  BookOpen,
  Briefcase,
  Car,
  Gamepad2,
  Gift,
  Home,
  Laptop,
  MoreHorizontal,
  ShoppingBag,
  Stethoscope,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  餐饮: Utensils,
  交通: Car,
  购物: ShoppingBag,
  居住: Home,
  娱乐: Gamepad2,
  医疗: Stethoscope,
  学习: BookOpen,
  其他: MoreHorizontal,
  工资: Briefcase,
  奖金: Gift,
  理财: TrendingUp,
  兼职: Laptop,
  其他收入: Banknote,
};

const colorMap: Record<string, string> = {
  餐饮: "#d97706",
  交通: "#2563eb",
  购物: "#db2777",
  居住: "#7c3aed",
  娱乐: "#0891b2",
  医疗: "#dc2626",
  学习: "#059669",
  其他: "#64748b",
  工资: "#0e9f6e",
  奖金: "#d97706",
  理财: "#2563eb",
  兼职: "#db2777",
  其他收入: "#64748b",
};

export const expenseCategories = [
  "餐饮",
  "交通",
  "购物",
  "居住",
  "娱乐",
  "医疗",
  "学习",
  "其他",
];

export const incomeCategories = ["工资", "奖金", "理财", "兼职", "其他收入"];

export function categoryColor(name: string): string {
  return colorMap[name] ?? "#64748b";
}

export function CategoryIcon({
  name,
  size = 18,
}: {
  name: string;
  size?: number;
}) {
  const Icon = iconMap[name] ?? MoreHorizontal;
  return <Icon size={size} />;
}
