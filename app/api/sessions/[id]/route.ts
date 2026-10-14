import { NextRequest, NextResponse } from "next/server";

import { deleteSession, getSession, updateSession } from "@/lib/db";
import { parseDistractionsPatch } from "@/lib/input";
import { isFocusKind, isFocusSubject } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_SESSION_SECONDS = 24 * 60 * 60;
const MAX_TITLE_LENGTH = 120;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const existing = getSession(id);
  if (!existing) {
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

  // 只改备注时保持原有科目；传了 subject 才覆盖（非专注记录始终为空）。
  const subject =
    !isFocusKind(existing.kind)
      ? ""
      : isFocusSubject(record.subject)
        ? record.subject
        : existing.subject;

  // 时长同样只在传了合法值时才覆盖：改完记录页可以用来修正记错的时长。
  let actualSeconds: number | null | undefined;
  if (record.actual_seconds === null) {
    actualSeconds = null;
  } else if (record.actual_seconds !== undefined) {
    const value = Number(record.actual_seconds);
    if (!Number.isInteger(value) || value <= 0 || value > MAX_SESSION_SECONDS) {
      return NextResponse.json({ error: "时长格式不正确" }, { status: 400 });
    }
    actualSeconds = value;
  }

  const title =
    typeof record.title === "string"
      ? record.title.trim().slice(0, MAX_TITLE_LENGTH)
      : undefined;

  // 事后补原因 / 删掉记错的那条分心：没传就不动，传了必须整批合法
  // （和创建时同一个校验、同一句报错），免得用户改完发现少了几条。
  const distractions = parseDistractionsPatch(record.distractions);
  if (distractions === null) {
    return NextResponse.json({ error: "分心记录不合法" }, { status: 400 });
  }

  const session = updateSession(id, {
    note: record.note.trim().slice(0, 200),
    subject,
    actual_seconds: actualSeconds,
    title,
    distractions: isFocusKind(existing.kind) ? distractions : undefined,
  });
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
