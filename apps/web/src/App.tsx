import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, setCsrfToken } from "./lib/api";
import AppShell from "./components/AppShell";
import AuthPage from "./pages/AuthPage";

const WorkPlansPage = lazy(() => import("./pages/WorkPlansPage"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const CustomFieldsPage = lazy(() => import("./pages/CustomFieldsPage"));
const AccountManagementPage = lazy(() => import("./pages/AccountManagementPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

export type User = {
  id: string;
  username: string;
  role: "admin" | "editor";
  loginMode: "password" | "token";
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

type BootstrapState =
  | { status: "loading" }
  | { status: "anonymous"; setupRequired: boolean; setupTokenExpiresAt: string | null }
  | { status: "authenticated"; user: User };

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

  if (state.status === "loading") {
    return (
      <main className="boot-screen" aria-live="polite">
        <div className="brand-mark">工</div>
        <p>正在载入工作计划…</p>
      </main>
    );
  }

  if (state.status === "anonymous") {
    return (
      <AuthPage
        setupRequired={state.setupRequired}
        setupTokenExpiresAt={state.setupTokenExpiresAt}
        onAuthenticated={(user, csrf) => {
          setCsrfToken(csrf);
          setState({ status: "authenticated", user });
        }}
      />
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <AppShell>
        <Suspense fallback={<div className="page-loading">正在载入…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/work-plans" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/work-plans" element={<WorkPlansPage />} />
            <Route path="/custom-fields" element={state.user.role === "admin" ? <CustomFieldsPage /> : <Navigate to="/work-plans" replace />} />
            <Route path="/accounts" element={state.user.role === "admin" ? <AccountManagementPage /> : <Navigate to="/work-plans" replace />} />
            <Route path="/settings" element={state.user.role === "admin" ? <SettingsPage /> : <Navigate to="/work-plans" replace />} />
            <Route path="*" element={<Navigate to="/work-plans" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
    </SessionContext.Provider>
  );
}
