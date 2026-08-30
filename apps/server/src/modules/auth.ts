import argon2 from "argon2";
import type { LoginMode, ManageableUserRole, UserRole } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import type { AppConfig } from "../config.js";
import { AppError, versionConflict } from "../errors.js";
import { hashToken, newId, nowIso, randomToken } from "../utils.js";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  login_mode: LoginMode;
  disabled_at: string | null;
  version: number;
  created_at: string;
};
type SessionRow = { id: string; user_id: string; csrf_token: string; expires_at: string };

export type AuthContext = {
  kind: "session" | "token";
  userId: string;
  role: UserRole;
  sessionId?: string;
  csrfToken?: string;
};

export class AuthService {
  readonly setupToken = randomToken(32);
  readonly setupExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  constructor(
    private readonly database: DatabaseBundle,
    private readonly config: AppConfig,
  ) {}

  isSetupRequired(): boolean {
    const row = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    return row.count === 0;
  }

  async setup(token: string, username: string, password: string) {
    if (!this.isSetupRequired()) throw new AppError(409, "ALREADY_CONFIGURED", "管理员账户已经初始化");
    if (Date.now() > Date.parse(this.setupExpiresAt) || token !== this.setupToken) {
      throw new AppError(401, "INVALID_SETUP_TOKEN", "初始化令牌无效或已过期，请重启容器生成新令牌");
    }
    const id = newId();
    const createdAt = nowIso();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      this.database.sqlite
        .prepare("INSERT INTO users(id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(id, username, passwordHash, createdAt);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new AppError(409, "USERNAME_EXISTS", "用户名已经存在");
      throw error;
    }
    return { id, username, createdAt };
  }

  async login(username: string, password: string) {
    const user = this.database.sqlite
      .prepare("SELECT id, username, password_hash, role, login_mode, disabled_at, version, created_at FROM users WHERE username = ?")
      .get(username) as UserRow | undefined;
    if (!user || user.disabled_at || user.login_mode !== "password" || !(await argon2.verify(user.password_hash, password))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
    }
    const session = this.createSession(user.id);
    return { user: this.toUser(user), ...session };
  }

  createSession(userId: string) {
    const id = newId();
    const token = randomToken();
    const csrfToken = randomToken(24);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + this.config.sessionDays * 86_400_000).toISOString();
    this.database.sqlite
      .prepare("INSERT INTO sessions(id, user_id, token_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, userId, hashToken(token), csrfToken, expiresAt, createdAt);
    return { token, csrfToken, expiresAt };
  }

