// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/api")>()),
  api: apiMock,
}));

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

beforeEach(() => {
  systemThemeIsDark = false;
  systemThemeListeners.clear();
  vi.stubGlobal("matchMedia", matchMediaMock);
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
  apiMock.mockReset();
  apiMock.mockImplementation((url: string) =>
    url === "/auth/me"
      ? Promise.reject(new Error("no session"))
      : Promise.resolve({ setupRequired: false, setupTokenExpiresAt: null }),
  );
});

async function renderLoginScreen() {
  const view = render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "登录" })).toBeTruthy());
  return view;
}

describe("login screen theme", () => {
  it("renders in the light theme by default", async () => {
    const view = await renderLoginScreen();
    expect(document.documentElement.dataset.theme).toBe("light");
    view.unmount();
  });

  it("renders in dark mode when the operating system is dark", async () => {
    systemThemeIsDark = true;
    const view = await renderLoginScreen();
    expect(document.documentElement.dataset.theme).toBe("dark");
    view.unmount();
  });

  it("follows operating system theme changes automatically", async () => {
    const view = await renderLoginScreen();
    expect(document.documentElement.dataset.theme).toBe("light");

    systemThemeIsDark = true;
    act(() => {
      systemThemeListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });
    expect(document.documentElement.dataset.theme).toBe("dark");

    systemThemeIsDark = false;
    act(() => {
      systemThemeListeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    view.unmount();
  });
});
