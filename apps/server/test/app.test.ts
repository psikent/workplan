import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import * as XLSX from "xlsx";
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
  vi.useRealTimers();
  while (contexts.length) await contexts.pop()!.app.close();
});

function exportedFileName(header: unknown): string {
  const value = String(header ?? "");
  const encoded = value.split("filename*=UTF-8''")[1] ?? "";
  return decodeURIComponent(encoded.split(";")[0]!);
}

const planInput = (overrides: Record<string, unknown> = {}) => ({
  title: "官网改版计划",
  description: "完成新版官网的设计与发布",
  status: "pending",
  startAt: new Date(Date.now() + 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 7_200_000).toISOString(),
  customFields: {},
  ...overrides,
});

async function createOwnerField(context: TestContext) {
  const response = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key: "owner",
      label: "工作负责人",
      description: "",
      type: "single_select",
      required: false,
      defaultValue: null,
      options: [
        { value: "fengmingqian", label: "冯铭倩" },
        { value: "linyaqian", label: "林雅茜" },
      ],
    },
  });
  expect(response.statusCode).toBe(201);
}

describe("work plan API", () => {
  it("lists plans by start ascending, end descending, then creation and id as fallback", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-08T00:00:00.000Z"));
    const context = await createContext();
    const inputs = [
      { title: "最晚开始", startAt: "2027-08-09T03:00:00.000Z", endAt: "2027-08-09T07:00:00.000Z" },
      { title: "同起点较早结束", startAt: "2027-08-09T02:00:00.000Z", endAt: "2027-08-09T04:00:00.000Z" },
      { title: "最早开始", startAt: "2027-08-09T01:00:00.000Z", endAt: "2027-08-09T02:00:00.000Z" },
      { title: "同起点较晚结束", startAt: "2027-08-09T02:00:00.000Z", endAt: "2027-08-09T06:00:00.000Z" },
      { title: "同时间单次", startAt: "2027-08-09T02:00:00.000Z", endAt: "2027-08-09T05:00:00.000Z" },
    ];
    for (const input of inputs) {
      const response = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput(input) });
      expect(response.statusCode).toBe(201);
    }
    const recurring = await context.request({
      method: "POST",
      url: "/api/v1/work-plan-series",
      payload: {
        workPlan: planInput({ title: "同时间重复", startAt: "2027-08-09T02:00:00.000Z", endAt: "2027-08-09T05:00:00.000Z" }),
        recurrence: { frequency: "daily", interval: 1, count: 1, timeZone: "Asia/Shanghai" },
      },
    });
    expect(recurring.statusCode).toBe(201);

    const listed = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    // 排期兜底：开始升序、结束降序、创建升序、ID 升序；重复来源不再优先。
    // 冻结时钟下同时间计划 created_at 相同，其相对次序由随机 ID 决定，因此断言集合而非序列。
    const titles = listed.json<Array<{ title: string }>>().map((item) => item.title);

    expect(titles[0]).toBe("最早开始");
    expect(titles[1]).toBe("同起点较晚结束");
    expect(new Set(titles.slice(2, 4))).toEqual(new Set(["同时间单次", "同时间重复"]));
    expect(titles[4]).toBe("同起点较早结束");
    expect(titles[5]).toBe("最晚开始");
  });

  it("derives automatic statuses from time and preserves manual overrides", async () => {
    const context = await createContext();
    const now = Date.now();
    const automaticInput = (overrides: Record<string, unknown>) => {
      const { status: _status, ...input } = planInput(overrides);
      return input;
    };

    const future = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: automaticInput({ title: "未来计划", startAt: new Date(now + 3_600_000).toISOString(), endAt: new Date(now + 7_200_000).toISOString() }),
    });
    const active = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: automaticInput({ title: "进行中计划", startAt: new Date(now - 3_600_000).toISOString(), endAt: new Date(now + 3_600_000).toISOString() }),
    });
    const past = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: automaticInput({ title: "过去计划", startAt: new Date(now - 7_200_000).toISOString(), endAt: new Date(now - 3_600_000).toISOString() }),
    });

    expect(future.json()).toMatchObject({ status: "pending", statusMode: "automatic" });
    expect(active.json()).toMatchObject({ status: "in_progress", statusMode: "automatic" });
    expect(past.json()).toMatchObject({ status: "completed", statusMode: "automatic" });

    const activePlan = active.json<{ id: string; version: number }>();
    const overridden = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${activePlan.id}`,
      payload: { status: "cancelled", version: activePlan.version },
    });
    expect(overridden.json()).toMatchObject({ status: "cancelled", statusMode: "manual" });

    const manualPlan = overridden.json<{ id: string; version: number }>();
    const rescheduled = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${manualPlan.id}/schedule`,
      payload: {
        startAt: new Date(now + 10_000_000).toISOString(),
        endAt: new Date(now + 11_000_000).toISOString(),
        version: manualPlan.version,
      },
    });
    expect(rescheduled.json()).toMatchObject({ status: "cancelled", statusMode: "manual" });

    const rescheduledPlan = rescheduled.json<{ id: string; version: number }>();
    const restored = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${rescheduledPlan.id}`,
      payload: { statusMode: "automatic", version: rescheduledPlan.version },
    });
    expect(restored.json()).toMatchObject({ status: "pending", statusMode: "automatic" });

    const inProgress = await context.request({ method: "GET", url: "/api/v1/work-plans?status=in_progress&limit=500" });
    expect(inProgress.json<Array<{ title: string }>>().map((plan) => plan.title)).not.toContain("进行中计划");
    const pending = await context.request({ method: "GET", url: "/api/v1/work-plans?status=pending&limit=500" });
    expect(pending.json<Array<{ title: string }>>().map((plan) => plan.title)).toContain("进行中计划");
  });

  it("protects private routes and exposes health checks", async () => {
    const { app } = await createContext();
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/work-plans" });
    const health = await app.inject({ method: "GET", url: "/health/ready" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ready", database: "ok" });
  });

  it("derives a read-only owner account and exposes the authenticated mapping list", async () => {
    const context = await createContext();
    await createOwnerField(context);

    const unauthenticated = await context.app.inject({ method: "GET", url: "/api/v1/owner-account-mappings" });
    expect(unauthenticated.statusCode).toBe(401);

    const mappings = await context.request({ method: "GET", url: "/api/v1/owner-account-mappings" });
    expect(mappings.statusCode).toBe(200);
    expect(mappings.json<Array<{ ownerName: string; account: string }>>()).toHaveLength(9);
    expect(mappings.json<Array<{ ownerName: string; account: string }>>()).toContainEqual({
      ownerName: "冯铭倩",
      account: "fengmingqian@zh.gd.csg.cn",
    });

    const mapped = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "已映射负责人", customFields: { owner: "fengmingqian" } }),
    });
    expect(mapped.statusCode).toBe(201);
    expect(mapped.json<{ ownerAccount: string | null }>().ownerAccount).toBe("fengmingqian@zh.gd.csg.cn");

    const unmapped = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "未映射负责人", customFields: { owner: "linyaqian" } }),
    });
    expect(unmapped.statusCode).toBe(201);
    expect(unmapped.json<{ ownerAccount: string | null }>().ownerAccount).toBeNull();

    const editor = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "mapping-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "映射权限测试",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const editorToken = editor.json<{ accessToken: { token: string } }>().accessToken.token;
    const forbidden = await context.app.inject({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { ownerName: "林雅茜", account: "linyaqian@zh.gd.csg.cn" },
    });
    expect(forbidden.statusCode).toBe(403);

    const createdMapping = await context.request({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      payload: { ownerName: " 林雅茜 ", account: " LINYAQIAN@ZH.GD.CSG.CN " },
    });
    expect(createdMapping.statusCode).toBe(201);
    expect(createdMapping.json()).toEqual({ ownerName: "林雅茜", account: "linyaqian@zh.gd.csg.cn" });

    const unmappedPlanId = unmapped.json<{ id: string }>().id;
    const derivedAfterCreate = await context.request({ method: "GET", url: `/api/v1/work-plans/${unmappedPlanId}` });
    expect(derivedAfterCreate.json<{ ownerAccount: string | null }>().ownerAccount).toBe("linyaqian@zh.gd.csg.cn");

    const duplicateOwner = await context.request({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      payload: { ownerName: "林雅茜", account: "another@zh.gd.csg.cn" },
    });
    expect(duplicateOwner.statusCode).toBe(409);
    expect(duplicateOwner.json<{ code: string }>().code).toBe("OWNER_NAME_ALREADY_MAPPED");

    const duplicateAccount = await context.request({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      payload: { ownerName: "另一个负责人", account: "linyaqian@zh.gd.csg.cn" },
    });
    expect(duplicateAccount.statusCode).toBe(409);
    expect(duplicateAccount.json<{ code: string }>().code).toBe("OWNER_ACCOUNT_ALREADY_MAPPED");

    const invalidAccount = await context.request({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      payload: { ownerName: "无效账号", account: "not-an-email" },
    });
    expect(invalidAccount.statusCode).toBe(422);

    const updatedMapping = await context.request({
      method: "PUT",
      url: `/api/v1/owner-account-mappings/${encodeURIComponent("林雅茜")}`,
      payload: { ownerName: "林雅茜", account: "linyaqian.updated@zh.gd.csg.cn" },
    });
    expect(updatedMapping.statusCode).toBe(200);
    expect(updatedMapping.json()).toEqual({ ownerName: "林雅茜", account: "linyaqian.updated@zh.gd.csg.cn" });
    const derivedAfterUpdate = await context.request({ method: "GET", url: `/api/v1/work-plans/${unmappedPlanId}` });
    expect(derivedAfterUpdate.json<{ ownerAccount: string | null }>().ownerAccount).toBe("linyaqian.updated@zh.gd.csg.cn");

    const renamedMapping = await context.request({
      method: "PUT",
      url: `/api/v1/owner-account-mappings/${encodeURIComponent("林雅茜")}`,
      payload: { ownerName: "林雅倩", account: "linyaqian.updated@zh.gd.csg.cn" },
    });
    expect(renamedMapping.json()).toEqual({ ownerName: "林雅倩", account: "linyaqian.updated@zh.gd.csg.cn" });
    const derivedAfterRename = await context.request({ method: "GET", url: `/api/v1/work-plans/${unmappedPlanId}` });
    expect(derivedAfterRename.json<{ ownerAccount: string | null }>().ownerAccount).toBeNull();
    const restoredMapping = await context.request({
      method: "PUT",
      url: `/api/v1/owner-account-mappings/${encodeURIComponent("林雅倩")}`,
      payload: { ownerName: "林雅茜", account: "linyaqian.updated@zh.gd.csg.cn" },
    });
    expect(restoredMapping.statusCode).toBe(200);

    const deletedMapping = await context.request({
      method: "DELETE",
      url: `/api/v1/owner-account-mappings/${encodeURIComponent("林雅茜")}`,
    });
    expect(deletedMapping.statusCode).toBe(204);
    const derivedAfterDelete = await context.request({ method: "GET", url: `/api/v1/work-plans/${unmappedPlanId}` });
    expect(derivedAfterDelete.json<{ ownerAccount: string | null }>().ownerAccount).toBeNull();

    const withoutOwner = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "无负责人" }) });
    expect(withoutOwner.statusCode).toBe(201);
    expect(withoutOwner.json<{ ownerAccount: string | null }>().ownerAccount).toBeNull();

    const rejected = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: { ...planInput({ title: "试图写入账号" }), ownerAccount: "forged@example.com" },
    });
    expect(rejected.statusCode).toBe(422);

    const hiddenFromSearch = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/search",
      payload: { filters: [{ field: "ownerAccount", op: "eq", value: "fengmingqian@zh.gd.csg.cn" }], sort: [], limit: 20, offset: 0 },
    });
    expect(hiddenFromSearch.statusCode).toBe(422);
  });

  it("lets an administrator create a token-only editor that authenticates with its bearer token", async () => {
    const context = await createContext();
    const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "editor",
        role: "editor",
        loginMode: "token",
        tokenName: "初始 Token",
        tokenExpiresAt: expiresAt,
      },
    });

    expect(created.statusCode).toBe(201);
    const result = created.json<{
      user: { username: string; role: string; loginMode: string; disabledAt: string | null; version: number };
      accessToken: { token: string; expiresAt: string | null };
    }>();
    expect(result.user).toMatchObject({
      username: "editor",
      role: "editor",
      loginMode: "token",
      disabledAt: null,
      version: 1,
    });
    expect(result.accessToken.token).toMatch(/^wp_/);
    expect(result.accessToken.expiresAt).toBe(expiresAt);

    const me = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${result.accessToken.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      authKind: "token",
      user: { username: "editor", role: "editor", loginMode: "token" },
    });

    const passwordLogin = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "editor", password: "not-a-real-password" },
    });
    expect(passwordLogin.statusCode).toBe(401);
  });

  it("lets a password editor sign in to the Web session and use the workbench APIs", async () => {
    const context = await createContext();
    const password = "very-secure-editor-password";
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "web-editor",
        role: "editor",
        loginMode: "password",
        password,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      user: { username: "web-editor", role: "editor", loginMode: "password", disabledAt: null, version: 1 },
    });
    expect(created.json()).not.toHaveProperty("accessToken");

    const login = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "web-editor", password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { username: "web-editor", role: "editor", loginMode: "password" } });
    const cookieHeader = login.headers["set-cookie"];
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
    const editorRequest = (options: InjectOptions) => context.app.inject({
      ...options,
      headers: {
        cookie,
        ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
        ...options.headers,
      },
    });

    const createdPlan = await editorRequest({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "Web 编辑者计划" }) });
    expect(createdPlan.statusCode).toBe(201);
    const forbidden = await editorRequest({
      method: "POST",
      url: "/api/v1/users",
      payload: { username: "forbidden", role: "editor", loginMode: "password", password },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("lets an administrator give an existing token-only editor a Web password", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "converted-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "现有 Token",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const result = created.json<{ user: { id: string; version: number }; accessToken: { token: string } }>();
    const password = "converted-editor-password";

    const updated = await context.request({
      method: "PUT",
      url: `/api/v1/users/${result.user.id}/password`,
      payload: { password, version: result.user.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ loginMode: "password", version: 2 });
    expect(updated.json<{ tokens: unknown[] }>().tokens).toHaveLength(1);

    const login = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "converted-editor", password },
    });
    expect(login.statusCode).toBe(200);
    const existingToken = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${result.accessToken.token}` },
    });
    expect(existingToken.statusCode).toBe(200);
  });

  it("lets editors manage work plans while rejecting administrator-only operations", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "editor",
        role: "editor",
        loginMode: "token",
        tokenName: "权限测试 Token",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const token = created.json<{ accessToken: { token: string } }>().accessToken.token;
    const editorRequest = (options: InjectOptions) => context.app.inject({
      ...options,
      headers: { authorization: `Bearer ${token}`, ...options.headers },
    });

    const createPlan = await editorRequest({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "编辑者计划" }) });
    const listFields = await editorRequest({ method: "GET", url: "/api/v1/custom-fields" });
    const exportData = await editorRequest({ method: "GET", url: "/api/v1/export" });
    expect(createPlan.statusCode).toBe(201);
    expect(listFields.statusCode).toBe(200);
    expect(exportData.statusCode).toBe(200);

    const forbiddenRequests: InjectOptions[] = [
      {
        method: "POST",
        url: "/api/v1/users",
        payload: {
          username: "second-editor",
          role: "editor",
          loginMode: "token",
          tokenName: "Token",
          tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      { method: "POST", url: "/api/v1/tokens", payload: { name: "self", expiresAt: null } },
      {
        method: "POST",
        url: "/api/v1/custom-fields",
        payload: { key: "editor_field", label: "编辑者字段", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
      },
      { method: "POST", url: "/api/v1/import/validate", payload: {} },
    ];

    for (const request of forbiddenRequests) {
      const response = await editorRequest(request);
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
    }
  });

  it("lets an administrator list users and issue or revoke an editor token", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "managed-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "初始 Token",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const editor = created.json<{ user: { id: string }; accessToken: { id: string; token: string } }>();

    const listed = await context.request({ method: "GET", url: "/api/v1/users" });
    expect(listed.statusCode).toBe(200);
    const users = listed.json<Array<{
      username: string;
      role: string;
      loginMode: string;
      tokens: Array<{ id: string; name: string; token?: string }>;
    }>>();
    expect(users.map((user) => user.username)).toEqual(["admin", "managed-editor"]);
    expect(users[1]).toMatchObject({ role: "editor", loginMode: "token" });
    expect(users[1]!.tokens).toHaveLength(1);
    expect(users[1]!.tokens[0]).not.toHaveProperty("token");

    const issued = await context.request({
      method: "POST",
      url: `/api/v1/users/${editor.user.id}/tokens`,
      payload: { name: "轮换 Token", expiresAt: new Date(Date.now() + 172_800_000).toISOString() },
    });
    expect(issued.statusCode).toBe(201);
    const nextToken = issued.json<{ id: string; token: string; version: number }>();
    expect(nextToken.token).toMatch(/^wp_/);

    const revoked = await context.request({
      method: "DELETE",
      url: `/api/v1/users/${editor.user.id}/tokens/${nextToken.id}?version=${nextToken.version}`,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ revoked: true });
    const rejected = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${nextToken.token}` },
    });
    expect(rejected.statusCode).toBe(401);
  });

  it("revokes every credential when an editor is disabled and requires a new token after re-enabling", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "temporary-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "初始 Token",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const result = created.json<{ user: { id: string; version: number }; accessToken: { token: string } }>();

    const disabled = await context.request({
      method: "PATCH",
      url: `/api/v1/users/${result.user.id}`,
      payload: { disabled: true, version: result.user.version },
    });
    expect(disabled.statusCode).toBe(200);
    const disabledUser = disabled.json<{ disabledAt: string | null; version: number; tokens: unknown[] }>();
    expect(disabledUser.disabledAt).not.toBeNull();
    expect(disabledUser.version).toBe(2);
    expect(disabledUser.tokens).toEqual([]);

    const oldToken = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${result.accessToken.token}` },
    });
    expect(oldToken.statusCode).toBe(401);

    const issueWhileDisabled = await context.request({
      method: "POST",
      url: `/api/v1/users/${result.user.id}/tokens`,
      payload: { name: "不可签发", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(issueWhileDisabled.statusCode).toBe(409);
    expect(issueWhileDisabled.json<{ code: string }>().code).toBe("USER_DISABLED");

    const enabled = await context.request({
      method: "PATCH",
      url: `/api/v1/users/${result.user.id}`,
      payload: { disabled: false, version: disabledUser.version },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ disabledAt: null, version: 3, tokens: [] });

    const replacement = await context.request({
      method: "POST",
      url: `/api/v1/users/${result.user.id}/tokens`,
      payload: { name: "重新启用 Token", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(replacement.statusCode).toBe(201);
    expect(replacement.json<{ token: string }>().token).toMatch(/^wp_/);
  });

  it("rejects an editor token after its expiration time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-09T04:00:00.000Z"));
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "expiring-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "短期 Token",
        tokenExpiresAt: "2026-08-09T05:00:00.000Z",
      },
    });
    const token = created.json<{ accessToken: { token: string } }>().accessToken.token;
    const beforeExpiry = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(beforeExpiry.statusCode).toBe(200);

    vi.setSystemTime(new Date("2026-08-09T05:00:00.001Z"));
    const afterExpiry = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(afterExpiry.statusCode).toBe(401);
  });

  it("creates, updates and schedules a work plan with optimistic locking", async () => {
    const context = await createContext();
    const create = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    expect(create.statusCode).toBe(201);
    const plan = create.json<{ id: string; version: number }>();
    expect(plan.version).toBe(1);
    expect(plan).not.toHaveProperty("tags");
    expect(plan).not.toHaveProperty("reminders");
    expect(plan).not.toHaveProperty("priority");

    const stale = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plan.id}/schedule`,
      payload: { startAt: new Date(Date.now() + 8_000_000).toISOString(), endAt: new Date(Date.now() + 9_000_000).toISOString(), version: 99 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe("VERSION_CONFLICT");

    const nextStart = new Date(Date.now() + 10_000_000).toISOString();
    const nextEnd = new Date(Date.now() + 11_000_000).toISOString();
    const scheduled = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plan.id}/schedule`,
      payload: { startAt: nextStart, endAt: nextEnd, version: plan.version },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json<{ startAt: string; version: number }>()).toMatchObject({ startAt: nextStart, version: 2 });
  });

  it("accepts private-network origins without trusting unrelated origins", async () => {
    const context = await createContext();
    const fromVite = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      headers: { origin: "http://localhost:5173" },
      payload: planInput(),
    });
    expect(fromVite.statusCode).toBe(201);

    const fromLanVite = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      headers: { origin: "http://192.168.1.20:5173" },
      payload: planInput({ title: "局域网开发来源" }),
    });
    expect(fromLanVite.statusCode).toBe(201);

    const fromUntrustedOrigin = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      headers: { origin: "https://untrusted.example" },
      payload: planInput({ title: "不受信任来源" }),
    });
    expect(fromUntrustedOrigin.statusCode).toBe(403);
    expect(fromUntrustedOrigin.json<{ code: string }>().code).toBe("ORIGIN_NOT_ALLOWED");

    const productionContext = await createContext({ isProduction: true });
    const productionFromVite = await productionContext.request({
      method: "POST",
      url: "/api/v1/work-plans",
      headers: { origin: "http://localhost:5173" },
      payload: planInput(),
    });
    expect(productionFromVite.statusCode).toBe(403);
    expect(productionFromVite.json<{ code: string }>().code).toBe("ORIGIN_NOT_ALLOWED");

    const productionFromLan = await productionContext.request({
      method: "POST",
      url: "/api/v1/work-plans",
      headers: { origin: "http://192.168.1.20:3000" },
      payload: planInput({ title: "生产环境局域网来源" }),
    });
    expect(productionFromLan.statusCode).toBe(201);
  });

  it("validates and searches normalized custom field values", async () => {
    const context = await createContext();
    const field = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "budget", label: "预算", description: "", type: "number", required: true, defaultValue: null, options: [] },
    });
    expect(field.statusCode).toBe(201);

    const missing = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    expect(missing.statusCode).toBe(422);

    const create = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ customFields: { budget: 120_000 } }),
    });
    expect(create.statusCode).toBe(201);
    expect(create.json<{ customFields: Record<string, unknown> }>().customFields.budget).toBe(120_000);

    const search = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/search",
      payload: { filters: [{ field: "custom.budget", op: "gte", value: 100_000 }], sort: [{ field: "custom.budget", direction: "desc" }], limit: 20, offset: 0 },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json<Array<{ title: string }>>()).toHaveLength(1);
  });

  it("round-trips false boolean custom field values when editing a work plan", async () => {
    const context = await createContext();
    const field = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "ticket", label: "是否需起检修单", description: "", type: "boolean", required: false, defaultValue: false, options: [] },
    });
    expect(field.statusCode).toBe(201);

    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "布尔值往返", customFields: { ticket: false } }),
    });
    expect(created.statusCode).toBe(201);
    const createdPlan = created.json<{ id: string; version: number; customFields: Record<string, unknown> }>();
    expect(createdPlan.customFields.ticket).toBe(false);

    const updated = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${createdPlan.id}`,
      payload: { title: "布尔值往返-已编辑", version: createdPlan.version, customFields: createdPlan.customFields },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ customFields: Record<string, unknown> }>().customFields.ticket).toBe(false);
  });

  it("creates recurring occurrences and detaches a dragged instance", async () => {
    const context = await createContext();
    const create = await context.request({
      method: "POST",
      url: "/api/v1/work-plan-series",
      payload: { workPlan: planInput(), recurrence: { frequency: "daily", interval: 1, count: 3, timeZone: "Asia/Shanghai" } },
    });
    expect(create.statusCode).toBe(201);
    const generated = create.json<{ generated: Array<{ id: string; version: number; startAt: string; endAt: string }> }>().generated;
    expect(generated).toHaveLength(3);

    const first = generated[0]!;
    const shifted = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${first.id}/schedule`,
      payload: {
        startAt: new Date(Date.parse(first.startAt) + 1_800_000).toISOString(),
        endAt: new Date(Date.parse(first.endAt) + 1_800_000).toISOString(),
        version: first.version,
      },
    });
    expect(shifted.statusCode).toBe(200);
    expect(shifted.json<{ isException: boolean }>().isException).toBe(true);
  });

  it("does not generate a duplicate on the edited occurrence's calendar day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-08T00:00:00.000Z"));
    const context = await createContext();
    const create = await context.request({
      method: "POST",
      url: "/api/v1/work-plan-series",
      payload: {
        workPlan: planInput({ startAt: "2027-08-09T02:00:00.000Z", endAt: "2027-08-09T03:00:00.000Z" }),
        recurrence: { frequency: "daily", interval: 1, count: 3, timeZone: "Asia/Shanghai" },
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json<{ generated: Array<{ id: string; version: number }>; series: { id: string; version: number } }>();
    const first = created.generated[0]!;

    const edit = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${first.id}`,
      payload: { startAt: "2027-08-09T04:00:00.000Z", endAt: "2027-08-09T05:00:00.000Z", version: first.version },
    });
    expect(edit.statusCode).toBe(200);

    const updateSeries = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plan-series/${created.series.id}`,
      payload: {
        workPlan: { startAt: "2027-08-09T04:00:00.000Z", endAt: "2027-08-09T05:00:00.000Z" },
        recurrence: { frequency: "daily", interval: 1, count: 3, timeZone: "Asia/Shanghai" },
        version: created.series.version,
      },
    });
    expect(updateSeries.statusCode).toBe(200);

    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    const sameDay = plans.json<Array<{ startAt: string }>>().filter((plan) => plan.startAt.startsWith("2027-08-09"));
    expect(sameDay).toHaveLength(1);
  });

  it("turns an existing work plan into the first occurrence of a recurring rule", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    expect(created.statusCode).toBe(201);
    const plan = created.json<{ id: string; version: number }>();

    const converted = await context.request({
      method: "POST",
      url: `/api/v1/work-plans/${plan.id}/series`,
      payload: {
        workPlan: planInput(),
        recurrence: { frequency: "daily", interval: 1, count: 3, timeZone: "Asia/Shanghai" },
        version: plan.version,
      },
    });
    expect(converted.statusCode).toBe(201);
    const result = converted.json<{ occurrence: { id: string; seriesId: string | null }; generated: unknown[] }>();
    expect(result.occurrence.id).toBe(plan.id);
    expect(result.occurrence.seriesId).not.toBeNull();
    expect(result.generated).toHaveLength(2);

    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    expect(plans.json<unknown[]>()).toHaveLength(3);
  });

  it("removes tag, reminder and notification APIs while retaining export validation", async () => {
    const context = await createContext();
    const legacyPriority = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ priority: "high" }),
    });
    expect(legacyPriority.statusCode).toBe(422);

    const legacyProperties = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ tags: ["旧标签"], reminders: [{ anchor: "start", offsetMinutes: 15 }] }),
    });
    expect(legacyProperties.statusCode).toBe(422);

    const tags = await context.request({ method: "GET", url: "/api/v1/tags" });
    const notifications = await context.request({ method: "GET", url: "/api/v1/notifications" });
    expect(tags.statusCode).toBe(404);
    expect(notifications.statusCode).toBe(404);

    const exportResponse = await context.request({ method: "GET", url: "/api/v1/export" });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.json<{ data: Record<string, unknown> }>().data).not.toHaveProperty("tags");
    expect(exportResponse.json<{ data: Record<string, unknown> }>().data).not.toHaveProperty("reminder_rules");
    const validation = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: exportResponse.json() });
    expect(validation.statusCode).toBe(200);
    expect(validation.json<{ valid: boolean }>().valid).toBe(true);
  });

  it("round-trips owner mappings in JSON version 4 and preserves them when importing version 1", async () => {
    const context = await createContext();
    const exported = await context.request({ method: "GET", url: "/api/v1/export" });
    expect(exported.statusCode).toBe(200);
    const version4 = exported.json<{
      schemaVersion: number;
      exportedAt: string;
      data: Record<string, Array<Record<string, unknown>>>;
    }>();
    expect(version4.schemaVersion).toBe(4);
    expect(version4.data.owner_account_mappings).toHaveLength(9);
    expect(version4.data.monthly_goals).toEqual([]);
    expect(version4.data.monthly_goal_series).toEqual([]);

    context.database.sqlite.prepare("UPDATE owner_account_mappings SET account = ? WHERE owner_name = ?").run("changed@example.com", "冯铭倩");
    const { owner_account_mappings: _mappings, monthly_goals: _monthlyGoals, monthly_goal_series: _series, ...version1Data } = version4.data;
    const version1 = { schemaVersion: 1, exportedAt: version4.exportedAt, data: version1Data };
    const oldValidation = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: version1 });
    expect(oldValidation.statusCode).toBe(200);
    const oldImport = await context.request({ method: "POST", url: "/api/v1/import", payload: version1 });
    expect(oldImport.statusCode).toBe(200);
    expect(context.database.sqlite.prepare("SELECT account FROM owner_account_mappings WHERE owner_name = ?").get("冯铭倩")).toEqual({ account: "changed@example.com" });

    const replacement = {
      ...version4,
      data: {
        ...version4.data,
        owner_account_mappings: [{ owner_name: "测试负责人", account: "test.owner@example.com" }],
      },
    };
    const newValidation = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: replacement });
    expect(newValidation.statusCode).toBe(200);
    const newImport = await context.request({ method: "POST", url: "/api/v1/import", payload: replacement });
    expect(newImport.statusCode).toBe(200);
    const mappings = await context.request({ method: "GET", url: "/api/v1/owner-account-mappings" });
    expect(mappings.json()).toEqual([{ ownerName: "测试负责人", account: "test.owner@example.com" }]);
  });

  it("edits export templates and round-trips work plans through BIFF8 XLS", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({
        title: "XLS 往返计划",
        startAt: "2027-08-09T08:30:43.000Z",
        endAt: "2027-08-09T09:30:43.000Z",
      }),
    });
    expect(created.statusCode).toBe(201);

    const templatesResponse = await context.request({ method: "GET", url: "/api/v1/export-templates" });
    expect(templatesResponse.statusCode).toBe(200);
    const template = templatesResponse.json<Array<{ id: string; version: number; columns: Array<{ source: string; header: string }> }>>()[0]!;
    const updated = await context.request({
      method: "PATCH",
      url: `/api/v1/export-templates/${template.id}`,
      payload: {
        version: template.version,
        name: "排程导出",
        sheetName: "排程",
        columns: template.columns.map((column) => column.source === "title" ? { ...column, header: "计划标题" } : column),
      },
    });
    expect(updated.statusCode).toBe(200);

    const exported = await context.request({ method: "GET", url: `/api/v1/work-plans/export.xls?templateId=${template.id}` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(exportedFileName(exported.headers["content-disposition"])).toMatch(/^排程导出-\d{8}-\d{6}\.xlsx$/);
    expect(exported.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
    const workbook = XLSX.read(exported.rawPayload, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["计划标题"]).toBe("XLS 往返计划");
    expect(rows[0]?.["开始时间"]).toBeInstanceOf(Date);
    expect((rows[0]?.["开始时间"] as Date).getSeconds()).toBe(0);
    expect(rows[0]?.["结束时间"]).toBeInstanceOf(Date);
    expect((rows[0]?.["结束时间"] as Date).getSeconds()).toBe(0);

    const imported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/import.xls",
      payload: { templateId: template.id, fileName: "排程.xls", dataBase64: exported.rawPayload.toString("base64") },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json<{ imported: number }>().imported).toBe(1);
    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    expect(plans.json<unknown[]>()).toHaveLength(2);
  });

  it("exports XLS with ad-hoc selected columns without saving a template", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "自定义列导出" }) });
    expect(created.statusCode).toBe(201);

    const exported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/export.xls",
      payload: {
        name: "自定义导出",
        sheetName: "自定义导出",
        columns: [
          { source: "title", header: "计划标题" },
          { source: "status", header: "状态" },
        ],
      },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(exportedFileName(exported.headers["content-disposition"])).toMatch(/^自定义导出-\d{8}-\d{6}\.xlsx$/);
    expect(exported.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
    const workbook = XLSX.read(exported.rawPayload, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ "计划标题": "自定义列导出", "状态": "待开始" });

    const templatesResponse = await context.request({ method: "GET", url: "/api/v1/export-templates" });
    expect(templatesResponse.json<Array<{ name: string }>>().map((template) => template.name)).not.toContain("自定义导出");
  });

  it("exports derived owner accounts and ignores imported account cells", async () => {
    const context = await createContext();
    await createOwnerField(context);
    await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "映射账号导出", customFields: { owner: "fengmingqian" } }),
    });
    await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "未映射账号导出", customFields: { owner: "linyaqian" } }),
    });

    const exported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/export.xls",
      payload: {
        sheetName: "负责人账号",
        columns: [
          { source: "title", header: "工作内容" },
          { source: "custom:owner", header: "工作负责人" },
          { source: "ownerAccount", header: "工作负责人账号" },
        ],
      },
    });
    expect(exported.statusCode).toBe(200);
    const exportedWorkbook = XLSX.read(exported.rawPayload, { type: "buffer", cellDates: true });
    const exportedSheet = exportedWorkbook.Sheets[exportedWorkbook.SheetNames[0]!]!;
    const exportedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exportedSheet, { defval: "" });
    expect(exportedRows.find((row) => row["工作内容"] === "映射账号导出")).toMatchObject({
      工作负责人: "冯铭倩",
      工作负责人账号: "fengmingqian@zh.gd.csg.cn",
    });
    expect(exportedRows.find((row) => row["工作内容"] === "未映射账号导出")?.["工作负责人账号"]).toBe("");

    const templateResponse = await context.request({
      method: "POST",
      url: "/api/v1/export-templates",
      payload: {
        name: "负责人账号导入测试",
        sheetName: "工作计划",
        columns: [
          { source: "title", header: "工作内容" },
          { source: "startAt", header: "开始时间" },
          { source: "endAt", header: "结束时间" },
          { source: "custom:owner", header: "工作负责人" },
          { source: "ownerAccount", header: "工作负责人账号" },
        ],
      },
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = templateResponse.json<{ id: string }>();
    const importWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(importWorkbook, XLSX.utils.aoa_to_sheet([
      ["工作内容", "开始时间", "结束时间", "工作负责人", "工作负责人账号"],
      ["导入后重新派生", new Date("2026-08-11T00:00:00.000Z"), new Date("2026-08-11T02:00:00.000Z"), "冯铭倩", "forged@example.com"],
    ], { cellDates: true }), "工作计划");
    const importData = XLSX.write(importWorkbook, { type: "buffer", bookType: "biff8", cellDates: true }) as Buffer;
    const imported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/import.xls",
      payload: { templateId: template.id, fileName: "负责人账号.xls", dataBase64: importData.toString("base64") },
    });
    expect(imported.statusCode).toBe(200);
    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    expect(plans.json<Array<{ title: string; ownerAccount: string | null }>>().find((plan) => plan.title === "导入后重新派生")?.ownerAccount).toBe("fengmingqian@zh.gd.csg.cn");
  });

  it("rejects ad-hoc export columns referencing archived custom fields", async () => {
    const context = await createContext();
    const exported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/export.xls",
      payload: {
        columns: [{ source: "custom:ghost", header: "幽灵字段" }],
      },
    });
    expect(exported.statusCode).toBe(422);
  });

  it("rolls back the whole XLS import when any row is invalid", async () => {
    const context = await createContext();
    const templatesResponse = await context.request({ method: "GET", url: "/api/v1/export-templates" });
    const template = templatesResponse.json<Array<{ id: string; columns: Array<{ source: string; header: string }> }>>()[0]!;
    const valuesBySource: Record<string, unknown> = {
      title: "有效计划",
      status: "待开始",
      startAt: new Date("2026-08-11T00:00:00.000Z"),
      endAt: new Date("2026-08-13T00:00:00.000Z"),
    };
    const headers = template.columns.map((column) => column.header);
    const validRow = template.columns.map((column) => valuesBySource[column.source] ?? "");
    const invalidRow = template.columns.map((column) => column.source === "title" ? "无效计划" : column.source === "endAt" ? "" : valuesBySource[column.source] ?? "");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, validRow, invalidRow], { cellDates: true }), "工作计划");
    const data = XLSX.write(workbook, { type: "buffer", bookType: "biff8", cellDates: true }) as Buffer;

    const imported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/import.xls",
      payload: { templateId: template.id, fileName: "整批导入.xls", dataBase64: data.toString("base64") },
    });
    expect(imported.statusCode).toBe(422);
    expect(imported.json<{ detail: string }>().detail).toContain("第 3 行");
    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    expect(plans.json<unknown[]>()).toHaveLength(0);
  });
});
