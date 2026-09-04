import { useEffect, useState, type ReactNode } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, MonitorCog, Moon, Settings, Sun, Target, WifiOff } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useSession } from "../App";
import { useOnline } from "../lib/useOnline";
import { roleLabel } from "../lib/permissions";
import { applyTheme, loadThemePreference, themePreferenceKey, useSystemTheme, type ThemePreference } from "../lib/theme";
import BrandMark from "./BrandMark";

const navItems = [
  { to: "/overview", label: "工作台", icon: LayoutDashboard, end: true, adminOnly: false },
  { to: "/work-plans", label: "工作计划", icon: CalendarRange, end: true, adminOnly: false },
  { to: "/monthly-goals", label: "月目标", icon: Target, end: true, adminOnly: false },
  { to: "/settings", label: "设置", icon: Settings, end: false, adminOnly: true },
] as const;

const sidebarPreferenceKey = "workplan:sidebar:v1";

function loadSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    const saved = JSON.parse(window.localStorage.getItem(sidebarPreferenceKey) ?? "null") as unknown;
    return Boolean(saved && typeof saved === "object" && (saved as { version?: unknown }).version === 1 && (saved as { collapsed?: unknown }).collapsed === true);
  } catch {
    return false;
  }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const online = useOnline();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const systemTheme = useSystemTheme();
  const activeTheme = themePreference === "system" ? systemTheme : themePreference;
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user.role === "admin");

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarPreferenceKey, JSON.stringify({ version: 1, collapsed: sidebarCollapsed }));
    } catch {
      // The navigation remains collapsible for this session when storage is unavailable.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    applyTheme(activeTheme);
    try {
      window.localStorage.setItem(themePreferenceKey, JSON.stringify({ version: 1, preference: themePreference }));
    } catch {
      // Theme selection remains active for this session when storage is unavailable.
    }
  }, [activeTheme, themePreference]);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark className="brand-mark" />
          <strong>工作计划</strong>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={`${to}-${label}`}
              to={to}
              aria-label={label}
              title={sidebarCollapsed ? label : undefined}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip" title={user.username}>{user.username.slice(0, 1).toUpperCase()}</div>
          <div className="user-meta"><strong>{user.username}</strong><span>{roleLabel(user.role)}</span></div>
          <button
            className="icon-button theme-toggle"
            type="button"
            aria-label={activeTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            title={activeTheme === "dark" ? "浅色模式" : "深色模式"}
            onClick={() => setThemePreference(activeTheme === "dark" ? "light" : "dark")}
          >
            {activeTheme === "dark" ? <Sun /> : <Moon />}
          </button>
          <button
            className={`icon-button auto-theme-toggle ${themePreference === "system" ? "active" : ""}`}
            type="button"
            role="switch"
            aria-checked={themePreference === "system"}
            aria-label="自动跟随系统主题"
            title={themePreference === "system" ? "自动模式已开启" : "自动模式已关闭"}
            onClick={() => setThemePreference(themePreference === "system" ? activeTheme : "system")}
          >
            <MonitorCog aria-hidden="true" />
          </button>
          <button
            className="signout-button"
            type="button"
            onClick={() => void signOut()}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut aria-hidden="true" />
            <span>退出登录</span>
          </button>
        </div>
        <button
          className="sidebar-collapse"
          type="button"
          aria-label={sidebarCollapsed ? "展开导航" : "收起导航"}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
          <span>{sidebarCollapsed ? "展开导航" : "收起导航"}</span>
        </button>
      </aside>
      <main className="app-main">
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff aria-hidden="true" />
            <span>当前处于离线状态，数据可能不是最新的。</span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
