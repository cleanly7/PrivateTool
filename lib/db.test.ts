/**
 * 数据层的写入语义（A5.4）：手动校正时长时，`planned_minutes` 必须跟着走。
 *
 * 用临时数据目录跑，绝不碰 data/bookkeeping.db；PRIVATE_TOOLBOX_DATA_DIR 要在
 * 动态 import db.ts 之前设好（模块里的数据目录是调用时才解析的）。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { SessionInput } from "./types.ts";

const dataDir = mkdtempSync(join(tmpdir(), "pt-db-test-"));
process.env.PRIVATE_TOOLBOX_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function focusInput(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    kind: "focus",
    planned_minutes: 38,
    started_at: new Date(2026, 2, 4, 18, 0, 0).toISOString(),
    completed_at: new Date(2026, 2, 4, 18, 38, 0).toISOString(),
    note: "",
    subject: "tech",
    actual_seconds: 38 * 60,
    title: "",
    distractions: [],
    ...overrides,
  };
}

test("校正时长时 planned_minutes 跟着改成分钟口径", async () => {
  const db = await import("./db.ts");
  const created = db.createSession(focusInput());
  assert.equal(created.planned_minutes, 38);

  const updated = db.updateSession(created.id, {
    note: "",
    subject: "tech",
    actual_seconds: 5 * 60,
  });
  assert.equal(updated?.actual_seconds, 300);
  assert.equal(updated?.planned_minutes, 5);

  // 秒数带零头时按分钟四舍五入，且不会掉到 0。
  const rounded = db.updateSession(created.id, {
    note: "",
    subject: "tech",
    actual_seconds: 89,
  });
  assert.equal(rounded?.planned_minutes, 1);
});

test("不传 actual_seconds 时时长不动，但 planned_minutes 始终跟 actual_seconds 对齐", async () => {
  const db = await import("./db.ts");
  const created = db.createSession(focusInput({ actual_seconds: 45 * 60 }));
  const updated = db.updateSession(created.id, {
    note: "补一句",
    subject: "japanese",
  });
  assert.equal(updated?.actual_seconds, 45 * 60);
  // 只要记录有 actual_seconds，planned_minutes 就是它的分钟折算（两列不会互相矛盾）。
  assert.equal(updated?.planned_minutes, 45);
  assert.equal(updated?.note, "补一句");
  assert.equal(updated?.subject, "japanese");
});

test("actual_seconds 为 null 的老记录能改成分钟口径，不会回退", async () => {
  const db = await import("./db.ts");
  const created = db.createSession(focusInput({ actual_seconds: null, planned_minutes: 45 }));
  assert.equal(created.actual_seconds, null);

  const updated = db.updateSession(created.id, {
    note: "",
    subject: "",
    actual_seconds: 90 * 60,
  });
  assert.equal(updated?.actual_seconds, 5400);
  assert.equal(updated?.planned_minutes, 90);
});

test("事后补/删分心是整批替换，不传就不动", async () => {
  const db = await import("./db.ts");
  const created = db.createSession(
    focusInput({
      distractions: [
        { at: new Date(2026, 2, 4, 18, 10, 0).toISOString(), reason: "手机消息" },
        { at: new Date(2026, 2, 4, 18, 20, 0).toISOString(), reason: "记错的" },
      ],
    }),
  );
  assert.equal(created.distractions.length, 2);

  // 不传 distractions：原样保留——改个备注不该顺手把分心清了。
  const kept = db.updateSession(created.id, {
    note: "改了备注",
    subject: "tech",
  });
  assert.equal(kept?.distractions.length, 2);

  // 传了就是整批替换：留一条、补上原因、删掉记错的那条。
  const replaced = db.updateSession(created.id, {
    note: "改了备注",
    subject: "tech",
    distractions: [
      { at: new Date(2026, 2, 4, 18, 10, 0).toISOString(), reason: "补的原因" },
    ],
  });
  assert.equal(replaced?.distractions.length, 1);
  assert.equal(replaced?.distractions[0].reason, "补的原因");

  // 传空数组 = 把这段的分心全删掉（旧行必须真的没了，不留孤儿）。
  const cleared = db.updateSession(created.id, {
    note: "改了备注",
    subject: "tech",
    distractions: [],
  });
  assert.deepEqual(cleared?.distractions, []);
  assert.deepEqual(db.getSession(created.id)?.distractions, []);
});

test("冥想记录能改时长，但科目一定是空的", async () => {
  const db = await import("./db.ts");
  const created = db.createSession(
    focusInput({ kind: "meditation", subject: "", actual_seconds: 20 * 60, planned_minutes: 20 }),
  );
  const updated = db.updateSession(created.id, {
    note: "打坐",
    subject: "",
    actual_seconds: 10 * 60,
  });
  assert.equal(updated?.actual_seconds, 600);
  assert.equal(updated?.planned_minutes, 10);
  assert.equal(updated?.subject, "");
});
