import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { LoginMode, UserRole } from "@workplan/contracts";
import { api, setCsrfToken } from "./lib/api";
import { applyTheme, useSystemTheme } from "./lib/theme";
import AppShell from "./components/AppShell";
import AuthPage from "./pages/AuthPage";
import BrandMark from "./components/BrandMark";
import { settingsPath } from "./pages/settings/tabs";

const WorkPlansPage = lazy(() => import("./pages/WorkPlansPage"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const MonthlyGoalsPage = lazy(() => import("./pages/MonthlyGoalsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

export type User = {
  id: string;
  username: string;
  role: UserRole;
  loginMode: LoginMode;
  disabledAt: string | null;
  version: number;
  createdAt: string;
};
type SessionContextValue = {
  user: User;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session context is unavailable");
  return value;
}

export function AuthenticatedRoutes({ role }: { role: UserRole }) {
  const isAdmin = role === "admin";
  return (
    <Suspense fallback={<div className="page-loading">正在载入…</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/work-plans" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/work-plans" element={<WorkPlansPage />} />
        <Route path="/monthly-goals" element={<MonthlyGoalsPage />} />
        <Route path="/custom-fields" element={isAdmin ? <Navigate to={settingsPath("environment")} replace /> : <Navigate to="/work-plans" replace />} />
        <Route path="/accounts" element={isAdmin ? <Navigate to={settingsPath("accounts")} replace /> : <Navigate to="/work-plans" replace />} />
        <Route path="/settings" element={isAdmin ? <SettingsPage /> : <Navigate to="/work-plans" replace />} />
        <Route path="*" element={<Navigate to="/work-plans" replace />} />
      </Routes>
    </Suspense>
  );
}

type BootstrapState =
  | { status: "loading" }
  | { status: "anonymous"; setupRequired: boolean; setupTokenExpiresAt: string | null }
  | { status: "authenticated"; user: User };

function SystemTheme({ children }: { children: ReactNode }) {
  const systemTheme = useSystemTheme();
  useEffect(() => {
    applyTheme(systemTheme);
  }, [systemTheme]);
  return <>{children}</>;
}

export default function App() {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ setupRequired: boolean; setupTokenExpiresAt: string | null }>("/setup/status"),
      api<{ user: User; csrfToken: string | null }>("/auth/me").catch(() => null),
    ]).then(([setup, session]) => {
      if (!active) return;
      if (session) {
        setCsrfToken(session.csrfToken);
        setState({ status: "authenticated", user: session.user });
      } else {
        setState({ status: "anonymous", ...setup });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const session = useMemo<SessionContextValue | null>(() => {
    if (state.status !== "authenticated") return null;
    return {
      user: state.user,
      signOut: async () => {
        await api("/auth/logout", { method: "POST" });
        setCsrfToken(null);
        setState({ status: "anonymous", setupRequired: false, setupTokenExpiresAt: null });
      },
    };
  }, [state]);

  let content: ReactNode;
  if (state.status === "loading") {
    content = (
      <main className="boot-screen" aria-live="polite">
        <BrandMark className="brand-mark" />
        <p>正在载入工作计划…</p>
      </main>
    );
  } else if (state.status === "anonymous") {
    content = (
      <AuthPage
        setupRequired={state.setupRequired}
        setupTokenExpiresAt={state.setupTokenExpiresAt}
        onAuthenticated={(user, csrf) => {
          setCsrfToken(csrf);
          setState({ status: "authenticated", user });
        }}
      />
    );
  } else {
    return (
      <SessionContext.Provider value={session}>
        <AppShell>
          <AuthenticatedRoutes role={state.user.role} />
        </AppShell>
      </SessionContext.Provider>
    );
  }

  return <SystemTheme>{content}</SystemTheme>;
}
