import { NextRequest, NextResponse } from "next/server";

import { createSession, listSessions } from "@/lib/db";
import { parseSessionInputResult } from "@/lib/input";

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

  const parsed = parseSessionInputResult(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const session = createSession(parsed.input);
  return NextResponse.json({ session }, { status: 201 });
}
