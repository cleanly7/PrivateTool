"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Check,
  History,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  X,
  Zap,
} from "lucide-react";

import { formatTime, toLocalDateKey } from "@/lib/date";
import { isDesktopShell, onDesktopDistraction } from "@/lib/desktop";
import { recentFocusTitles } from "@/lib/focus-stats";
import { readSubjectMemory, writeSubjectMemory } from "@/lib/focus-prefs";
import {
  clearPendingRecord,
  readPendingRecord,
  requestNotificationPermission,
  saveSessionRecord,
  sendNotification,
  writePendingRecord,
} from "@/lib/focus-session";
import {
  COUNT_UP_DRAFT_VERSION,
  FOCUS_MARK_MS,
  FORGOT_STOP_MS,
  LONG_SESSION_MS,
  countUpFromStoredTimer,
  elapsedMs,
  formatClock,
  formatElapsed,
  minutesForSave,
  readCountUpDraft,
  type CountUpDraft,
  type PendingSave,
} from "@/lib/focus-timer";
import {
  FOCUS_SUBJECTS,
  FOCUS_SUBJECT_LABELS,
  FOCUS_UNCLASSIFIED,
  MAX_DISTRACTIONS,
  MAX_DISTRACTION_REASON_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  isFocusSubject,
  type DistractionInput,
  type FocusSubject,
  type SessionKind,
  type SessionRecord,
} from "@/lib/types";

const draftKey = (kind: SessionKind) => `focus-timer-${kind}`;
/** 升级前专注用的 kind 是 "pomodoro"，草稿也留在那个 key 里。 */
const LEGACY_DRAFT_KEY = "focus-timer-pomodoro";
/** 刻度条画的是 0–90 分钟；45 与 90 各有一个刻度点（45 分钟一档）。 */
const SCALE_MS = FOCUS_MARK_MS * 2;
/** 「刚刚记了一次分心」的 toast 停留时间。 */
const TOAST_MS = 2500;
/** 「先开始一段专注」这类提醒条的停留时间。 */
const NOTICE_MS = 3000;

/**
 * 分心条目只按 `at`（ISO 时刻）认身份，所以同一毫秒里记两次会撞成一条。
 * 系统时钟精度通常够，但连点/自动化测试能撞上；撞了就顺延 1 毫秒，时间显示看不出来。
 */
function normalizeDistractionAt(at: string, existing: DistractionInput[]): string {
  const taken = new Set(existing.map((item) => item.at));
  if (!taken.has(at)) return at;
  const base = Date.parse(at);
  if (!Number.isFinite(base)) return at;
  let candidate = base;
  let value = at;
  while (taken.has(value)) {
    candidate += 1;
    value = new Date(candidate).toISOString();
  }
  return value;
}

type Status = "idle" | "running" | "paused";

interface ReviewState {
  startedAt: string;
  completedAt: string;
  seconds: number;
  minutes: number;
  subject: FocusSubject | "";
  note: string;
  title: string;
  distractions: DistractionInput[];
}

/**
 * 专注时间：正计时。
 *
 * 记的是真实发生的事：时长按墙上时钟累计（暂停不算），什么时候停由你决定；
 * 结束以后弹窗确认实际时长、补一句复盘，再落库。
 *
 * 三个「辅助」都遵守同一条原则——只帮忙记，绝不插手节奏：
 *   · 大标题：这段在做什么，运行中途随时能改，还能一键复用最近写过的；
 *   · 分心：按一下就记下（桌面里 ⌘⇧D 随时可用），原因事后补，不影响计时；
 *   · 45 分钟刻度：到点只提醒一次，不响铃、不暂停、不强制休息。
 *
 * 关键约束：只有保存成功才会清掉本地草稿，失败一定看得见、能重试。
 */
