"use client";

import { useEffect, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Droplets,
  Flower2,
  History,
  Timer,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import BookkeepingApp from "./BookkeepingApp";
import MeditationApp from "./MeditationApp";
import FocusApp from "./FocusApp";
import RecordsApp from "./RecordsApp";
import WaterApp from "./WaterApp";

type Tool = "bookkeeping" | "meditation" | "pomodoro" | "records" | "water";

const tabs: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: "bookkeeping", label: "记账", icon: Wallet },
  { id: "meditation", label: "冥想", icon: Flower2 },
  { id: "pomodoro", label: "专注时间", icon: Timer },
  { id: "records", label: "记录", icon: History },
  { id: "water", label: "喝水", icon: Droplets },
];

const SIDEBAR_KEY = "toolbox-sidebar-collapsed";

export default function AppShell() {
  const [tool, setTool] = useState<Tool>("records");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_KEY) === "1") {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="app-frame">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <div className="sidebar-head">
          <span className="brand-icon">
            <Wallet size={20} />
          </span>
          {!collapsed && (
            <div className="brand-copy">
              <h1>私人工具箱</h1>
              <p>个人工具集合</p>
            </div>
          )}
        </div>
        <button
          className="btn-icon sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
        <nav className="sidebar-nav" aria-label="工具切换">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`sidebar-tab${tool === tab.id ? " active" : ""}`}
                onClick={() => setTool(tab.id)}
                title={collapsed ? tab.label : undefined}
              >
                <Icon size={16} />
                {!collapsed && <span>{tab.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="app-main">
        {tool === "bookkeeping" && <BookkeepingApp />}
        {tool === "meditation" && <MeditationApp />}
        {tool === "pomodoro" && <FocusApp />}
        {tool === "records" && <RecordsApp />}
        {tool === "water" && <WaterApp />}
      </div>
    </div>
  );
}
