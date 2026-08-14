import { NextRequest, NextResponse } from "next/server";

import { createSession, listSessions } from "@/lib/db";
import { parseSessionInput } from "@/lib/input";

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const input = parseSessionInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "记录字段不合法" },
      { status: 400 },
    );
  }

  const session = createSession(input);
  return NextResponse.json({ session }, { status: 201 });
}
