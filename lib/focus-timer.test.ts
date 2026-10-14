import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COUNT_UP_DRAFT_VERSION,
  countUpFromStoredTimer,
  elapsedMs,
  FOCUS_MARK_MS,
  focusMarks,
  formatClock,
  formatElapsed,
  isImplausiblyLong,
  MAX_SESSION_MS,
  minutesForSave,
  msToNextMark,
  parseStoredDistractions,
  readCountUpDraft,
  resolveStoredTimer,
  type CountUpDraft,
  type PendingSave,
  type StoredTimer,
} from "./focus-timer.ts";

const now = 1_800_000_000_000;

function runningStored(remainingMs: number): StoredTimer {
  return {
    status: "running",
    endAt: now + remainingMs,
    plannedMinutes: 45,
    startedAt: new Date(now - 45 * 60_000).toISOString(),
  };
}

test("running timer restores with SECONDS as the resume duration, not milliseconds", () => {
  // A freshly started 45-minute timer has ~45*60*1000 ms remaining.
  const restored = resolveStoredTimer(runningStored(45 * 60_000), now);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.status, "running");
  assert.equal(restored.remainingSeconds, 45 * 60);
  // Regression for the "换标签时间突然变大" bug: the old code passed
  // milliseconds here while `begin()` interprets the value as seconds,
  // inflating the timer 1000x on every remount (tab switch).
  assert.equal(restored.resumeSeconds, 45 * 60);
});

test("running timer that already expired resolves to finished", () => {
  const restored = resolveStoredTimer(runningStored(-1_000), now);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.status, "finished");
  assert.ok(restored.completedAtIso.startsWith("20"));
});

test("corrupted running endAt (ms-vs-seconds inflation) is dropped", () => {
  // What the buggy versions wrote back to localStorage: a 45-min timer
  // (~2.7e6 ms remaining) compounded to ~2.7e15 ms after a few remounts.
  const inflatedMs = 45 * 60 * 1000 * 1000 ** 3;
  const restored = resolveStoredTimer(runningStored(inflatedMs), now);
  assert.equal(restored.ok, false);
});

test("paused timer restores with its remaining seconds", () => {
  const stored: StoredTimer = {
    status: "paused",
    remainingSeconds: 42 * 60,
    plannedMinutes: 45,
    startedAt: new Date(now - 3 * 60_000).toISOString(),
  };
  const restored = resolveStoredTimer(stored, now);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.status, "paused");
  assert.equal(restored.remainingSeconds, 42 * 60);
});

test("corrupted paused remainingSeconds is dropped", () => {
  const stored: StoredTimer = {
    status: "paused",
    remainingSeconds: 4.5e13 * 60, // inflated by the old bug
    plannedMinutes: 45,
    startedAt: new Date(now - 3 * 60_000).toISOString(),
  };
  assert.equal(resolveStoredTimer(stored, now).ok, false);
});

test("missing plannedMinutes or non-object input is invalid", () => {
  assert.equal(resolveStoredTimer(null, now).ok, false);
  assert.equal(resolveStoredTimer(undefined, now).ok, false);
  assert.equal(
    resolveStoredTimer({ status: "running", endAt: now + 1_000 }, now).ok,
    false,
  );
  assert.equal(resolveStoredTimer("garbage", now).ok, false);
});

// ---------- 正计时（专注时间） ----------

test("正计时时钟按 HH:MM:SS 显示", () => {
  assert.equal(formatClock(0), "00:00:00");
  assert.equal(formatClock(45 * 60_000), "00:45:00");
  assert.equal(formatClock(1 * 3_600_000 + 12 * 60_000 + 3_000), "01:12:03");
  // 少算的时间不能显示成负数
  assert.equal(formatClock(-5_000), "00:00:00");
});

test("说话用的时长文案", () => {
  assert.equal(formatElapsed(38_000), "38 秒");
  assert.equal(formatElapsed(42 * 60_000), "42 分钟");
  assert.equal(formatElapsed(72 * 60_000), "1 小时 12 分");
  assert.equal(formatElapsed(120 * 60_000), "2 小时");
});

test("暂停的时间不算进专注时长（墙上时钟，不看 setInterval 累加）", () => {
  const running: CountUpDraft = {
    version: COUNT_UP_DRAFT_VERSION,
    status: "running",
    startedAt: new Date(now - 30 * 60_000).toISOString(),
    runStartedAt: now - 10 * 60_000,
    accumulatedMs: 20 * 60_000,
    subject: "tech",
    note: "",
    title: "",
    distractions: [],
    pending: null,
    pendingFailed: false,
  };
  // 之前累计 20 分钟 + 这一段跑了 10 分钟
  assert.equal(elapsedMs(running, now), 30 * 60_000);

  // 暂停：runStartedAt 归零，之后再久也不涨
  const paused = { ...running, status: "paused" as const, runStartedAt: null };
  assert.equal(elapsedMs(paused, now), 20 * 60_000);
  assert.equal(elapsedMs(paused, now + 60 * 60_000), 20 * 60_000);
});

