import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-tests",
      appSecret: "test-secret-with-at-least-thirty-two-characters",
      appBaseUrl: "http://localhost:3000",
      isProduction: false,
      ...config,
    },
    startScheduler: false,
  });
  const setup = await built.app.inject({
    method: "POST",
    url: "/api/v1/setup",
    payload: {
      token: built.services.auth.setupToken,
      username: "admin",
      password: "very-secure-test-password",
    },
  });
  expect(setup.statusCode).toBe(200);
  const cookieHeader = setup.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
  const context = {
    ...built,
    request: (options: InjectOptions) => built.app.inject({
      ...options,
      headers: {
        cookie,
        ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
        ...options.headers,
      },
    }),
  };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  while (contexts.length) await contexts.pop()!.app.close();
});

type AuthApp = FastifyInstance;

async function createPasswordEditor(context: TestContext, username: string) {
  const password = "very-secure-editor-password";
  const created = await context.request({
    method: "POST",
    url: "/api/v1/users",
    payload: { username, role: "editor", loginMode: "password", password },
  });
  expect(created.statusCode).toBe(201);
  return created.json<{ user: { id: string; version: number } }>();
}

async function loginAs(app: AuthApp, username: string, password: string) {
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password },
  });
  expect(login.statusCode).toBe(200);
  const cookieHeader = login.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
  return (options: InjectOptions) => app.inject({
    ...options,
    headers: {
      cookie,
      ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
      ...options.headers,
    },
  } as InjectOptions);
}

async function createTokenEditor(context: TestContext, username: string) {
  const created = await context.request({
    method: "POST",
    url: "/api/v1/users",
    payload: {
      username,
      role: "editor",
      loginMode: "token",
      tokenName: "删除测试 Token",
      tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  expect(created.statusCode).toBe(201);
  return created.json<{ user: { id: string; version: number }; accessToken: { token: string } }>();
}

describe("account deletion API", () => {
  it("hard-deletes an editor and revokes its session and access token", async () => {
    const context = await createContext();
    const { user } = await createPasswordEditor(context, "delete-me");
    const editorRequest = await loginAs(context.app, "delete-me", "very-secure-editor-password");
    const { user: tokenUser, accessToken } = await createTokenEditor(context, "token-delete-me");
    const tokenRequest = (options: InjectOptions) => context.app.inject({
      ...options,
      headers: { authorization: `Bearer ${accessToken.token}`, ...options.headers },
    });

    // 删除前：会话与 Token 均可用。
    expect((await editorRequest({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(200);
    expect((await tokenRequest({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(200);

    const removed = await context.request({
      method: "DELETE",
      url: `/api/v1/users/${user.id}?version=${user.version}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ deleted: true });

    const removedTokenUser = await context.request({
      method: "DELETE",
      url: `/api/v1/users/${tokenUser.id}?version=${tokenUser.version}`,
    });
    expect(removedTokenUser.statusCode).toBe(200);

    const users = await context.request({ method: "GET", url: "/api/v1/users" });
    expect(users.json<Array<{ id: string }>>().some((item) => item.id === user.id)).toBe(false);
    expect(users.json<Array<{ id: string }>>().some((item) => item.id === tokenUser.id)).toBe(false);

    // 级联撤销：会话 cookie 与 Bearer Token 全部失效。
    expect((await editorRequest({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(401);
    expect((await tokenRequest({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(401);

    const remaining = context.database.sqlite
      .prepare("SELECT (SELECT COUNT(*) FROM sessions WHERE user_id = ?) AS sessions, (SELECT COUNT(*) FROM access_tokens WHERE user_id = ?) AS tokens")
      .get(user.id, tokenUser.id) as { sessions: number; tokens: number };
    expect(remaining).toEqual({ sessions: 0, tokens: 0 });
    // 管理员自己的会话不受影响。
    expect((context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count).toBe(1);
    context.app.close();
  });

  it("rejects non-administrators, administrators, self-deletion and unknown users", async () => {
    const context = await createContext();
    const { user: editor } = await createPasswordEditor(context, "guard-editor");
    const editorRequest = await loginAs(context.app, "guard-editor", "very-secure-editor-password");
    const admin = (await context.request({ method: "GET", url: "/api/v1/users" })).json<Array<{ id: string; role: string }>>()
      .find((item) => item.role === "admin")!;

    // 非管理员尝试删除 → 403。
    const forbidden = await editorRequest({
      method: "DELETE",
      url: `/api/v1/users/${editor.id}?version=${editor.version}`,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");

    // 删除管理员 → 400。
    const deleteAdmin = await context.request({
      method: "DELETE",
      url: `/api/v1/users/${admin.id}?version=${admin.version}`,
    });
    expect(deleteAdmin.statusCode).toBe(400);
    expect(deleteAdmin.json<{ code: string }>().code).toBe("ACCOUNT_DELETE_FORBIDDEN");

    // 不存在的用户 → 404。
    const missing = await context.request({
      method: "DELETE",
      url: `/api/v1/users/00000000-0000-4000-8000-000000000000?version=1`,
    });
    expect(missing.statusCode).toBe(404);

    // 版本过期 → 409（先停用一次让 version +1）。
    const disabled = await context.request({
      method: "PATCH",
      url: `/api/v1/users/${editor.id}`,
      payload: { disabled: true, version: editor.version },
    });
    expect(disabled.statusCode).toBe(200);
    const stale = await context.request({
      method: "DELETE",
      url: `/api/v1/users/${editor.id}?version=${editor.version}`,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe("VERSION_CONFLICT");
    context.app.close();
  });

  it("leaves business data untouched when an account is deleted", async () => {
    const context = await createContext();
    const { user } = await createPasswordEditor(context, "data-owner");
    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: {
        title: "删除不影响计划",
        description: "账户删除不需要动业务数据",
        status: "pending",
        startAt: new Date(Date.now() + 3_600_000).toISOString(),
        endAt: new Date(Date.now() + 7_200_000).toISOString(),
        customFields: {},
      },
    });
    expect(created.statusCode).toBe(201);
    const plansBefore = (context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM work_plans").get() as { count: number }).count;

    const removed = await context.request({
      method: "DELETE",
      url: `/api/v1/users/${user.id}?version=${user.version}`,
    });
    expect(removed.statusCode).toBe(200);
    const plansAfter = (context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM work_plans").get() as { count: number }).count;
    expect(plansAfter).toBe(plansBefore);
    context.app.close();
  });
});
