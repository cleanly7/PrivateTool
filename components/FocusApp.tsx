"use client";

import { useState } from "react";
import { CalendarPlus, LayoutGrid } from "lucide-react";

import BackfillFocusModal from "./BackfillFocusModal";
import FocusOverview from "./FocusOverview";
import FocusSession from "./FocusSession";
import TodayFocus from "./TodayFocus";
import WeeklyFocus from "./WeeklyFocus";
import { FOCUS_KIND } from "@/lib/types";

/**
 * 专注时间：正计时。技术学习 / 日语两门科目分开计，记完备注直接看今日小时数
 * 和本周专注数据（对应复盘表里的「当天有效技术小时数」「当天日语小时数」）。
 *
 * 倒计时（番茄钟那种）不在这里：冥想还在用倒计时组件，以后要做番茄钟
 * 模块也是单独一个入口。
 */
export default function FocusApp() {
  const [refreshKey, setRefreshKey] = useState(0);
  /**
   * 计时 / 总览在同一页内切换，不走路由（规格 Q10 = A）。
   *
   * 关键决定：两个视图**都保持挂载**，只用一个 class 把非当前的隐藏起来。
   * 计时状态（开始时刻、累加毫秒、暂停标志、草稿、45 分钟提示是否响过）全在
   * FocusSession 的 state / ref 里，一旦卸载就全丢——正计时会直接停掉，
   * 而且草稿还会被重新读一遍。用 CSS 隐藏则组件根本没被卸载，计时一秒不差，
   * 暂停状态也原样保留（规格第 12 章第 8 条回归项）。
   * 代价只是后台多挂一个只读面板，`display: none` 不会触发它的重排。
   */
  const [view, setView] = useState<"timer" | "overview">("timer");
  /** B1 手动补录弹窗：忘开计时器时事后补一段。 */
  const [backfillOpen, setBackfillOpen] = useState(false);

  return (
    <main className="app-shell">
      <div className="tool-header">
        <div>
          <h2 className="tool-title">专注时间</h2>
          {view === "timer" && (
            <p className="tool-subtitle">
              只在真的在学的时候开着。学到自然停下来，再确认实际时长和一句复盘。
            </p>
          )}
        </div>
        <div className="top-actions">
          <button
            className="btn"
            onClick={() => setBackfillOpen(true)}
            aria-label="补录一段专注"
            title="忘开计时器时，事后把这段补上"
          >
            <CalendarPlus size={16} />
            补录一段
          </button>
          {view === "timer" && (
            <button
              className="btn"
              onClick={() => setView("overview")}
              aria-label="打开总览"
              title="打开总览"
            >
              <LayoutGrid size={16} />
              总览
            </button>
          )}
        </div>
      </div>

      {/* 计时视图：切换时只隐藏，不卸载（见上面的说明）。 */}
      <div className={view === "timer" ? "" : "view-hidden"}>
        <div className="focus-grid">
          <FocusSession
            kind={FOCUS_KIND}
            title="专注时间"
            withSubject
            onCompleted={() => setRefreshKey((key) => key + 1)}
          />
          <div className="focus-side">
            <TodayFocus refreshKey={refreshKey} />
          </div>
        </div>
        <WeeklyFocus refreshKey={refreshKey} />
      </div>

      {view === "overview" && (
        <FocusOverview
          refreshKey={refreshKey}
          onBack={() => setView("timer")}
        />
      )}

      <BackfillFocusModal
        open={backfillOpen}
        onClose={() => setBackfillOpen(false)}
        onSaved={() => setRefreshKey((key) => key + 1)}
      />
    </main>
  );
}
