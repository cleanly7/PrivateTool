"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Droplets, GlassWater, Settings } from "lucide-react";

import WaterSettingsModal from "./WaterSettingsModal";
import {
  playChime,
  requestNotificationPermission,
  sendNotification,
} from "@/lib/notify";
import { formatTime } from "@/lib/date";
import {
  DEFAULT_WATER_SETTINGS,
  type WaterIntake,
  type WaterSettings,
} from "@/lib/types";

const TICK_MS = 30_000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export default function WaterApp() {
  const [settings, setSettings] = useState<WaterSettings>(
    DEFAULT_WATER_SETTINGS,
  );
  const [today, setToday] = useState<WaterIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const sessionStartRef = useRef(Date.now());
  const dismissedUntilRef = useRef(0);
  const lastFiredRef = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/water");
      if (!response.ok) throw new Error("加载失败");
      const data = await response.json();
      setToday(data.today ?? []);
      if (data.settings) setSettings(data.settings);
      setLoadError("");
    } catch {
      setLoadError("数据加载失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    const check = () => setNow(Date.now());
    check();
    const id = setInterval(check, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const totalMl = useMemo(
    () => today.reduce((sum, item) => sum + item.amount_ml, 0),
    [today],
  );
  const goalMl = settings.daily_goal_cups * settings.cup_ml;
  const goalReached = goalMl > 0 && totalMl >= goalMl;

  const lastDrinkAt = useMemo(() => {
    if (today.length === 0) return null;
    return Math.max(...today.map((item) => Date.parse(item.logged_at)));
  }, [today]);

  // 基准时间：当天最后一次喝水；无记录时以本次打开应用为基准
  const baselineMs = lastDrinkAt ?? sessionStartRef.current;
  const intervalMs = settings.remind_interval_min * 60_000;
  const elapsedMin = Math.max(0, Math.floor((now - baselineMs) / 60_000));
  const nextInMin = Math.max(0, settings.remind_interval_min - elapsedMin);

  const current = new Date(now);
  const nowHHmm = `${pad2(current.getHours())}:${pad2(current.getMinutes())}`;
  const inActiveWindow =
    nowHHmm >= settings.active_start && nowHHmm <= settings.active_end;

  const due =
    !goalReached && inActiveWindow && elapsedMin >= settings.remind_interval_min;

  useEffect(() => {
    if (!due) return;
    const firedAt = Date.now();
    if (firedAt < dismissedUntilRef.current) return;
    if (firedAt - lastFiredRef.current < intervalMs) return;
    lastFiredRef.current = firedAt;
    setToast(true);
    playChime();
    sendNotification(
      "该喝水了",
      `距上次喝水已超过 ${settings.remind_interval_min} 分钟`,
    );
  }, [due, settings.remind_interval_min, intervalMs]);

  useEffect(() => {
    if (!due && toast) setToast(false);
  }, [due, toast]);

  const log = useCallback(async (cups: number) => {
    try {
      const response = await fetch("/api/water", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cups }),
      });
      if (!response.ok) {
        window.alert("记录失败，请重试");
        return;
      }
      const data = await response.json();
      setToday(data.today ?? []);
    } catch {
      window.alert("记录失败，请重试");
    }
  }, []);

  const handleSaveSettings = useCallback(async (next: WaterSettings) => {
    try {
      const response = await fetch("/api/water/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        window.alert("设置保存失败，请重试");
        return;
      }
      const data = await response.json();
      setSettings(data.settings);
      setSettingsOpen(false);
    } catch {
      window.alert("设置保存失败，请重试");
    }
  }, []);

  const dismissToast = useCallback(() => {
    setToast(false);
    dismissedUntilRef.current = Date.now() + intervalMs;
  }, [intervalMs]);

  const progress = goalMl > 0 ? Math.min(1, totalMl / goalMl) : 0;

  return (
    <main className="app-shell">
      <div className="tool-header">
        <h2 className="tool-title">喝水</h2>
        <div className="top-actions">
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
            提醒设置
          </button>
        </div>
      </div>

      {loadError && <div className="load-error">{loadError}</div>}

      <div className="water-grid">
        <div className="panel water-hero">
          <div
            className="timer-ring water-ring"
            style={{
              background: `conic-gradient(var(--accent) ${progress * 360}deg, #eef0f3 0deg)`,
            }}
          >
            <div className="timer-face">
              <div className="water-cups">
                {today.length}
                <span> / {settings.daily_goal_cups} 杯</span>
              </div>
              <div className="timer-sub">
                {totalMl} / {goalMl} ml
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary drink-btn"
            onClick={() => void log(1)}
            disabled={loading}
          >
            <GlassWater size={22} />
            喝了 1 杯
          </button>
          <p className="water-status">
            {loading
              ? "正在加载…"
              : goalReached
                ? "🎉 今日目标已达成"
                : inActiveWindow
                  ? nextInMin <= 0
                    ? "该喝水了！"
                    : `下次提醒约 ${nextInMin} 分钟后`
                  : "当前不在提醒时段"}
          </p>
        </div>

        <div className="panel water-side">
          <div className="panel-title">
            <span>今日记录</span>
            <span className="panel-hint">{today.length} 次</span>
          </div>
          {today.length === 0 ? (
            <div className="empty">今天还没喝水，点左边大按钮记一杯 💧</div>
          ) : (
            today.slice(0, 12).map((item) => (
              <div className="record-row" key={item.id}>
                <span className="cat-icon water-cat">
                  <Droplets size={16} />
                </span>
                <div className="record-main">
                  <div className="tx-title">{item.amount_ml} ml</div>
                </div>
                <div className="record-time">{formatTime(item.logged_at)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {toast && (
        <div className="water-toast" role="alert">
          <div className="water-toast-title">💧 该喝水了</div>
          <div className="water-toast-sub">
            距上次喝水已超过 {settings.remind_interval_min} 分钟
          </div>
          <div className="water-toast-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setToast(false);
                void log(1);
              }}
            >
              喝了
            </button>
            <button className="btn btn-sm" onClick={dismissToast}>
              关闭
            </button>
          </div>
        </div>
      )}

      <WaterSettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </main>
  );
}
