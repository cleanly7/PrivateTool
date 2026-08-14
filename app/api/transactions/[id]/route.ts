import { NextRequest, NextResponse } from "next/server";

import {
  deleteTransaction,
  getTransaction,
  updateTransaction,
} from "@/lib/db";
import { parseTransactionInput } from "@/lib/input";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!getTransaction(id)) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const input = parseTransactionInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "请填写有效的类型、金额、分类和日期" },
      { status: 400 },
    );
  }

  const transaction = updateTransaction(id, input);
  if (!transaction) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ transaction });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const deleted = deleteTransaction(id);
  if (!deleted) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
