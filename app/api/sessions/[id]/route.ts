import { NextRequest, NextResponse } from "next/server";

import { deleteSession, getSession, updateSessionNote } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!getSession(id)) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  if (typeof record.note !== "string") {
    return NextResponse.json({ error: "备注格式不正确" }, { status: 400 });
  }

  const session = updateSessionNote(id, record.note.trim().slice(0, 200));
  if (!session) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const deleted = deleteSession(id);
  if (!deleted) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
