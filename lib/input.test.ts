import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseDistractionsPatch,
  parseSessionInput,
  parseSessionInputResult,
} from "./input.ts";

const startedAt = new Date(2026, 2, 4, 18, 0, 0).toISOString();
const completedAt = new Date(2026, 2, 4, 18, 45, 0).toISOString();

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "focus",
    planned_minutes: 45,
    started_at: startedAt,
    completed_at: completedAt,
    note: "  Redis 分布式锁  ",
    subject: "tech",
    actual_seconds: 2700,
    title: "  黑马点评第 12 集  ",
    ...extra,
  };
}

test("专注记录照旧能解析，标题和备注都去掉两头空白", () => {
  const parsed = parseSessionInputResult(body());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.input.title, "黑马点评第 12 集");
  assert.equal(parsed.ok && parsed.input.note, "Redis 分布式锁");
  assert.equal(parsed.ok && parsed.input.subject, "tech");
  assert.deepEqual(parsed.ok && parsed.input.distractions, []);
});

test("分心跟着记录一起进来：原因去空白，缺原因当空串", () => {
  const result = parseSessionInputResult(
    body({
      distractions: [
        { at: startedAt, reason: "  手机消息  " },
        { at: completedAt },
      ],
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.input.distractions, [
    { at: startedAt, reason: "手机消息" },
    { at: completedAt, reason: "" },
  ]);
});

test("分心不合法就整条拒绝（返回「分心记录不合法」，不静默丢）", () => {
  const bad: unknown[] = [
    "nope",
    [{ at: "不是时间", reason: "坏时间点" }],
    [null],
    ["garbage"],
    [{ at: startedAt, reason: 123 }],
    [],
  ];
  for (const distractions of bad.slice(0, 5)) {
    const result = parseSessionInputResult(body({ distractions }));
    assert.equal(result.ok, false, `${JSON.stringify(distractions)} 应该被拒绝`);
    assert.equal(!result.ok && result.error, "分心记录不合法");
  }
  // 空数组是合法的「没有分心」。
  const empty = parseSessionInputResult(body({ distractions: [] }));
  assert.equal(empty.ok, true);
});

test("分心原因截断到 100 字，条数超过 200 直接拒绝", () => {
  const long = parseSessionInputResult(
    body({ distractions: [{ at: startedAt, reason: "啊".repeat(400) }] }),
  );
  assert.equal(long.ok && long.input.distractions[0].reason.length, 100);

  const many = parseSessionInputResult(
    body({
      distractions: Array.from({ length: 201 }, () => ({
        at: startedAt,
        reason: "x",
      })),
    }),
  );
  assert.equal(many.ok, false);
  assert.equal(!many.ok && many.error, "分心记录不合法");
});

test("必填字段坏掉时整条记录仍要拒绝，且报的是「记录字段不合法」", () => {
  for (const bad of [
    { kind: "nap" },
    { planned_minutes: 0 },
    { completed_at: new Date(2020, 0, 1).toISOString() },
  ]) {
    assert.equal(parseSessionInput(body(bad)), null);
    const result = parseSessionInputResult(body(bad));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error, "记录字段不合法");
  }
});

test("parseSessionInput 本身不碰分心（路由走 parseSessionInputResult）", () => {
  const parsed = parseSessionInput(
    body({ distractions: [{ at: startedAt, reason: "手机消息" }] }),
  );
  assert.deepEqual(parsed?.distractions, []);
});

test("事后改分心：没传就不动，传了才整批替换", () => {
  // 老客户端 / 只改备注的请求：字段缺省，明确表示「别动分心」。
  assert.equal(parseDistractionsPatch(undefined), undefined);
  // 显式传 null 当成清空（用户在弹窗里把条目全删了）。
  assert.deepEqual(parseDistractionsPatch(null), []);
  assert.deepEqual(parseDistractionsPatch([]), []);
  assert.deepEqual(
    parseDistractionsPatch([{ at: startedAt, reason: "  手机消息  " }]),
    [{ at: startedAt, reason: "手机消息" }],
  );
});

test("事后改分心不合法同样整条拒绝（不静默丢几条）", () => {
  for (const bad of [
    "nope",
    [{ at: "不是时间", reason: "坏时间点" }],
    [null],
    [{ at: startedAt, reason: 123 }],
    Array.from({ length: 201 }, () => ({ at: startedAt, reason: "x" })),
  ]) {
    assert.equal(parseDistractionsPatch(bad), null, `${JSON.stringify(bad)} 应该被拒绝`);
  }
});
