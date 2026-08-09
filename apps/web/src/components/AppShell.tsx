import { useEffect, useState, type ReactNode } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Moon, Settings, SlidersHorizontal, Sun, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useSession } from "../App";

const navItems = [
  { to: "/overview", label: "工作台", icon: LayoutDashboard, end: true, adminOnly: false },
  { to: "/work-plans", label: "工作计划", icon: CalendarRange, end: true, adminOnly: false },
  { to: "/custom-fields", label: "自定义字段", icon: SlidersHorizontal, end: false, adminOnly: true },
  { to: "/accounts", label: "账户管理", icon: UsersRound, end: true, adminOnly: true },
  { to: "/settings", label: "设置", icon: Settings, end: false, adminOnly: true },
] as const;

const sidebarPreferenceKey = "workplan:sidebar:v1";
const themePreferenceKey = "workplan:theme:v1";
type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

function loadSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    const saved = JSON.parse(window.localStorage.getItem(sidebarPreferenceKey) ?? "null") as unknown;
    return Boolean(saved && typeof saved === "object" && (saved as { version?: unknown }).version === 1 && (saved as { collapsed?: unknown }).collapsed === true);
  } catch {
    return false;
  }
}

function loadThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const saved = JSON.parse(window.localStorage.getItem(themePreferenceKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object" || (saved as { version?: unknown }).version !== 1) return "system";
    const preference = (saved as { preference?: unknown }).preference;
    return preference === "light" || preference === "dark" || preference === "system" ? preference : "system";
  } catch {
    return "system";
  }
}

function getSystemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);
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
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.colorScheme = activeTheme;
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
          <span className="brand-mark">工</span>
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
          <div className="user-meta"><strong>{user.username}</strong><span>{user.role === "admin" ? "管理员" : "编辑者"}</span></div>
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
      <main className="app-main">{children}</main>
    </div>
  );
}
