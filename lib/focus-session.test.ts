/**
 * 保存这一段专注的公共部分（R8：只有保存成功才清本地草稿）。
 *
 * 重点钉住 `pendingToPayload` 的**往返腿**：`PendingSave`（本地草稿里的形状）→
 * `SessionSavePayload`（发给 POST /api/sessions 的形状）。这条路径上丢掉 title
 * 或 distractions 不会报错，只是用户的分心记录和标题无声消失——所以逐字段断言。
 *
 * node --test 里没有 localStorage 也没有真的想发请求，两样都用最小替身顶上，
 * 每个用例结束立刻还原，免得污染同一进程里其它测试。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingRecord,
  pendingToPayload,
  readPendingRecord,
  saveSessionRecord,
  writePendingRecord,
} from "./focus-session.ts";
import { MAX_SESSION_TITLE_LENGTH, type DistractionInput } from "./types.ts";
import type { PendingSave } from "./focus-timer.ts";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const STARTED = "2026-10-14T21:05:00.000Z";
const COMPLETED = "2026-10-14T21:50:00.000Z";

const entries: DistractionInput[] = [
  { at: "2026-10-14T21:20:00.000Z", reason: "微信" },
  { at: "2026-10-14T21:35:00.000Z", reason: "" },
];

function pending(over: Partial<PendingSave> = {}): PendingSave {
  return {
    startedAt: STARTED,
    completedAt: COMPLETED,
    seconds: 2700,
    subject: "tech",
    note: "缓存穿透的三层防护",
    title: "黑马点评 第 12 集",
    distractions: entries,
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * pendingToPayload：草稿 → 请求体
 * ------------------------------------------------------------------ */

test("pendingToPayload 原样带过 title / distractions / 时长（不静默丢字段）", () => {
  const payload = pendingToPayload("focus", pending());
  assert.equal(payload.kind, "focus");
  assert.equal(payload.startedAt, STARTED);
  assert.equal(payload.completedAt, COMPLETED);
  assert.equal(payload.seconds, 2700);
  assert.equal(payload.note, "缓存穿透的三层防护");
  assert.equal(payload.subject, "tech");
  assert.equal(payload.title, "黑马点评 第 12 集");
  assert.deepEqual(payload.distractions, entries);
});

test("pendingToPayload 认草稿里的脏科目：非法值退回「未分类」空串", () => {
  // 草稿是本地存储来的，用户手改 / 老版本写坏都可能；这里不能把脏值当科目发出去。
  const payload = pendingToPayload(
    "focus",
    pending({ subject: "hacking" as PendingSave["subject"] }),
  );
  assert.equal(payload.subject, "");
});

test("pendingToPayload 是往返腿：parsePendingSave 读回来的东西还原得一模一样", async () => {
  const { parsePendingSave } = await import("./focus-timer.ts");
  const original = pending();
  const roundTripped = parsePendingSave(JSON.parse(JSON.stringify(original)));
  assert.notEqual(roundTripped, null);
  if (!roundTripped) return;
  assert.deepEqual(pendingToPayload("focus", roundTripped), pendingToPayload("focus", original));
});

test("倒计时（pomodoro）也走同一条路，kind 跟着调用方走", () => {
  const payload = pendingToPayload("pomodoro", pending({ subject: "", title: "" }));
  assert.equal(payload.kind, "pomodoro");
  assert.equal(payload.subject, "");
  assert.equal(payload.title, "");
});

/* ------------------------------------------------------------------ *
 * 保存失败留下的那条记录：读 / 写 / 清
 * ------------------------------------------------------------------ */

function withStorage<T>(run: (store: Map<string, string>) => T): T {
  const globalScope = globalThis as { localStorage?: unknown; window?: unknown };
  const originalStorage = globalScope.localStorage;
  const originalWindow = globalScope.window;
  const store = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
  globalScope.localStorage = storage;
  // 组件里这些函数跑在浏览器里，localStorage 挂在 window 上；这里给个同样的引用。
  globalScope.window = { localStorage: storage };
  try {
    return run(store);
  } finally {
    globalScope.localStorage = originalStorage;
    globalScope.window = originalWindow;
  }
}

test("保存失败的记录写进去能原样读回来（重试时内容不缩水）", () => {
  withStorage(() => {
    const record = pending({ distractions: [] });
    writePendingRecord("focus", record);
    assert.deepEqual(readPendingRecord("focus"), record);
  });
});

