import { NextRequest, NextResponse } from "next/server";

import {
  createWaterIntake,
  listWaterIntake,
  readWaterSettings,
} from "@/lib/db";
import { localToday, toLocalDateKey } from "@/lib/date";
import type { WaterIntake } from "@/lib/types";

function todayIntakes(all: WaterIntake[]): WaterIntake[] {
  const todayKey = localToday();
  return all.filter((item) => toLocalDateKey(item.logged_at) === todayKey);
}

export async function GET(request: NextRequest) {
  const all = listWaterIntake();
  // 记录页：拉取全量记录按天分组
  if (request.nextUrl.searchParams.get("all") === "1") {
    return NextResponse.json({ records: all });
  }
  const today = todayIntakes(all);
  const totalMl = today.reduce((sum, item) => sum + item.amount_ml, 0);
  return NextResponse.json({ today, total_ml: totalMl, settings: readWaterSettings() });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const cupsRaw = record.cups;
  const cups =
    typeof cupsRaw === "number"
      ? cupsRaw
      : typeof cupsRaw === "string"
        ? Number(cupsRaw)
        : NaN;
  if (!Number.isInteger(cups) || cups < 1 || cups > 10) {
    return NextResponse.json(
      { error: "杯数需为 1 到 10 的整数" },
      { status: 400 },
    );
  }

  const amountMl = cups * readWaterSettings().cup_ml;
  createWaterIntake(amountMl);

  const all = listWaterIntake();
  const today = todayIntakes(all);
  const totalMl = today.reduce((sum, item) => sum + item.amount_ml, 0);
  return NextResponse.json({ today, total_ml: totalMl }, { status: 201 });
}
