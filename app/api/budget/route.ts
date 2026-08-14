import { NextRequest, NextResponse } from "next/server";

import { deleteBudget, getBudget, setBudget } from "@/lib/db";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month");
  if (!month || !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });
  }
  return NextResponse.json({ amount: getBudget(month) });
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const month = typeof record.month === "string" ? record.month : "";
  const amount =
    typeof record.amount === "string" ? Number(record.amount) : record.amount;

  if (
    !MONTH_PATTERN.test(month) ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return NextResponse.json(
      { error: "请输入有效的月份和预算金额" },
      { status: 400 },
    );
  }

  setBudget(month, amount);
  return NextResponse.json({ amount });
}

export async function DELETE(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month");
  if (!month || !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });
  }
  deleteBudget(month);
  return NextResponse.json({ ok: true });
}
