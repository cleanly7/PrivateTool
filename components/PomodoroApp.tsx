"use client";

import { useState } from "react";

import FocusTimer from "./FocusTimer";
import TodaySummary from "./TodaySummary";

export default function PomodoroApp() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="app-shell">
      <div className="tool-header">
        <h2 className="tool-title">番茄钟</h2>
      </div>
      <div className="focus-grid">
        <FocusTimer
          kind="pomodoro"
          defaultMinutes={45}
          minMinutes={5}
          maxMinutes={120}
          title="番茄钟"
          onCompleted={() => setRefreshKey((key) => key + 1)}
        />
        <div className="focus-side">
          <TodaySummary kind="pomodoro" refreshKey={refreshKey} />
        </div>
      </div>
    </main>
  );
}
