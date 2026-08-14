import { NextRequest, NextResponse } from "next/server";

import { createTransaction, listTransactions } from "@/lib/db";
import { parseTransactionInput } from "@/lib/input";

export async function GET() {
  return NextResponse.json({ transactions: listTransactions() });
}

export async function POST(request: NextRequest) {
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

  const transaction = createTransaction(input);
  return NextResponse.json({ transaction }, { status: 201 });
}
