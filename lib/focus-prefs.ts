/**
 * 专注时间的「顺手记住」：只记一件事——上次选的科目。
 *
 * 这是个纯展示偏好，不参与任何统计，所以一律 best effort：
 * localStorage 读坏了当没记过，绝不因为一个默认值把计时搞崩。
 * （大标题的「最近用过」不走这里：那份列表从 GET /api/sessions 现算，见 FocusSession。）
 */

import { isFocusSubject, type FocusSubject } from "./types.ts";

/** 科目记忆。键名固定，改名等于让所有用户丢一次记忆。 */
const SUBJECT_MEMORY_KEY = "focus-subject-memory";

/** 上次选的科目；没记过或者记的是脏数据就返回 null（调用方自己给默认值 `tech`）。 */
export function readSubjectMemory(): FocusSubject | null {
  try {
    const raw = localStorage.getItem(SUBJECT_MEMORY_KEY);
    // 值不是 tech/japanese（比如被别的东西写脏了）时按「没记过」处理。
    return isFocusSubject(raw) ? raw : null;
  } catch {
    // localStorage 不可用（隐私模式等）：纯偏好，静默回落默认值即可。
    return null;
  }
}

/** 只在用户主动切到「技术学习 / 日语」时写；切到「未分类」不写（不要用未分类覆盖记忆）。 */
export function writeSubjectMemory(subject: FocusSubject): void {
  try {
    localStorage.setItem(SUBJECT_MEMORY_KEY, subject);
  } catch {
    // 同上，写不进去也不影响功能。
  }
}