test("正计时草稿能安全读回，坏数据一律丢掉", () => {
  const draft = {
    version: COUNT_UP_DRAFT_VERSION,
    status: "running",
    startedAt: new Date(now).toISOString(),
    runStartedAt: now,
    accumulatedMs: 60_000,
    subject: "japanese",
    note: "N3 语法",
    title: "N3 语法 てしまう",
    distractions: [{ at: new Date(now - 5 * 60_000).toISOString(), reason: "手机消息" }],
    pending: null,
    pendingFailed: false,
  };
  const read = readCountUpDraft(draft);
  assert.equal(read?.subject, "japanese");
  assert.equal(read?.note, "N3 语法");
  assert.equal(read?.accumulatedMs, 60_000);

  // 老版本草稿（倒计时用的那份）版本号不同，交给迁移逻辑处理
  assert.equal(readCountUpDraft({ ...draft, version: 1 }), null);
  assert.equal(readCountUpDraft({ ...draft, status: "weird" }), null);
  assert.equal(readCountUpDraft({ ...draft, accumulatedMs: -1 }), null);
  assert.equal(readCountUpDraft({ ...draft, runStartedAt: Number.NaN }), null);
  assert.equal(readCountUpDraft({ ...draft, startedAt: "不是时间" }), null);
  assert.equal(readCountUpDraft("garbage"), null);
  assert.equal(readCountUpDraft(null), null);
});

test("没保存成功的那条记录会跟着草稿一起留下", () => {
  const pending: PendingSave = {
    startedAt: new Date(now - 45 * 60_000).toISOString(),
    completedAt: new Date(now).toISOString(),
    seconds: 45 * 60,
    subject: "tech",
    note: "Redis 分布式锁",
    title: "黑马点评第 12 集",
    distractions: [],
  };
  const draft = {
    version: COUNT_UP_DRAFT_VERSION,
    status: "paused",
    startedAt: pending.startedAt,
    runStartedAt: null,
    accumulatedMs: 45 * 60_000,
    subject: "tech",
    note: pending.note,
    title: pending.title,
    distractions: pending.distractions,
    pending,
    pendingFailed: true,
  };
  const read = readCountUpDraft(draft);
  assert.equal(read?.pending?.seconds, 45 * 60);
  assert.equal(read?.pending?.note, "Redis 分布式锁");

  // 时长离谱（超过 24 小时）的待保存记录不能信
  assert.equal(
    readCountUpDraft({
      ...draft,
      pending: { ...pending, seconds: 24 * 60 * 60 + 1 },
    })?.pending,
    null,
  );
  assert.equal(
    readCountUpDraft({ ...draft, pending: { ...pending, seconds: 0 } })?.pending,
    null,
  );
});

test("保存用的分钟数至少是 1 分钟", () => {
  assert.equal(minutesForSave(0), 1);
  assert.equal(minutesForSave(30), 1);
  assert.equal(minutesForSave(45 * 60), 45);
  assert.equal(minutesForSave(89), 1);
  assert.equal(minutesForSave(150), 3);
});

test("忘记停止：超过 24 小时的记录会被标成可疑", () => {
  assert.equal(isImplausiblyLong(60 * 60_000), false);
  assert.equal(isImplausiblyLong(MAX_SESSION_MS), false);
  assert.equal(isImplausiblyLong(MAX_SESSION_MS + 1), true);
});

test("升级时把老的倒计时草稿翻译成正计时草稿", () => {
  // 60 分钟的计划跑了 15 分钟就刷新页面：老草稿里剩 45 分钟
  const upgraded = countUpFromStoredTimer(
    {
      status: "running",
      endAt: now + 45 * 60_000,
      plannedMinutes: 60,
      startedAt: new Date(now - 15 * 60_000).toISOString(),
      subject: "japanese",
      note: "N3 听力",
    },
    now,
  );
  assert.equal(upgraded?.status, "running");
  assert.equal(upgraded?.accumulatedMs, 15 * 60_000);
  assert.equal(upgraded?.runStartedAt, now);
  assert.equal(upgraded?.subject, "japanese");
  assert.equal(upgraded?.note, "N3 听力");
  assert.equal(elapsedMs(upgraded!, now + 5 * 60_000), 20 * 60_000);

  // 已经跑完的倒计时：换成暂停、已累计满，由人决定存不存
  const finished = countUpFromStoredTimer(
    { status: "running", endAt: now - 1_000, plannedMinutes: 45, startedAt: new Date(now - 45 * 60_000).toISOString() },
    now,
  );
  assert.equal(finished?.status, "paused");
  assert.equal(finished?.accumulatedMs, 45 * 60_000);

  // 坏草稿翻译不出来
  assert.equal(countUpFromStoredTimer("garbage", now), null);
});