  authenticateSession(token: string): AuthContext | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT sessions.id, sessions.user_id, sessions.csrf_token, sessions.expires_at, users.role
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND users.disabled_at IS NULL
      `)
      .get(hashToken(token)) as (SessionRow & { role: UserRole }) | undefined;
    if (!row || Date.parse(row.expires_at) <= Date.now()) {
      if (row) this.database.sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
      return null;
    }
    return { kind: "session", userId: row.user_id, role: row.role, sessionId: row.id, csrfToken: row.csrf_token };
  }

  authenticateAccessToken(token: string): AuthContext | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT access_tokens.id, access_tokens.user_id, access_tokens.expires_at, users.role
        FROM access_tokens
        JOIN users ON users.id = access_tokens.user_id
        WHERE access_tokens.token_hash = ? AND users.disabled_at IS NULL
      `)
      .get(hashToken(token)) as { id: string; user_id: string; expires_at: string | null; role: UserRole } | undefined;
    if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
    this.database.sqlite.prepare("UPDATE access_tokens SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
    return { kind: "token", userId: row.user_id, role: row.role };
  }

  getUser(userId: string) {
    const user = this.database.sqlite
      .prepare("SELECT id, username, password_hash, role, login_mode, disabled_at, version, created_at FROM users WHERE id = ?")
      .get(userId) as UserRow | undefined;
    return user ? this.toUser(user) : undefined;
  }

  async createPasswordUser(input: { username: string; role: ManageableUserRole; password: string }) {
    const id = newId();
    const createdAt = nowIso();
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      this.database.sqlite
        .prepare("INSERT INTO users(id, username, password_hash, role, login_mode, disabled_at, version, created_at) VALUES (?, ?, ?, ?, 'password', NULL, 1, ?)")
        .run(id, input.username, passwordHash, input.role, createdAt);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new AppError(409, "USERNAME_EXISTS", "用户名已经存在");
      throw error;
    }
    return {
      user: { id, username: input.username, role: input.role, loginMode: "password" as const, disabledAt: null, version: 1, createdAt },
    };
  }

  async createTokenOnlyUser(input: { username: string; role: ManageableUserRole; tokenName: string; tokenExpiresAt: string }) {
    const id = newId();
    const createdAt = nowIso();
    const passwordHash = await argon2.hash(randomToken(), { type: argon2.argon2id });
    const create = this.database.sqlite.transaction(() => {
      try {
        this.database.sqlite
          .prepare("INSERT INTO users(id, username, password_hash, role, login_mode, disabled_at, version, created_at) VALUES (?, ?, ?, ?, 'token', NULL, 1, ?)")
          .run(id, input.username, passwordHash, input.role, createdAt);
      } catch (error) {
        if (String(error).includes("UNIQUE")) throw new AppError(409, "USERNAME_EXISTS", "用户名已经存在");
        throw error;
      }
      return this.createAccessToken(id, input.tokenName, input.tokenExpiresAt);
    });
    const accessToken = create();
    return {
      user: { id, username: input.username, role: input.role, loginMode: "token" as const, disabledAt: null, version: 1, createdAt },
      accessToken,
    };
  }

  async setUserPassword(userId: string, password: string, version: number) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const update = this.database.sqlite.transaction(() => {
      const user = this.database.sqlite
        .prepare("SELECT role FROM users WHERE id = ?")
        .get(userId) as { role: UserRole } | undefined;
      if (!user) throw new AppError(404, "NOT_FOUND", "用户不存在");
      if (user.role === "admin") throw new AppError(422, "ADMIN_PASSWORD_IMMUTABLE", "不能在这里修改管理员密码");

      const result = this.database.sqlite
        .prepare("UPDATE users SET password_hash = ?, login_mode = 'password', version = version + 1 WHERE id = ? AND version = ?")
        .run(passwordHash, userId, version);
      if (result.changes === 0) throw versionConflict();
      this.database.sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      return this.listUsers().find((item) => item.id === userId)!;
    });
    return update();
  }

  listUsers() {
    const users = this.database.sqlite
      .prepare("SELECT id, username, password_hash, role, login_mode, disabled_at, version, created_at FROM users ORDER BY created_at, id")
      .all() as UserRow[];
    const tokens = this.database.sqlite
      .prepare("SELECT id, user_id, name, expires_at AS expiresAt, last_used_at AS lastUsedAt, created_at AS createdAt, version FROM access_tokens ORDER BY created_at DESC")
      .all() as Array<{
        id: string;
        user_id: string;
        name: string;
        expiresAt: string | null;
        lastUsedAt: string | null;
        createdAt: string;
        version: number;
      }>;
    const tokensByUser = new Map<string, typeof tokens>();
    for (const token of tokens) {
      const userTokens = tokensByUser.get(token.user_id) ?? [];
      userTokens.push(token);
      tokensByUser.set(token.user_id, userTokens);
    }
    return users.map((user) => ({
      ...this.toUser(user),
      tokens: (tokensByUser.get(user.id) ?? []).map(({ user_id: _userId, ...token }) => token),
    }));
  }

  createAccessTokenForUser(userId: string, name: string, expiresAt: string | null) {
    const user = this.database.sqlite
      .prepare("SELECT disabled_at FROM users WHERE id = ?")
      .get(userId) as { disabled_at: string | null } | undefined;
    if (!user) throw new AppError(404, "NOT_FOUND", "用户不存在");
    if (user.disabled_at) throw new AppError(409, "USER_DISABLED", "停用账户不能签发 Token");
    return this.createAccessToken(userId, name, expiresAt);
  }

  revokeAccessTokenForUser(userId: string, id: string, version: number): void {
    const result = this.database.sqlite
      .prepare("DELETE FROM access_tokens WHERE id = ? AND user_id = ? AND version = ?")
      .run(id, userId, version);
    if (result.changes === 0) throw versionConflict();
  }

  setUserDisabled(userId: string, disabled: boolean, version: number) {
    const update = this.database.sqlite.transaction(() => {
      const user = this.database.sqlite
        .prepare("SELECT role FROM users WHERE id = ?")
        .get(userId) as { role: UserRole } | undefined;
      if (!user) throw new AppError(404, "NOT_FOUND", "用户不存在");
      if (user.role === "admin") throw new AppError(422, "ADMIN_STATUS_IMMUTABLE", "管理员账户不能停用");

      const result = this.database.sqlite
        .prepare("UPDATE users SET disabled_at = ?, version = version + 1 WHERE id = ? AND version = ?")
        .run(disabled ? nowIso() : null, userId, version);
      if (result.changes === 0) throw versionConflict();
      if (disabled) {
        this.database.sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
        this.database.sqlite.prepare("DELETE FROM access_tokens WHERE user_id = ?").run(userId);
      }
      return this.listUsers().find((item) => item.id === userId)!;
    });
    return update();
  }

  /** 硬删除非管理员账户（D1/D2）：sessions/access_tokens 由 ON DELETE CASCADE 级联撤销。 */
  deleteManagedUser(userId: string, version: number, actorId: string): void {
    const user = this.database.sqlite
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(userId) as { role: UserRole } | undefined;
    if (!user) throw new AppError(404, "NOT_FOUND", "用户不存在");
    if (user.role === "admin") throw new AppError(400, "ACCOUNT_DELETE_FORBIDDEN", "管理员账户不能删除");
    if (userId === actorId) throw new AppError(400, "ACCOUNT_DELETE_FORBIDDEN", "不能删除当前登录账户");
    const result = this.database.sqlite
      .prepare("DELETE FROM users WHERE id = ? AND version = ?")
      .run(userId, version);
    if (result.changes === 0) throw versionConflict();
  }

  logout(sessionId: string | undefined): void {
    if (sessionId) this.database.sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  listTokens(userId: string) {
    return this.database.sqlite
      .prepare("SELECT id, name, expires_at AS expiresAt, last_used_at AS lastUsedAt, created_at AS createdAt, version FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId);
  }

  createAccessToken(userId: string, name: string, expiresAt: string | null) {
    const id = newId();
    const secret = randomToken();
    const token = `wp_${secret}`;
    const createdAt = nowIso();
    this.database.sqlite
      .prepare("INSERT INTO access_tokens(id, user_id, name, token_hash, expires_at, created_at, version) VALUES (?, ?, ?, ?, ?, ?, 1)")
      .run(id, userId, name, hashToken(token), expiresAt, createdAt);
    return { id, name, token, expiresAt, createdAt, version: 1 };
  }

  revokeAccessToken(userId: string, id: string, version: number): void {
    this.revokeAccessTokenForUser(userId, id, version);
  }

  cleanupExpired(): void {
    const now = nowIso();
    this.database.sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.database.sqlite.prepare("DELETE FROM access_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
  }

  private toUser(user: UserRow) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      loginMode: user.login_mode,
      disabledAt: user.disabled_at,
      version: user.version,
      createdAt: user.created_at,
    };
  }
}
