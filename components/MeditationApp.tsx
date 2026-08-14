"use client";

import { useState } from "react";

import FocusTimer from "./FocusTimer";
import TodaySummary from "./TodaySummary";

export default function MeditationApp() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="app-shell">
      <div className="tool-header">
        <h2 className="tool-title">冥想</h2>
      </div>
      <div className="focus-grid">
        <FocusTimer
          kind="meditation"
          defaultMinutes={20}
          minMinutes={5}
          maxMinutes={90}
          title="冥想计时"
          onCompleted={() => setRefreshKey((key) => key + 1)}
        />
        <div className="focus-side">
          <TodaySummary kind="meditation" refreshKey={refreshKey} />
        </div>
      </div>
    </main>
  );
}