test("两种 kind 各存各的：清掉专注的待重试记录，不会碰到番茄钟那条", () => {
  withStorage((store) => {
    writePendingRecord("focus", pending({ title: "专注的" }));
    writePendingRecord("pomodoro", pending({ title: "番茄的" }));
    clearPendingRecord("focus");
    assert.equal(readPendingRecord("focus"), null);
    assert.equal(readPendingRecord("pomodoro")?.title, "番茄的");
    assert.equal(store.get("focus-timer-pomodoro-pending") !== undefined, true);
  });
});

test("待重试记录是脏数据时读回 null，不把坏数据当记录用", () => {
  withStorage((store) => {
    store.set("focus-timer-focus-pending", "这不是 JSON");
    assert.equal(readPendingRecord("focus"), null);
    store.set("focus-timer-focus-pending", JSON.stringify({ seconds: -1 }));
    assert.equal(readPendingRecord("focus"), null);
  });
});

/* ------------------------------------------------------------------ *
 * saveSessionRecord：请求体形状 + 失败一定带得回原因
 * ------------------------------------------------------------------ */

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function withFetch<T>(
  respond: () => Promise<Response>,
  run: (captured: Captured) => Promise<T>,
): Promise<T> {
  const globalScope = globalThis as { fetch?: unknown };
  const original = globalScope.fetch;
  const captured: Captured = { url: "", init: {}, body: {} };
  globalScope.fetch = async (url: unknown, init: RequestInit = {}) => {
    captured.url = String(url);
    captured.init = init;
    captured.body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return respond();
  };
  return run(captured).finally(() => {
    globalScope.fetch = original;
  });
}

test("saveSessionRecord 把实际秒数折成 planned_minutes 发出去（兼容字段）", async () => {
  await withFetch(
    async () => new Response("{}", { status: 201 }),
    async (captured) => {
      const result = await saveSessionRecord(pendingToPayload("focus", pending()));
      assert.deepEqual(result, { ok: true });
      assert.equal(captured.url, "/api/sessions");
      assert.equal(captured.init.method, "POST");
      assert.equal(captured.body.actual_seconds, 2700);
      assert.equal(captured.body.planned_minutes, 45);
      assert.equal(captured.body.kind, "focus");
      assert.deepEqual(captured.body.distractions, entries);
    },
  );
});

test("不足 1 分钟的时长也要落成至少 1 秒 / 1 分钟，不能变成 0", async () => {
  await withFetch(
    async () => new Response("{}", { status: 201 }),
    async (captured) => {
      await saveSessionRecord(pendingToPayload("focus", pending({ seconds: 12 })));
      assert.equal(captured.body.actual_seconds, 12);
      assert.equal(captured.body.planned_minutes, 1);
    },
  );
});

test("服务端拒绝时把它的文案带出来（结束弹窗要显示给用户）", async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ error: "分心记录不合法" }), { status: 400 }),
    async () => {
      assert.deepEqual(await saveSessionRecord(pendingToPayload("focus", pending())), {
        ok: false,
        error: "分心记录不合法",
      });
    },
  );
});

test("服务端没给文案时退回状态码，不显示 undefined", async () => {
  await withFetch(
    async () => new Response("oops", { status: 500 }),
    async () => {
      assert.deepEqual(await saveSessionRecord(pendingToPayload("focus", pending())), {
        ok: false,
        error: "服务返回 500",
      });
    },
  );
});

test("网络异常不抛出去：返回 ok:false 让弹窗能重试（R8 / R6）", async () => {
  await withFetch(
    async () => {
      throw new Error("网络断了");
    },
    async () => {
      assert.deepEqual(await saveSessionRecord(pendingToPayload("focus", pending())), {
        ok: false,
        error: "网络断了",
      });
    },
  );
});

test("超长标题在保存路径上被裁到上限（草稿被手改过也撑不爆接口）", async () => {
  const { parsePendingSave } = await import("./focus-timer.ts");
  const long = "标".repeat(MAX_SESSION_TITLE_LENGTH + 50);
  // 草稿读进来那一层就裁掉：parsePendingSave 是这条路上的守门人。
  const parsed = parsePendingSave(JSON.parse(JSON.stringify(pending({ title: long }))));
  assert.notEqual(parsed, null);
  if (!parsed) return;
  assert.equal(parsed.title.length, MAX_SESSION_TITLE_LENGTH);

  await withFetch(
    async () => new Response("{}", { status: 201 }),
    async (captured) => {
      await saveSessionRecord(pendingToPayload("focus", parsed));
      assert.equal(String(captured.body.title).length, MAX_SESSION_TITLE_LENGTH);
    },
  );
});