test("45 分钟刻度：档位和到下一档的剩余时间", () => {
  assert.equal(FOCUS_MARK_MS, 45 * 60_000);
  assert.equal(focusMarks(0), 0);
  assert.equal(focusMarks(44 * 60_000), 0);
  assert.equal(focusMarks(45 * 60_000), 1);
  assert.equal(focusMarks(91 * 60_000), 2);
  // 正好在档位上时，下一档是一整档之后
  assert.equal(msToNextMark(45 * 60_000), FOCUS_MARK_MS);
  assert.equal(msToNextMark(45 * 60_000 + 60_000), 44 * 60_000);
  assert.equal(msToNextMark(0), FOCUS_MARK_MS);
  // 负数（时钟出问题）不能算出负的剩余时间
  assert.equal(focusMarks(-1), 0);
});

test("草稿里的分心：坏条目丢掉，长原因截断，条数封顶", () => {
  const at = new Date(now).toISOString();
  assert.deepEqual(parseStoredDistractions("nope"), []);
  assert.deepEqual(parseStoredDistractions(null), []);
  assert.deepEqual(
    parseStoredDistractions([
      { at, reason: "手机消息" },
      { at: "不是时间", reason: "丢掉" },
      "garbage",
      null,
      { reason: "没有时间点" },
      { at },
    ]),
    [
      { at, reason: "手机消息" },
      { at, reason: "" },
    ],
  );

  const long = parseStoredDistractions([{ at, reason: "啊".repeat(500) }]);
  assert.equal(long[0].reason.length, 100);

  // 草稿里最多留 200 条（跟服务端 MAX_DISTRACTIONS 对齐）。
  const many = parseStoredDistractions(
    Array.from({ length: 300 }, () => ({ at, reason: "x" })),
  );
  assert.equal(many.length, 200);
});

test("v2 草稿仍能读回来（那时还没有大标题和分心）", () => {
  const legacy = {
    version: 2,
    status: "paused",
    startedAt: new Date(now).toISOString(),
    runStartedAt: null,
    accumulatedMs: 10 * 60_000,
    subject: "tech",
    note: "",
    pending: null,
  };
  const read = readCountUpDraft(legacy);
  assert.equal(read?.version, COUNT_UP_DRAFT_VERSION);
  assert.equal(read?.accumulatedMs, 10 * 60_000);
  assert.equal(read?.title, "");
  assert.deepEqual(read?.distractions, []);
  assert.equal(read?.pendingFailed, false);
});

test("「保存失败」和「弹窗还开着」要分得清", () => {
  const startedAt = new Date(now - 30 * 60_000).toISOString();
  const pending: PendingSave = {
    startedAt,
    completedAt: new Date(now).toISOString(),
    seconds: 30 * 60,
    subject: "tech",
    note: "缓存穿透",
    title: "黑马点评第 12 集",
    distractions: [{ at: startedAt, reason: "手机消息" }],
  };
  const base = {
    version: COUNT_UP_DRAFT_VERSION,
    status: "paused" as const,
    startedAt,
    runStartedAt: null,
    accumulatedMs: 30 * 60_000,
    subject: "tech" as const,
    note: "",
    title: pending.title,
    distractions: pending.distractions,
    pending,
    pendingFailed: false,
  };

  const stillOpen = readCountUpDraft({ ...base, pendingFailed: false });
  assert.equal(stillOpen?.pendingFailed, false);
  assert.equal(stillOpen?.pending?.title, "黑马点评第 12 集");
  assert.deepEqual(stillOpen?.pending?.distractions, pending.distractions);

  const failed = readCountUpDraft({ ...base, pendingFailed: true });
  assert.equal(failed?.pendingFailed, true);

  // 老草稿没有这个字段：按「不是失败」处理，别吓唬用户
  const { pendingFailed: _ignored, ...withoutFlag } = base;
  assert.equal(readCountUpDraft(withoutFlag)?.pendingFailed, false);
});
