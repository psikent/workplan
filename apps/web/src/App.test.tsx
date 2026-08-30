// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { AuthenticatedRoutes } from "./App";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/api")>()),
  api: apiMock,
}));

vi.mock("./pages/WorkPlansPage", () => ({ default: () => <div data-testid="work-plans-page" /> }));
vi.mock("./pages/OverviewPage", () => ({ default: () => <div data-testid="overview-page" /> }));
vi.mock("./pages/MonthlyGoalsPage", () => ({ default: () => <div data-testid="monthly-goals-page" /> }));
vi.mock("./pages/SettingsPage", async () => {
  const { useLocation, useSearchParams } = await import("react-router-dom");
  return {
    default: () => {
      const location = useLocation();
      const tab = useSearchParams()[0].get("tab") ?? "";
      return <div data-testid="settings-page" data-path={location.pathname} data-tab={tab} />;
    },
  };
});

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

function renderAuthenticatedRoutes(role: "admin" | "editor" | "viewer", initialEntry: string) {
  const router = createMemoryRouter([{ path: "*", element: <AuthenticatedRoutes role={role} /> }], { initialEntries: [initialEntry] });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: () => view.unmount() };
}

describe("authenticated routes", () => {
  it("redirects administrators from /custom-fields to the environment tab with replace", async () => {
    const { router, unmount } = renderAuthenticatedRoutes("admin", "/custom-fields");
    expect(await screen.findByTestId("settings-page")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/settings");
    expect(router.state.location.search).toBe("?tab=environment");
    expect(router.state.historyAction).toBe("REPLACE");
    unmount();
  });

  it("redirects administrators from /accounts to the accounts tab with replace", async () => {
    const { router, unmount } = renderAuthenticatedRoutes("admin", "/accounts");
    expect(await screen.findByTestId("settings-page")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/settings");
    expect(router.state.location.search).toBe("?tab=accounts");
    expect(router.state.historyAction).toBe("REPLACE");
    unmount();
  });

  it("sends non-administrators from the legacy admin addresses to work plans", async () => {
    for (const role of ["editor", "viewer"] as const) {
      for (const legacyPath of ["/custom-fields", "/accounts", "/settings"]) {
        const { router, unmount } = renderAuthenticatedRoutes(role, legacyPath);
        expect(await screen.findByTestId("work-plans-page")).toBeTruthy();
        expect(router.state.location.pathname).toBe("/work-plans");
        unmount();
      }
    }
  });

  it("keeps administrators on /settings for a valid tab query parameter", async () => {
    const { router, unmount } = renderAuthenticatedRoutes("admin", "/settings?tab=push");
    const settings = await screen.findByTestId("settings-page");
    expect(settings.getAttribute("data-tab")).toBe("push");
    expect(router.state.historyAction).toBe("POP");
    unmount();
  });
});
