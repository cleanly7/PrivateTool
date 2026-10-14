import { test } from "node:test";
import assert from "node:assert/strict";

import { checkBackfill } from "./backfill.ts";
import { toLocalDateKey } from "./date.ts";

/** 固定「现在」，让断言跟运行时刻无关；用本地构造避免时区漂移。 */
const NOW = new Date(2026, 4, 14, 12, 0, 0, 0);

test("合法补录：昨天 20:00 + 90 分钟 → 起止都落在昨天，归属也是昨天", () => {
  const result = checkBackfill("2026-05-13T20:00", "90", NOW);
  assert.ok(result.ok);
  assert.equal(result.seconds, 5400);
  assert.equal(result.minutes, 90);
  assert.equal(toLocalDateKey(result.startedAt), "2026-05-13");
  assert.equal(toLocalDateKey(result.completedAt), "2026-05-13");
  assert.equal(new Date(result.startedAt).getHours(), 20);
  assert.equal(new Date(result.completedAt).getHours(), 21);
  // 存库的是 UTC ISO
  assert.match(result.startedAt, /Z$/);
});

test("跨零点：23:40 + 100 分钟 → 结束在第二天，归属仍是开始那天", () => {
  const result = checkBackfill("2026-05-13T23:40", "100", new Date(2026, 4, 14, 12, 0));
  assert.ok(result.ok);
  assert.equal(toLocalDateKey(result.startedAt), "2026-05-13");
  assert.equal(toLocalDateKey(result.completedAt), "2026-05-14");
  assert.equal(new Date(result.completedAt).getHours(), 1);
  assert.equal(new Date(result.completedAt).getMinutes(), 20);
});

test("开始时间晚于现在 → 就地报错", () => {
  const result = checkBackfill("2026-05-14T12:01", "30", NOW);
  assert.deepEqual(result, { ok: false, error: "开始时间不能晚于现在" });
});

test("结束时间超过现在 → 就地报错", () => {
  const result = checkBackfill("2026-05-14T11:30", "60", NOW);
  assert.deepEqual(result, {
    ok: false,
    error: "这段的结束时间超过了现在，请检查时长",
  });
});

test("开始时间等于现在、时长为 1 分钟之内是允许的", () => {
  const result = checkBackfill("2026-05-14T12:00", "1", new Date(2026, 4, 14, 12, 1));
  assert.ok(result.ok);
  const result2 = checkBackfill("2026-05-14T12:00", "1", new Date(2026, 4, 14, 12, 0, 30));
  assert.deepEqual(result2, {
    ok: false,
    error: "这段的结束时间超过了现在，请检查时长",
  });
});

test("时长必须是 1–1440 的整数", () => {
  for (const value of ["", "0", "-5", "12.5", "1441", "abc", "  "]) {
    assert.deepEqual(
      checkBackfill("2026-05-13T20:00", value, NOW),
      { ok: false, error: "时长需为 1–1440 的整数" },
      `时长 ${JSON.stringify(value)} 应该被拒绝`,
    );
  }
  const ok = checkBackfill("2026-05-10T08:00", "1440", NOW);
  assert.ok(ok.ok);
});

test("开始时间非法或为空 → 给出可见错误，不静默", () => {
  for (const value of ["", "2026-05-13", "2026-02-30T10:00"]) {
    assert.deepEqual(
      checkBackfill(value, "60", NOW),
      { ok: false, error: "请填写开始时间" },
      `开始时间 ${JSON.stringify(value)} 应该被拒绝`,
    );
  }
});

test("可以补录很久以前的（规格 Q3：只限制不晚于现在）", () => {
  const result = checkBackfill("2026-01-05T09:00", "45", NOW);
  assert.ok(result.ok);
  assert.equal(toLocalDateKey(result.startedAt), "2026-01-05");
  assert.equal(result.seconds, 45 * 60);
});
