import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLocalDateTime, toLocalDateTimeInput, toLocalDateKey } from "./date.ts";

test("parseLocalDateTime 按本地时区解析 datetime-local 的值", () => {
  const date = parseLocalDateTime("2026-05-12T20:07");
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 12);
  assert.equal(date.getHours(), 20);
  assert.equal(date.getMinutes(), 7);
  assert.equal(date.getSeconds(), 0);
  // 存库时是 UTC ISO，但归属日期按本地算还是同一天。
  assert.equal(toLocalDateKey(date.toISOString()), "2026-05-12");
});

test("parseLocalDateTime 接受带秒、前后空格", () => {
  const date = parseLocalDateTime(" 2026-01-05T09:30:45 ");
  assert.ok(date);
  assert.equal(date.getHours(), 9);
  assert.equal(date.getSeconds(), 45);
});

test("parseLocalDateTime 拒绝非法值（含会进位的日期）", () => {
  assert.equal(parseLocalDateTime(""), null);
  assert.equal(parseLocalDateTime("2026-05-12"), null);
  assert.equal(parseLocalDateTime("2026/05/12 20:00"), null);
  assert.equal(parseLocalDateTime("2026-02-30T10:00"), null);
  assert.equal(parseLocalDateTime("2026-13-01T10:00"), null);
});

test("toLocalDateTimeInput 与 parseLocalDateTime 互为逆运算", () => {
  const date = new Date(2026, 4, 12, 20, 7, 0, 0);
  assert.equal(toLocalDateTimeInput(date), "2026-05-12T20:07");
  const back = parseLocalDateTime(toLocalDateTimeInput(date));
  assert.ok(back);
  assert.equal(back.getTime(), date.getTime());
});
