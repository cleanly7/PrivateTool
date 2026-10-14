"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import type { WaterSettings } from "@/lib/types";

export default function WaterSettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: WaterSettings;
  onClose: () => void;
  onSave: (settings: WaterSettings) => void;
}) {
  const [goal, setGoal] = useState("");
  const [cupMl, setCupMl] = useState("");
  const [intervalMin, setIntervalMin] = useState("");
  const [activeStart, setActiveStart] = useState("08:00");
  const [activeEnd, setActiveEnd] = useState("22:00");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setGoal(String(settings.daily_goal_cups));
    setCupMl(String(settings.cup_ml));
    setIntervalMin(String(settings.remind_interval_min));
    setActiveStart(settings.active_start);
    setActiveEnd(settings.active_end);
    setError("");
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = () => {
    const goalNum = Number(goal);
    const cupNum = Number(cupMl);
    const intervalNum = Number(intervalMin);
    if (
      !goal ||
      !Number.isInteger(goalNum) ||
      goalNum < 1 ||
      goalNum > 24
    ) {
      setError("每日目标需为 1–24 的整数");
      return;
    }
    if (!cupMl || !Number.isFinite(cupNum) || cupNum < 50 || cupNum > 1000) {
      setError("杯容量需在 50–1000 毫升之间");
      return;
    }
    if (
      !intervalMin ||
      !Number.isInteger(intervalNum) ||
      intervalNum < 5 ||
      intervalNum > 240
    ) {
      setError("提醒间隔需为 5–240 分钟的整数");
      return;
    }
    if (activeStart >= activeEnd) {
      setError("活跃时段的开始时间需早于结束时间");
      return;
    }
    onSave({
      daily_goal_cups: goalNum,
      cup_ml: cupNum,
      remind_interval_min: intervalNum,
      active_start: activeStart,
      active_end: activeEnd,
    });
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-small"
        role="dialog"
        aria-modal="true"
        aria-label="喝水提醒设置"
      >
        <div className="modal-head">
          <h2>喝水提醒设置</h2>
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="water-goal">
              每日目标（杯）
            </label>
            <input
              id="water-goal"
              className="input"
              type="number"
              inputMode="numeric"
              min="1"
              max="24"
              step="1"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="water-cup-ml">
              杯容量（毫升）
            </label>
            <input
              id="water-cup-ml"
              className="input"
              type="number"
              inputMode="numeric"
              min="50"
              max="1000"
              step="10"
              value={cupMl}
              onChange={(event) => setCupMl(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="water-interval">
              提醒间隔（分钟）
            </label>
            <input
              id="water-interval"
              className="input"
              type="number"
              inputMode="numeric"
              min="5"
              max="240"
              step="5"
              value={intervalMin}
              onChange={(event) => setIntervalMin(event.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="water-active-start">
                活跃时段开始
              </label>
              <input
                id="water-active-start"
                className="input"
                type="time"
                value={activeStart}
                onChange={(event) => setActiveStart(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="water-active-end">
                活跃时段结束
              </label>
              <input
                id="water-active-end"
                className="input"
                type="time"
                value={activeEnd}
                onChange={(event) => setActiveEnd(event.target.value)}
              />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
