/**
 * B1 手动补录：忘开计时器时事后把这段补上。这是纯校验/换算，放在 lib/ 里
 * 是为了能被 `node --test` 直接覆盖（弹窗只负责收集输入和显示错误）。
 *
 * 时间口径（规格 R5 + B1 第 4 条）：`datetime-local` 给的是**本地时间字符串**，
 * 必须先按本地时区解析（`parseLocalDateTime`），再转成 UTC ISO 存库；归属日期
 * 由统计层的本地函数按 `started_at` 判断，所以跨零点的那段算在开始那天。
 */
import { parseLocalDateTime } from "./date.ts";

/** 弹窗里时长的默认值。 */
export const BACKFILL_DEFAULT_MINUTES = 60;

/** 备注长度上限（与记录页编辑弹窗保持一致）。 */
export const MAX_BACKFILL_NOTE_LENGTH = 200;

export type BackfillCheck =
  | {
      ok: true;
      /** UTC ISO，落库用。 */
      startedAt: string;
      /** UTC ISO = 开始 + 时长。 */
      completedAt: string;
      seconds: number;
      minutes: number;
    }
  | { ok: false; error: string };

/**
 * 校验补录表单。顺序就是用户填写的顺序：开始时间 → 时长 → 结束时间。
 *
 * 三条错误文案与规格第 10 章逐字一致；「开始时间为空/格式不对」规格没给文案，
 * 这里单独给一句，避免出现「点保存没反应」的静默失败（R6）。
 */
export function checkBackfill(
  startValue: string,
  minutesText: string,
  now: Date = new Date(),
): BackfillCheck {
  const start = parseLocalDateTime(startValue);
  if (!start) return { ok: false, error: "请填写开始时间" };
  if (start.getTime() > now.getTime()) {
    return { ok: false, error: "开始时间不能晚于现在" };
  }

  const minutes = Number(minutesText.trim());
  if (
    minutesText.trim() === "" ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 1440
  ) {
    return { ok: false, error: "时长需为 1–1440 的整数" };
  }

  const end = new Date(start.getTime() + minutes * 60_000);
  if (end.getTime() > now.getTime()) {
    return { ok: false, error: "这段的结束时间超过了现在，请检查时长" };
  }

  return {
    ok: true,
    startedAt: start.toISOString(),
    completedAt: end.toISOString(),
    seconds: minutes * 60,
    minutes,
  };
}
