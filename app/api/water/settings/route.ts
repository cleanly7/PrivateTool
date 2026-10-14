import { NextRequest, NextResponse } from "next/server";

import { readWaterSettings, setSetting } from "@/lib/db";
import { parseWaterSettings } from "@/lib/input";

export async function GET() {
  return NextResponse.json({ settings: readWaterSettings() });
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const settings = parseWaterSettings(body);
  if (!settings) {
    return NextResponse.json(
      { error: "配置不合法：请检查目标杯数、杯容量、提醒间隔和活跃时段" },
      { status: 400 },
    );
  }

  setSetting("water", JSON.stringify(settings));
  return NextResponse.json({ settings });
}
