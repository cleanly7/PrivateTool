/**
 * 科目记忆（A4）：只该记住「技术学习 / 日语」，脏数据一律当没记过。
 *
 * node --test 里没有 localStorage，用最小实现顶上；写完立刻还原，
 * 免得污染同一进程里其它测试。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readSubjectMemory, writeSubjectMemory } from "./focus-prefs.ts";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const SUBJECT_MEMORY_KEY = "focus-subject-memory";

function withStorage<T>(value: string | null, run: () => T): { result: T; stored: string | null } {
  const globalScope = globalThis as { localStorage?: StorageLike };
  const original = globalScope.localStorage;
  let stored = value;
  globalScope.localStorage = {
    getItem: (key: string) => (key === SUBJECT_MEMORY_KEY ? stored : null),
    setItem: (key: string, next: string) => {
      if (key === SUBJECT_MEMORY_KEY) stored = next;
    },
    removeItem: (key: string) => {
      if (key === SUBJECT_MEMORY_KEY) stored = null;
    },
  };
  try {
    const result = run();
    return { result, stored };
  } finally {
    globalScope.localStorage = original;
  }
}

test("没记过科目时返回 null（调用方自己给默认值）", () => {
  const { result } = withStorage(null, readSubjectMemory);
  assert.equal(result, null);
});

test("写进去的科目能读回来", () => {
  const { result, stored } = withStorage(null, () => {
    writeSubjectMemory("japanese");
    return readSubjectMemory();
  });
  assert.equal(result, "japanese");
  assert.equal(stored, "japanese");
});

test("脏数据一律当没记过（不静默当成 tech）", () => {
  for (const dirty of ["hacking", "", "{}", "TECH", "null"]) {
    const { result } = withStorage(dirty, readSubjectMemory);
    assert.equal(result, null, `${dirty} 应该被当成没记过`);
  }
});

test("localStorage 抛错时读回 null、写入不抛（隐私模式也不该崩）", () => {
  const globalScope = globalThis as { localStorage?: StorageLike };
  const original = globalScope.localStorage;
  globalScope.localStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  try {
    assert.equal(readSubjectMemory(), null);
    assert.doesNotThrow(() => writeSubjectMemory("tech"));
  } finally {
    globalScope.localStorage = original;
  }
});
