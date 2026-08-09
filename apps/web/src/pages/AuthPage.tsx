import { useState, type FormEvent } from "react";
import { CalendarRange, KeyRound, LockKeyhole, UserRound } from "lucide-react";
import type { User } from "../App";
import { api, ApiError, jsonBody } from "../lib/api";

type Props = {
  setupRequired: boolean;
  setupTokenExpiresAt: string | null;
  onAuthenticated: (user: User, csrfToken: string) => void;
};

export default function AuthPage({ setupRequired, setupTokenExpiresAt, onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = setupRequired
        ? await api<{ user: Props["onAuthenticated"] extends (user: infer U, csrf: string) => void ? U : never; csrfToken: string }>("/setup", {
            method: "POST",
            ...jsonBody({ token, username, password }),
          })
        : await api<{ user: Props["onAuthenticated"] extends (user: infer U, csrf: string) => void ? U : never; csrfToken: string }>("/auth/login", {
            method: "POST",
            ...jsonBody({ username, password }),
          });
      onAuthenticated(result.user, result.csrfToken);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-intro">
        <div className="auth-brand"><span className="brand-mark">工</span><strong>工作计划</strong></div>
        <div>
          <CalendarRange aria-hidden="true" />
          <h1>把计划放到时间轴上</h1>
          <p>在一个清晰的工作台中安排、调整并跟进每一项工作计划。</p>
        </div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit} className="auth-form">
          <h2>{setupRequired ? "初始化管理员" : "欢迎回来"}</h2>
          <p>{setupRequired ? "输入容器日志中的一次性令牌，建立唯一管理员账户。" : "登录后继续管理你的工作计划。"}</p>
          {setupRequired ? (
            <label>
              <span>一次性初始化令牌</span>
              <div className="input-with-icon"><KeyRound /><input value={token} onChange={(event) => setToken(event.target.value)} required autoComplete="one-time-code" /></div>
              {setupTokenExpiresAt ? <small>令牌有效至 {new Date(setupTokenExpiresAt).toLocaleTimeString("zh-CN")}</small> : null}
            </label>
          ) : null}
          <label>
            <span>用户名</span>
            <div className="input-with-icon"><UserRound /><input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" /></div>
          </label>
          <label>
            <span>密码</span>
            <div className="input-with-icon"><LockKeyhole /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={setupRequired ? 12 : 1} autoComplete={setupRequired ? "new-password" : "current-password"} /></div>
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary-button full-width" type="submit" disabled={submitting}>{submitting ? "请稍候…" : setupRequired ? "完成初始化" : "登录"}</button>
        </form>
      </section>
    </main>
  );
}
