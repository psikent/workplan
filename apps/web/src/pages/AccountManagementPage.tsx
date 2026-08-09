import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useToast } from "../components/ToastProvider";
import { api, jsonBody } from "../lib/api";
import { formatDate } from "../lib/format";

type AccessToken = { id: string; name: string; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; version: number };
type ManagedUser = {
  id: string;
  username: string;
  role: "admin" | "editor";
  loginMode: "password" | "token";
  disabledAt: string | null;
  version: number;
  createdAt: string;
  tokens: AccessToken[];
};
type CreatedUser = Omit<ManagedUser, "tokens">;
type CreateEditorInput =
  | { username: string; loginMode: "password"; password: string }
  | { username: string; loginMode: "token"; tokenName: string };

const accessTokenLifetimeMs = 90 * 86_400_000;

export default function AccountManagementPage() {
  return (
    <section className="content-page narrow-page">
      <header className="page-header">
        <div>
          <h1>账户管理</h1>
          <p>集中管理编辑者账户、登录方式和访问 Token。</p>
        </div>
      </header>
      <div className="settings-stack">
        <AccountAccessSettings />
      </div>
    </section>
  );
}

function AccountAccessSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const [username, setUsername] = useState("");
  const [loginMode, setLoginMode] = useState<"password" | "token">("password");
  const [password, setPassword] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [revealedToken, setRevealedToken] = useState<{ username: string; token: string; expiresAt: string | null } | null>(null);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<ManagedUser[]>("/users") });
  const createUser = useMutation({
    mutationFn: (input: CreateEditorInput) => api<{ user: CreatedUser; accessToken?: AccessToken & { token: string } }>("/users", {
      method: "POST",
      ...jsonBody(input.loginMode === "password"
        ? { username: input.username, role: "editor", loginMode: "password", password: input.password }
        : {
            username: input.username,
            role: "editor",
            loginMode: "token",
            tokenName: input.tokenName,
            tokenExpiresAt: new Date(Date.now() + accessTokenLifetimeMs).toISOString(),
          }),
    }),
    onSuccess: async ({ user, accessToken }) => {
      setRevealedToken(accessToken ? { username: user.username, token: accessToken.token, expiresAt: accessToken.expiresAt } : null);
      setUsername("");
      setPassword("");
      setTokenName("");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      showSuccess("编辑者已创建");
    },
  });
  const updateUserStatus = useMutation({
    mutationFn: ({ user, disabled }: { user: ManagedUser; disabled: boolean }) => api<ManagedUser>(`/users/${user.id}`, {
      method: "PATCH",
      ...jsonBody({ disabled, version: user.version }),
    }),
    onSuccess: async (_updatedUser, { disabled }) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      showSuccess(disabled ? "账户已停用" : "账户已启用");
    },
  });
  const issueToken = useMutation({
    mutationFn: ({ user, name }: { user: ManagedUser; name: string }) => api<AccessToken & { token: string }>(`/users/${user.id}/tokens`, {
      method: "POST",
      ...jsonBody({ name, expiresAt: new Date(Date.now() + accessTokenLifetimeMs).toISOString() }),
    }),
    onSuccess: async (accessToken, { user }) => {
      setRevealedToken({ username: user.username, token: accessToken.token, expiresAt: accessToken.expiresAt });
      setTokenDrafts((current) => ({ ...current, [user.id]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      showSuccess("Token 已签发");
    },
  });
  const revokeToken = useMutation({
    mutationFn: ({ user, token }: { user: ManagedUser; token: AccessToken }) => api(`/users/${user.id}/tokens/${token.id}?version=${token.version}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      showSuccess("Token 已撤销");
    },
  });
  const setEditorPassword = useMutation({
    mutationFn: ({ user, password: nextPassword }: { user: ManagedUser; password: string }) => api<ManagedUser>(`/users/${user.id}/password`, {
      method: "PUT",
      ...jsonBody({ password: nextPassword, version: user.version }),
    }),
    onSuccess: async (_user, { user }) => {
      setPasswordDrafts((current) => ({ ...current, [user.id]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      showSuccess("登录密码已保存");
    },
  });

  async function copyRevealedToken() {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken.token);
    showSuccess("Token 已复制");
  }

  function submitUser(event: FormEvent) {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername) return;
    if (loginMode === "password") {
      if (password.length >= 12) createUser.mutate({ username: normalizedUsername, loginMode, password });
      return;
    }
    const normalizedTokenName = tokenName.trim();
    if (normalizedTokenName) createUser.mutate({ username: normalizedUsername, loginMode, tokenName: normalizedTokenName });
  }

  return (
    <section className="settings-section account-access-section">
      <header><div><KeyRound /><span><strong>账户与访问 Token</strong><small>编辑者可使用密码进入 Web 工作台，也可保留仅 Token 的 API 访问方式。</small></span></div></header>
      <form className="account-create-form" onSubmit={submitUser}>
        <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={80} required /></label>
        <label>登录方式<select value={loginMode} onChange={(event) => setLoginMode(event.target.value as "password" | "token")}><option value="password">密码登录</option><option value="token">仅 API Token</option></select></label>
        {loginMode === "password"
          ? <label>初始密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={200} autoComplete="new-password" required /></label>
          : <label>初始 Token 名称<input value={tokenName} onChange={(event) => setTokenName(event.target.value)} maxLength={100} required /></label>}
        <button className="secondary-button" type="submit" disabled={createUser.isPending}><Plus />创建编辑者</button>
      </form>
      {revealedToken ? (
        <div className="token-secret" role="status">
          <strong>{revealedToken.username} 的 Token 仅显示一次：</strong>
          <code>{revealedToken.token}</code>
          <button type="button" onClick={() => void copyRevealedToken()}>复制</button>
          <small>到期时间：{revealedToken.expiresAt ? formatDate(revealedToken.expiresAt, true) : "永不过期"}</small>
        </div>
      ) : null}
      {createUser.error ? <div className="form-error">{createUser.error.message}</div> : null}
      <div className="account-list">
        {users.data?.map((user) => (
          <article className="account-card" key={user.id}>
            <header>
              <span><strong>{user.username}</strong><small>{user.role === "admin" ? "管理员 · 密码登录" : user.loginMode === "password" ? "编辑者 · 密码登录" : "编辑者 · 仅 API Token"}</small></span>
              <span className="account-card-actions">
                <span className={`account-status ${user.disabledAt ? "disabled" : "active"}`}>{user.disabledAt ? "已停用" : "已启用"}</span>
                {user.role === "editor" ? (
                  <button
                    className="text-button"
                    type="button"
                    disabled={updateUserStatus.isPending}
                    aria-label={`${user.disabledAt ? "启用" : "停用"} ${user.username}`}
                    onClick={() => updateUserStatus.mutate({ user, disabled: !user.disabledAt })}
                  >
                    {user.disabledAt ? "启用" : "停用"}
                  </button>
                ) : null}
              </span>
            </header>
            <div className="token-list">
              {user.tokens.map((token) => (
                <div key={token.id}>
                  <span><strong>{token.name}</strong><small>创建于 {formatDate(token.createdAt)}{token.expiresAt ? ` · 到期 ${formatDate(token.expiresAt)}` : " · 永不过期"}{token.lastUsedAt ? ` · 最近使用 ${formatDate(token.lastUsedAt, true)}` : ""}</small></span>
                  <button className="icon-button" type="button" disabled={revokeToken.isPending} aria-label={`撤销 ${user.username} 的 ${token.name}`} onClick={() => revokeToken.mutate({ user, token })}><Trash2 /></button>
                </div>
              ))}
              {user.tokens.length === 0 ? <small className="empty-token-note">尚无有效 Token</small> : null}
            </div>
            {user.role === "editor" ? (
              <form className="account-password-form" onSubmit={(event) => {
                event.preventDefault();
                const nextPassword = passwordDrafts[user.id] ?? "";
                if (nextPassword.length >= 12) setEditorPassword.mutate({ user, password: nextPassword });
              }}>
                <label>{user.loginMode === "password" ? `${user.username} 重置登录密码` : `${user.username} 设置登录密码`}<input type="password" value={passwordDrafts[user.id] ?? ""} onChange={(event) => setPasswordDrafts((current) => ({ ...current, [user.id]: event.target.value }))} minLength={12} maxLength={200} autoComplete="new-password" required /></label>
                <button className="secondary-button" type="submit" disabled={setEditorPassword.isPending}>{user.loginMode === "password" ? "重置密码" : "启用密码登录"}</button>
              </form>
            ) : null}
            {!user.disabledAt ? (
              <form className="account-token-form" onSubmit={(event) => {
                event.preventDefault();
                const name = (tokenDrafts[user.id] ?? "").trim();
                if (name) issueToken.mutate({ user, name });
              }}>
                <label>{user.username} 新 Token 名称<input value={tokenDrafts[user.id] ?? ""} onChange={(event) => setTokenDrafts((current) => ({ ...current, [user.id]: event.target.value }))} maxLength={100} required /></label>
                <button className="secondary-button" type="submit" disabled={issueToken.isPending} aria-label={`为 ${user.username} 签发 Token`}><Plus />签发 Token</button>
              </form>
            ) : null}
          </article>
        ))}
      </div>
      {updateUserStatus.error ? <div className="form-error">{updateUserStatus.error.message}</div> : null}
      {issueToken.error ? <div className="form-error">{issueToken.error.message}</div> : null}
      {revokeToken.error ? <div className="form-error">{revokeToken.error.message}</div> : null}
      {setEditorPassword.error ? <div className="form-error">{setEditorPassword.error.message}</div> : null}
    </section>
  );
}
