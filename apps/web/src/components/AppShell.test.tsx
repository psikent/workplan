// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell";

let systemThemeIsDark = false;
const systemThemeListeners = new Set<(event: MediaQueryListEvent) => void>();

const matchMediaMock = vi.fn((query: string) => ({
  matches: query === "(prefers-color-scheme: dark)" && systemThemeIsDark,
  media: query,
  onchange: null,
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => systemThemeListeners.add(listener),
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => systemThemeListeners.delete(listener),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

const sessionMock = vi.hoisted(() => ({
  user: { username: "lxj", role: "admin" as "admin" | "editor", loginMode: "password" as "password" | "token" },
  signOut: vi.fn(),
}));

vi.mock("../App", () => ({
  useSession: () => ({ user: sessionMock.user, signOut: sessionMock.signOut }),
}));

beforeEach(() => {
  sessionMock.user = { username: "lxj", role: "admin", loginMode: "password" };
  systemThemeIsDark = false;
  systemThemeListeners.clear();
  vi.stubGlobal("matchMedia", matchMediaMock);
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
  sessionMock.signOut.mockReset();
});

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/work-plans"]}>
      <AppShell><div>页面内容</div></AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell navigation", () => {
  it("switches and persists the color theme", () => {
    const firstRender = renderShell();
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "切换到深色模式" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeTruthy();
    expect(localStorage.getItem("workplan:theme:v1")).toContain('"preference":"dark"');

    firstRender.unmount();
    const secondRender = renderShell();
    expect(document.documentElement.dataset.theme).toBe("dark");
    secondRender.unmount();
  });

  it("follows system appearance changes while automatic mode is enabled", () => {
    const view = renderShell();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("switch", { name: "自动跟随系统主题" }).getAttribute("aria-checked")).toBe("true");

    systemThemeIsDark = true;
    act(() => {
      systemThemeListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("workplan:theme:v1")).toContain('"preference":"system"');
    view.unmount();
  });

  it("can disable automatic mode while preserving the current theme", () => {
    const view = renderShell();
    const automaticMode = screen.getByRole("switch", { name: "自动跟随系统主题" });

    fireEvent.click(automaticMode);
    expect(automaticMode.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("workplan:theme:v1")).toContain('"preference":"light"');
    view.unmount();
  });

  it("collapses, restores and persists the sidebar", () => {
    const firstRender = renderShell();
    const shell = firstRender.container.querySelector(".app-shell")!;

    expect(shell.classList.contains("sidebar-collapsed")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "收起导航" }));
    expect(shell.classList.contains("sidebar-collapsed")).toBe(true);
    expect(screen.getByRole("button", { name: "展开导航" }).getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("workplan:sidebar:v1")).toContain('"collapsed":true');

    firstRender.unmount();
    const secondRender = renderShell();
    const restoredShell = secondRender.container.querySelector(".app-shell")!;
    expect(restoredShell.classList.contains("sidebar-collapsed")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "展开导航" }));
    expect(restoredShell.classList.contains("sidebar-collapsed")).toBe(false);
    secondRender.unmount();
  });

  it("shows the real role and hides administrator navigation from editors", () => {
    sessionMock.user = { username: "测试", role: "editor", loginMode: "password" };
    const view = renderShell();

    expect(screen.getByText("编辑者")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "自定义字段" })).toBeNull();
    expect(screen.queryByRole("link", { name: "账户管理" })).toBeNull();
    expect(screen.queryByRole("link", { name: "设置" })).toBeNull();
    expect(screen.getByRole("link", { name: "工作计划" })).toBeTruthy();
    view.unmount();
  });

  it("gives administrators a dedicated account management entry", () => {
    const view = renderShell();

    expect(screen.getByRole("link", { name: "账户管理" }).getAttribute("href")).toBe("/accounts");
    view.unmount();
  });

  it("shows an explicit account sign-out action and invokes it", () => {
    const view = renderShell();

    fireEvent.click(screen.getByText("退出登录"));
    expect(sessionMock.signOut).toHaveBeenCalledOnce();
    view.unmount();
  });
});