export default function FocusSession({
  kind,
  title,
  withSubject = true,
  onCompleted,
}: {
  kind: SessionKind;
  title: string;
  /** 需要选「学什么」（技术学习 / 日语）。 */
  withSubject?: boolean;
  onCompleted: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  // 只用来定时触发重渲染；真正的时长每帧按墙上时钟重算。
  const [, setTick] = useState(0);
  const [subject, setSubject] = useState<FocusSubject | "">(
    withSubject ? (FOCUS_SUBJECTS[0]?.id ?? "") : "",
  );
  const [planTitle, setPlanTitle] = useState("");
  const [recentTitles, setRecentTitles] = useState<string[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [distractions, setDistractions] = useState<DistractionInput[]>([]);
  const [distractionToast, setDistractionToast] = useState<{
    /** 按「记下的时刻」认条目，不按数组下标：下标会随着删除往前挪。 */
    at: string;
    count: number;
  } | null>(null);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  const [markNotice, setMarkNotice] = useState<string | null>(null);
  const [desktopShell, setDesktopShell] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const subjectRef = useRef<FocusSubject | "">(subject);
  const titleRef = useRef("");
  const distractionsRef = useRef<DistractionInput[]>([]);
  /**
   * 45 分钟提示只响一次。标记只活在组件 state 里（不入库、不进草稿），
   * 所以草稿恢复到 46 分钟后不会再补响一次。
   */
  const fired45Ref = useRef(false);
  const pendingFailedRef = useRef(false);
  /** Esc 关弹窗走 ref 取最新的 discard，免得给那个 effect 挂一堆依赖。 */
  const discardRef = useRef<() => void>(() => {});
  /**
   * 这一段累计记了几次分心，只增不减（删掉一条也不回退）。
   * 用它而不是 `distractions.length` 报「第 N 次」：删掉一条再记一条时，
   * 数组长度会回到同一个数字，用户会看到两条都写着「第 2 次」。
   */
  const distractionSeqRef = useRef(0);
  const triggerRef = useRef<() => void>(() => {});
  const recentRef = useRef<HTMLDivElement | null>(null);

  const stopTicking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  /** 把草稿写进 localStorage；pending 是「已结束但还没入库」的那条记录。 */
  const persist = useCallback(
    (pending: PendingSave | null, failed = false) => {
      if (startedAtRef.current === null) {
        localStorage.removeItem(draftKey(kind));
        return;
      }
      const draft: CountUpDraft = {
        version: COUNT_UP_DRAFT_VERSION,
        status: runStartedAtRef.current === null ? "paused" : "running",
        startedAt: startedAtRef.current,
        runStartedAt: runStartedAtRef.current,
        accumulatedMs: Math.round(accumulatedMsRef.current),
        subject: subjectRef.current,
        note: "",
        title: titleRef.current,
        distractions: distractionsRef.current,
        pending,
        pendingFailed: failed,
      };
      try {
        localStorage.setItem(draftKey(kind), JSON.stringify(draft));
      } catch (error) {
        // 写不进去不该拖累计时（隐私模式 / 配额满），草稿只是尽力而为；
        // 但失败是真事，留一条日志，别让「草稿丢了」变成无从查起的现象。
        console.error("专注草稿写入 localStorage 失败", error);
      }
    },
    [kind],
  );

  /**
   * 每 500ms 一次：重渲染 + 检查有没有跨过 45 分钟。
   * 跨过只提醒一次（一条常驻提示条 + 一次系统通知），**不响铃、不暂停**——
   * 停不停是用户的事；正在专注时响铃是打扰。
   */
  const startTicking = useCallback(() => {
    stopTicking();
    intervalRef.current = setInterval(() => {
      const ms = elapsedMs(
        {
          status: "running",
          runStartedAt: runStartedAtRef.current,
          accumulatedMs: accumulatedMsRef.current,
        },
        Date.now(),
      );
      if (!fired45Ref.current && ms >= FOCUS_MARK_MS) {
        fired45Ref.current = true;
        sendNotification("专注 45 分钟", "想歇就歇，计时不会停");
        setMarkNotice("已经 45 分钟了，想歇就歇，计时不会停");
      }
      setTick(Date.now());
    }, 500);
  }, [stopTicking]);

  useEffect(() => {
    subjectRef.current = subject;
  }, [subject]);

  useEffect(() => {
    titleRef.current = planTitle;
  }, [planTitle]);

  useEffect(() => {
    distractionsRef.current = distractions;
  }, [distractions]);

  useEffect(() => {
    setDesktopShell(isDesktopShell());
  }, []);

  /** 桌面壳里的全局快捷键（⌘⇧D）：主进程把窗口叫回来，这里只管记一次。 */
  useEffect(
    () => onDesktopDistraction(() => triggerRef.current()),
    [],
  );

  /**
   * 浏览器里没有全局快捷键，就退化成页面内的 ⌘⇧D。
   * **桌面态下不能注册**：主进程的 globalShortcut 和页面 keydown 会双触发。
   */
  useEffect(() => {
    if (desktopShell) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "d") return;
      event.preventDefault();
      triggerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [desktopShell]);

  /** 「最近」浮层：点别处或按 Esc 关掉。 */
  useEffect(() => {
    if (!recentOpen) return;
    const onDown = (event: MouseEvent) => {
      if (recentRef.current?.contains(event.target as Node)) return;
      setRecentOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecentOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [recentOpen]);

  /**
   * 结束弹窗：Esc = 丢弃这段（与其它 5 个弹窗一致）。
   * 保存中不响应，避免在请求飞出去的时候把界面拆了。
   */
  useEffect(() => {
    if (!review) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      discardRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [review, saving]);

  /**
   * 最近用过的大标题：从记录里现算（不新增接口、不写 localStorage）。
   * 取不到时只是少了个便利入口，计时照常。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/sessions");
        if (!response.ok) return;
        const data = (await response.json()) as { sessions?: SessionRecord[] };
        if (cancelled || !Array.isArray(data.sessions)) return;
        setRecentTitles(recentFocusTitles(data.sessions));
      } catch (error) {
        // 「最近标题」是纯便利功能，网络/服务出问题时降级就好，不打扰正在专注的人；
        // 但仍然记一条日志——静默 catch 会让「浮层里怎么老是空的」查不出原因。
        console.error("读取最近标题失败", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // 顺手的默认值：上次选的科目。草稿恢复会覆盖它（下面那个 effect 在后面跑）。
  useEffect(() => {
    if (!withSubject) return;
    const remembered = readSubjectMemory();
    if (remembered) {
      subjectRef.current = remembered;
      setSubject(remembered);
    }
  }, [withSubject]);

  // 刷新/重开窗口以后接着走：草稿、以及结束弹窗里那条没保存成功的记录。
  useEffect(() => {
    const raw = localStorage.getItem(draftKey(kind));
    const legacyRaw = raw ? null : localStorage.getItem(LEGACY_DRAFT_KEY);
    let restored: CountUpDraft | null = null;
    // 解析失败 = 我们看不懂这条草稿。看不懂不代表用户的时长不重要，
    // 所以原地留着（绝不 removeItem），下次刷新还能再试；只记日志。
    let draftUnreadable = false;
    if (raw || legacyRaw) {
      try {
        const parsed: unknown = JSON.parse(raw ?? legacyRaw ?? "");
        restored =
          readCountUpDraft(parsed) ?? countUpFromStoredTimer(parsed, Date.now());
      } catch (error) {
        restored = null;
        draftUnreadable = true;
        console.error("专注草稿解析失败，已原样保留（不删）", error);
      }
    }
    if (legacyRaw && !draftUnreadable) localStorage.removeItem(LEGACY_DRAFT_KEY);
    if (!restored) {
      if (raw && !draftUnreadable) localStorage.removeItem(draftKey(kind));
      const pending = readPendingRecord(kind);
      if (pending) {
        setReview({ ...pending, minutes: minutesForSave(pending.seconds) });
        setSaveError("上次保存没有成功");
      }
      return;
    }

    startedAtRef.current = restored.startedAt;
    accumulatedMsRef.current = restored.accumulatedMs;
    // 恢复时已经过了 45 分钟的不再补提醒（提示是「到点那一下」，不是补课）。
    fired45Ref.current = restored.accumulatedMs >= FOCUS_MARK_MS;
    runStartedAtRef.current =
      restored.status === "running" ? (restored.runStartedAt ?? Date.now()) : null;
    if (withSubject && isFocusSubject(restored.subject)) {
      subjectRef.current = restored.subject;
      setSubject(restored.subject);
    }
    if (restored.title) {
      titleRef.current = restored.title;
      setPlanTitle(restored.title);
    }
    if (restored.distractions.length > 0) {
      distractionsRef.current = restored.distractions;
      setDistractions(restored.distractions);
      // 接着这段数：恢复以后新记的一条不该又叫「第 1 次」。
      distractionSeqRef.current = restored.distractions.length;
    }
    if (restored.pending) {
      // 结束弹窗开着的时候被刷新了：原样打开，内容都在。
      setStatus("paused");
      setReview({
        ...restored.pending,
        minutes: minutesForSave(restored.pending.seconds),
      });
      // 只有真的保存失败过才喊「保存失败」，别自己吓自己。
      setSaveError(restored.pendingFailed ? "上次保存没有成功" : null);
      return;
    }
    if (restored.status === "running") {
      setStatus("running");
      startTicking();
      requestNotificationPermission();
      return;
    }
    setStatus("paused");
    // 只在挂载时恢复一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => stopTicking, [stopTicking]);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  useEffect(() => {
    if (!distractionToast) return;
    const timer = setTimeout(() => setDistractionToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [distractionToast]);

  useEffect(() => {
    if (!shortcutNotice) return;
    const timer = setTimeout(() => setShortcutNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shortcutNotice]);

  // 已经在计时：大标题和分心随时写回草稿，关窗口/刷新都还在。
  // （还没开始的时候不写草稿——那会儿还没有「这一段」。）
  // 结束弹窗开着的时候由下面那个 effect 负责（它要连弹窗里的编辑一起进草稿）。
  useEffect(() => {
    if (review || startedAtRef.current === null) return;
    persist(null);
  }, [planTitle, distractions, review, persist]);

  /*
   * 结束弹窗开着的时候，改标题 / 补原因 / 改分钟数同样要进草稿。
   *
   * 不这样就自相矛盾：弹窗上写着「内容和时长都留着，可以重试」，刷新一下却回退成
   * 打开弹窗那一刻的快照（title 回退、补的原因全没）。`persist(review)` 会把弹窗里
   * 的当前值一起写进去，同时保持 pendingFailed 不变。
   */
  useEffect(() => {
    if (!review || startedAtRef.current === null) return;
    const pending: PendingSave = {
      startedAt: review.startedAt,
      completedAt: review.completedAt,
      seconds: Math.max(1, review.minutes * 60),
      subject: review.subject,
      note: review.note,
      title: review.title.trim(),
      distractions: review.distractions,
    };
    persist(pending, pendingFailedRef.current);
  }, [review, persist]);

  const start = () => {
    if (status === "idle") {
      startedAtRef.current = new Date().toISOString();
      accumulatedMsRef.current = 0;
      fired45Ref.current = false;
      // 新的「这一段」：序号从头数。
      distractionSeqRef.current = 0;
    }
    runStartedAtRef.current = Date.now();
    setStatus("running");
    setMarkNotice(null);
    // 「先开始一段专注」这类提示，开始之后就过期了，别挂在界面上。
    setShortcutNotice(null);
    persist(null);
    startTicking();
    requestNotificationPermission();
  };

  /** 把当前运行段结算进累计值（暂停/结束都先做这一步）。 */
  const settle = () => {
    if (runStartedAtRef.current !== null) {
      accumulatedMsRef.current += Math.max(0, Date.now() - runStartedAtRef.current);
      runStartedAtRef.current = null;
    }
  };

  const pause = () => {
    settle();
    stopTicking();
    setStatus("paused");
    persist(null);
  };

  const finish = () => {
    settle();
    stopTicking();
    setStatus("paused");
    const seconds = Math.max(1, Math.round(accumulatedMsRef.current / 1000));
    const pending: PendingSave = {
      startedAt:
        startedAtRef.current ??
        new Date(Date.now() - seconds * 1000).toISOString(),
      completedAt: new Date().toISOString(),
      seconds,
      subject: subjectRef.current,
      note: "",
      title: titleRef.current.trim(),
      distractions: distractionsRef.current,
    };
    pendingFailedRef.current = false;
    setReview({ ...pending, minutes: minutesForSave(seconds) });
    setSaveError(null);
    persist(pending, false);
  };

  const save = async () => {
    if (!review) return;
    setSaving(true);
    setSaveError(null);
    const seconds = Math.max(60, review.minutes * 60);
    const sessionTitle = review.title.trim();
    const pending: PendingSave = {
      startedAt: review.startedAt,
      completedAt: review.completedAt,
      seconds,
      subject: review.subject,
      note: review.note.trim(),
      title: sessionTitle,
      distractions: review.distractions,
    };
    const result = await saveSessionRecord({
      kind,
      startedAt: pending.startedAt,
      completedAt: pending.completedAt,
      seconds: pending.seconds,
      note: pending.note,
      subject: withSubject ? pending.subject : "",
      title: sessionTitle,
      distractions: pending.distractions,
    });
    setSaving(false);

    if (!result.ok) {
      // 保存失败绝不静默：内容和时长原样留着，重试或关掉窗口都还在。
      pendingFailedRef.current = true;
      writePendingRecord(kind, pending);
      setSaveError(result.error);
      persist(pending, true);
      return;
    }

    clearPendingRecord(kind);
    localStorage.removeItem(draftKey(kind));
    startedAtRef.current = null;
    runStartedAtRef.current = null;
    accumulatedMsRef.current = 0;
    fired45Ref.current = false;
    pendingFailedRef.current = false;
    if (sessionTitle) {
      setRecentTitles((current) =>
        [sessionTitle, ...current.filter((item) => item !== sessionTitle)].slice(0, 5),
      );
    }
    setStatus("idle");
    setReview(null);
    setDistractions([]);
    distractionsRef.current = [];
    distractionSeqRef.current = 0;
    setDistractionToast(null);
    setPlanTitle("");
    titleRef.current = "";
    setMarkNotice(null);
    setSavedNotice(`已保存 ${formatElapsed(seconds * 1000)}`);
    onCompleted();
  };

  const discard = () => {
    if (!window.confirm("丢掉这段计时？时长和内容都不会保存。")) return;
    clearPendingRecord(kind);
    localStorage.removeItem(draftKey(kind));
    startedAtRef.current = null;
    runStartedAtRef.current = null;
    accumulatedMsRef.current = 0;
    fired45Ref.current = false;
    pendingFailedRef.current = false;
    setReview(null);
    setSaveError(null);
    setStatus("idle");
    setMarkNotice(null);
    setDistractions([]);
    distractionsRef.current = [];
    distractionSeqRef.current = 0;
    setDistractionToast(null);
  };

  // Esc 监听用 ref 取最新的 discard：那个 effect 只依赖 review/saving，不该因为
  // discard 每次渲染换新引用而反复解绑重绑。
  useEffect(() => {
    discardRef.current = discard;
  });

  const reset = () => {
    if (
      displayMs >= 60_000 &&
      !window.confirm(`确定丢掉这段 ${formatElapsed(displayMs)} 的计时吗？`)
    ) {
      return;
    }
    stopTicking();
    localStorage.removeItem(draftKey(kind));
    startedAtRef.current = null;
    runStartedAtRef.current = null;
    accumulatedMsRef.current = 0;
    fired45Ref.current = false;
    setReview(null);
    setSaveError(null);
    setStatus("idle");
    setMarkNotice(null);
    setDistractions([]);
    distractionsRef.current = [];
    distractionSeqRef.current = 0;
    setDistractionToast(null);
  };

  /**
   * 记一次分心：**点一下立刻记下**（原因留空，事后在列表里补），
   * 计时一秒都不停。走神的时候不该先让用户打字。
   */
  const recordDistraction = useCallback(() => {
    if (review) return;
    if (startedAtRef.current === null) {
      setShortcutNotice("先开始一段专注");
      return;
    }
    if (distractionsRef.current.length >= MAX_DISTRACTIONS) {
      setShortcutNotice(
        `这一段已经记满 ${MAX_DISTRACTIONS} 次分心了，先把注意力拉回来吧。`,
      );
      return;
    }
    const entry: DistractionInput = {
      at: normalizeDistractionAt(new Date().toISOString(), distractionsRef.current),
      reason: "",
    };
    const next: DistractionInput[] = [...distractionsRef.current, entry];
    distractionsRef.current = next;
    setDistractions(next);
    setShortcutNotice(null);
    distractionSeqRef.current += 1;
    // 记下的是这一条的「时刻」而不是下标：2.5 秒里别处删过条目的话，下标会挪位。
    setDistractionToast({ at: entry.at, count: distractionSeqRef.current });
  }, [review]);

  /** ⌘⇧D：没有进行中的专注就只提示，不产生任何记录。 */
  const triggerDistraction = useCallback(() => {
    if (review) return;
    if (startedAtRef.current === null) {
      setShortcutNotice("先开始一段专注");
      return;
    }
    recordDistraction();
  }, [recordDistraction, review]);

  useEffect(() => {
    triggerRef.current = triggerDistraction;
  }, [triggerDistraction]);

  /**
   * 删掉一次分心记录。**按「记下的时刻」认，不按数组下标**：toast 里的撤销按钮
   * 拿到的是点击那一刻捕获的下标，2.5 秒内先删了更靠前的一条，那个下标就指向
   * 别的条目——撤销会变成空操作，或者删掉一条根本不是它的记录。
   */
  const removeDistractionAt = (at: string) => {
    const next = distractionsRef.current.filter((item) => item.at !== at);
    distractionsRef.current = next;
    setDistractions(next);
  };

  const updateDistractionReason = (index: number, reason: string) => {
    const next = distractionsRef.current.map((item, itemIndex) =>
      itemIndex === index
        ? { ...item, reason: reason.slice(0, MAX_DISTRACTION_REASON_LENGTH) }
        : item,
    );
    distractionsRef.current = next;
    setDistractions(next);
  };

  const removeReviewDistractionAt = (index: number) => {
    setReview((current) =>
      current
        ? {
            ...current,
            distractions: current.distractions.filter((_, item) => item !== index),
          }
        : current,
    );
  };

  const updateReviewDistractionReason = (index: number, reason: string) => {
    setReview((current) =>
      current
        ? {
            ...current,
            distractions: current.distractions.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    reason: reason.slice(0, MAX_DISTRACTION_REASON_LENGTH),
                  }
                : item,
            ),
          }
        : current,
    );
  };

  // 每帧都按墙上时钟重算：这样即使标签页被浏览器节流，显示的也是真实时长。
  const displayMs = elapsedMs(
    {
      status,
      runStartedAt: runStartedAtRef.current,
      accumulatedMs: accumulatedMsRef.current,
    },
    Date.now(),
  );
  const statusLabel =
    status === "running" ? "进行中" : displayMs > 0 ? "已暂停" : "未开始";
  const forgotStop = status === "running" && displayMs >= FORGOT_STOP_MS;
  const subjectLabel = isFocusSubject(subject)
    ? FOCUS_SUBJECT_LABELS[subject]
    : FOCUS_UNCLASSIFIED.label;
  const longWarning = review !== null && review.seconds * 1000 >= LONG_SESSION_MS;
  const scalePercent = Math.min(100, Math.round((displayMs / SCALE_MS) * 100));
  const canRecordDistraction =
    status !== "idle" && startedAtRef.current !== null && review === null;
  /** 浮层顶部的一键 chip 就是最近那一条；列表里不再重复显示它。 */
  const lastTitle = recentTitles[0] ?? "";
  const otherTitles = recentTitles.slice(1);

  return (
    <div className="panel timer-panel">
      <div className="panel-title">
        <span>{title}</span>
        <span className="panel-hint">{statusLabel}</span>
      </div>

      <div className="focus-title-row" ref={recentRef}>
        <label className="field-label" htmlFor={`focus-title-${kind}`}>
          这段时间在做什么
        </label>
        <div className="focus-title-input">
          <input
            id={`focus-title-${kind}`}
            className="input"
            type="text"
            maxLength={MAX_SESSION_TITLE_LENGTH}
            placeholder="这段时间在做什么？例：黑马点评 第 12 集"
            value={planTitle}
            onChange={(event) => setPlanTitle(event.target.value)}
            disabled={review !== null}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRecentOpen((open) => !open)}
            aria-expanded={recentOpen}
            title="用最近写过的标题"
            disabled={review !== null}
          >
            <History size={14} />
            最近
          </button>
        </div>
        {recentOpen && (
          <div className="recent-popover" role="group" aria-label="最近用过的标题">
            {lastTitle ? (
              <button
                type="button"
                className="chip active"
                onClick={() => {
                  setPlanTitle(lastTitle);
                  setRecentOpen(false);
                }}
              >
                继续上一次：{lastTitle}
              </button>
            ) : null}
            {otherTitles.map((item) => (
              <button
                key={item}
                type="button"
                className="chip"
                onClick={() => {
                  setPlanTitle(item);
                  setRecentOpen(false);
                }}
              >
                {item}
              </button>
            ))}
            {recentTitles.length === 0 && (
              <p className="recent-empty">还没有用过标题</p>
            )}
          </div>
        )}
      </div>

      {withSubject && (
        <div className="focus-subject">
          <span className="field-label">专注内容</span>
          <div className="segmented compact" role="group" aria-label="专注内容">
            {FOCUS_SUBJECTS.map((option) => (
              <button
                key={option.id}
                className={subject === option.id ? "active" : ""}
                aria-pressed={subject === option.id}
                disabled={review !== null}
                onClick={() => {
                  subjectRef.current = option.id;
                  setSubject(option.id);
                  // 只有「技术学习 / 日语」才写记忆；切到未分类不覆盖上次的选择。
                  writeSubjectMemory(option.id);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="timer-up">
        <div className="timer-clock" role="timer" aria-live="off">
          {formatClock(displayMs)}
        </div>
        <div className="timer-sub">
          {displayMs > 0 ? `已计时 ${formatElapsed(displayMs)}` : "点开始，学到你自然停下来"}
        </div>
      </div>

      <div
        className="timer-scale"
        role="img"
        aria-label={`0 到 90 分钟刻度，已过 ${formatElapsed(displayMs)}`}
      >
        <div className="timer-scale-track">
          <div className="timer-scale-fill" style={{ width: `${scalePercent}%` }} />
          <span className="timer-tick" style={{ left: "50%" }} aria-hidden="true" />
          <span className="timer-tick" style={{ left: "100%" }} aria-hidden="true" />
        </div>
        <div className="timer-scale-ticks" aria-hidden="true">
          <span className="timer-tick-label" style={{ left: "50%" }}>
            45 分
          </span>
          <span className="timer-tick-label" style={{ left: "100%" }}>
            90 分
          </span>
        </div>
      </div>
      <p className="timer-scale-hint">到点只提醒，不打断计时</p>

      <p className="visually-hidden" aria-live="polite">
        {statusLabel}
      </p>

      {forgotStop && (
        <p className="timer-alert warn">
          <AlertTriangle size={16} />
          已经 {formatElapsed(displayMs)} 了，是不是忘记结束？结束时会让你确认实际时长。
        </p>
      )}
      {markNotice && (
        <p className="timer-alert ok">
          <BellRing size={16} />
          {markNotice}
        </p>
      )}
      {savedNotice && (
        <p className="timer-alert ok">
          <Check size={16} />
          {savedNotice}
        </p>
      )}

      <div className="timer-actions">
        <button
          className="btn btn-primary"
          onClick={status === "running" ? pause : start}
          disabled={review !== null}
        >
          {status === "running" ? <Pause size={18} /> : <Play size={18} />}
          {status === "running" ? "暂停" : status === "paused" ? "继续" : "开始"}
        </button>
        <button
          className="btn"
          onClick={finish}
          disabled={review !== null || displayMs < 1000}
          title={displayMs < 1000 ? "先开始一段专注" : "结束并确认时长"}
        >
          <Square size={16} />
          结束并保存
        </button>
        <button
          className="btn"
          onClick={reset}
          disabled={status === "idle" && displayMs === 0}
        >
          <RotateCcw size={16} />
          重置
        </button>
        <button
          className="btn"
          onClick={recordDistraction}
          disabled={!canRecordDistraction}
          title={
            canRecordDistraction
              ? desktopShell
                ? "记下这次分心（⌘⇧D）"
                : "记下这次分心"
              : "先开始一段专注"
          }
        >
          <Zap size={16} />
          分心了一下
        </button>
      </div>

      <div className="focus-distractions">
        <div className="focus-distraction-head">
          <span className="focus-distraction-count">本段分心 {distractions.length} 次</span>
          {distractions.length > 0 && desktopShell && (
            <span className="focus-distraction-hint">
              桌面里随时按 <kbd className="kbd">⌘⇧D</kbd>
            </span>
          )}
        </div>

        {shortcutNotice && (
          <p className="timer-alert warn">
            <AlertTriangle size={16} />
            {shortcutNotice}
          </p>
        )}

        {distractions.length === 0 ? (
          <p className="focus-distraction-empty">这段还没有分心记录</p>
        ) : (
          <ul className="focus-distraction-list">
            {distractions.map((item, index) => (
              <li key={`${item.at}-${index}`} className="focus-distraction-row">
                <span className="focus-distraction-time">{formatTime(item.at)}</span>
                <input
                  className="input"
                  type="text"
                  maxLength={MAX_DISTRACTION_REASON_LENGTH}
                  placeholder="这次是什么让你分心？（可不填）"
                  value={item.reason}
                  onChange={(event) =>
                    updateDistractionReason(index, event.target.value)
                  }
                  aria-label={`第 ${index + 1} 次分心的原因`}
                />
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeDistractionAt(item.at)}
                  aria-label="删掉这次分心记录"
                  title="删掉这次分心记录"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {distractionToast && (
        <div className="toast" role="status" aria-live="polite">
          已记下第 {distractionToast.count} 次分心
          <button
            type="button"
            className="toast-undo"
            onClick={() => {
              removeDistractionAt(distractionToast.at);
              setDistractionToast(null);
            }}
          >
            撤销
          </button>
        </div>
      )}

      {review && (
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) discard();
          }}
        >
          <div
            className="modal modal-small"
            role="dialog"
            aria-modal="true"
            aria-label="结束这段专注"
          >
            <div className="modal-head">
              <h2>结束这段专注</h2>
              <button
                className="btn-icon"
                onClick={discard}
                aria-label="丢弃这段计时"
                title="丢弃这段计时"
                disabled={saving}
              >
                <X size={18} />
              </button>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="focus-review-title">
                这段时间在做什么
              </label>
              <input
                id="focus-review-title"
                className="input"
                type="text"
                maxLength={MAX_SESSION_TITLE_LENGTH}
                placeholder="这段时间在做什么？例：黑马点评 第 12 集"
                value={review.title}
                onChange={(event) =>
                  setReview((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                disabled={saving}
              />
            </div>

            <div className="field">
              <span className="field-label">这段实际学了多久</span>
              <div className="duration-control">
                <button
                  className="btn-icon"
                  onClick={() =>
                    setReview((current) =>
                      current
                        ? { ...current, minutes: Math.max(1, current.minutes - 5) }
                        : current,
                    )
                  }
                  aria-label="减少 5 分钟"
                  title="减少 5 分钟"
                  disabled={saving}
                >
                  <Minus size={16} />
                </button>
                <input
                  className="duration-input"
                  type="number"
                  min={1}
                  max={1440}
                  value={review.minutes}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setReview((current) =>
                      current
                        ? {
                            ...current,
                            minutes: Number.isFinite(next)
                              ? Math.min(1440, Math.max(1, Math.round(next)))
                              : current.minutes,
                          }
                        : current,
                    );
                  }}
                  aria-label="分钟"
                  disabled={saving}
                />
                <span className="duration-unit">分钟</span>
                <button
                  className="btn-icon"
                  onClick={() =>
                    setReview((current) =>
                      current
                        ? { ...current, minutes: Math.min(1440, current.minutes + 5) }
                        : current,
                    )
                  }
                  aria-label="增加 5 分钟"
                  title="增加 5 分钟"
                  disabled={saving}
                >
                  <Plus size={16} />
                </button>
              </div>
              <p className="field-hint">
                科目：{subjectLabel} · 开始于 {formatTime(review.startedAt)}
                {toLocalDateKey(review.startedAt) !== toLocalDateKey(review.completedAt)
                  ? "（跨零点，算在开始那天）"
                  : ""}
              </p>
            </div>

            {longWarning && (
              <p className="timer-alert warn">
                <AlertTriangle size={16} />
                这一下记了 {review.minutes} 分钟。如果中途走开过，直接把上面的分钟数改成真实有效的时长再保存。
              </p>
            )}

            <div className="field">
              <span className="field-label">
                {review.distractions.length > 0
                  ? `这段分心了 ${review.distractions.length} 次`
                  : "这段没有记录到分心"}
              </span>
              {review.distractions.length > 0 && (
                <>
                  <ul className="focus-distraction-list">
                    {review.distractions.map((item, index) => (
                      <li
                        key={`${item.at}-${index}`}
                        className="focus-distraction-row"
                      >
                        <span className="focus-distraction-time">
                          {formatTime(item.at)}
                        </span>
                        <input
                          className="input"
                          type="text"
                          maxLength={MAX_DISTRACTION_REASON_LENGTH}
                          placeholder="这次是什么让你分心？（可不填）"
                          value={item.reason}
                          onChange={(event) =>
                            updateReviewDistractionReason(index, event.target.value)
                          }
                          aria-label={`第 ${index + 1} 次分心的原因`}
                          disabled={saving}
                        />
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => removeReviewDistractionAt(index)}
                          aria-label="删掉这次分心记录"
                          title="其实不算走神，删掉"
                          disabled={saving}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="field-hint">
                    保存时这些会跟着记录一起存；删掉的不会入库。
                  </p>
                </>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="focus-review-note">
                这次学到了什么（写进复盘）
              </label>
              <textarea
                id="focus-review-note"
                className="textarea"
                rows={4}
                maxLength={200}
                placeholder="例：黑马点评第 12 集，缓存穿透的三层防护"
                value={review.note}
                onChange={(event) =>
                  setReview((current) =>
                    current ? { ...current, note: event.target.value } : current,
                  )
                }
                autoFocus
                disabled={saving}
              />
            </div>

            {saveError && (
              <p className="timer-alert err">
                <AlertTriangle size={16} />
                保存失败：{saveError}
                <br />
                内容和时长都留着，可以重试，也可以先关掉窗口稍后再存。
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={discard} disabled={saving}>
                丢弃这段
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "保存中…" : saveError ? "重试保存" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
