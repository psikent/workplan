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
    payload: { token: built.services.auth.setupToken, username: "admin", password: "very-secure-test-password" },
  });
  expect(setup.statusCode).toBe(200);
  const cookieHeader = setup.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
  const context = {
    ...built,
    adminRequest: (options: InjectOptions) => built.app.inject({
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

const planInput = (overrides: Record<string, unknown> = {}) => ({
  title: "官网改版计划",
  description: "完成新版官网的设计与发布",
  status: "pending",
  startAt: new Date(Date.now() + 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 7_200_000).toISOString(),
  customFields: {},
  ...overrides,
});

type ManagedAccount = {
  user: { id: string; username: string; role: string; loginMode: string; version: number };
  accessToken?: { id: string; token: string };
};

async function createManagedAccount(context: TestContext, payload: Record<string, unknown>) {
  const response = await context.adminRequest({ method: "POST", url: "/api/v1/users", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ManagedAccount>();
}

async function loginSession(context: TestContext, username: string, password: string) {
  const login = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  expect(login.statusCode).toBe(200);
  const cookieHeader = login.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
  const request = (options: InjectOptions) => context.app.inject({
    ...options,
    headers: {
      cookie,
      ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
      ...options.headers,
    },
  });
  return { request, json: login.json<{ user: { role: string } }>() };
}

function bearerRequest(context: TestContext, token: string) {
  return (options: InjectOptions) => context.app.inject({
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
  });
}

/** Seed the full query surface the Viewer is allowed to read and export. */
async function seedBusinessData(context: TestContext) {
  const field = await context.adminRequest({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key: "owner",
      label: "工作负责人",
      description: "",
      type: "single_select",
      required: false,
      defaultValue: null,
      options: [{ value: "linyaqian", label: "林雅茜" }],
    },
  });
  expect(field.statusCode).toBe(201);
  const fieldWithOption = field.json<{ id: string; options: Array<{ id: string }> }>();
  const fieldId = fieldWithOption.id;
  const optionId = fieldWithOption.options[0]!.id;

  const plan = await context.adminRequest({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "已 seeded 计划" }) });
  expect(plan.statusCode).toBe(201);
  const planId = plan.json<{ id: string }>().id;

  const series = await context.adminRequest({
    method: "POST",
    url: "/api/v1/work-plan-series",
    payload: {
      workPlan: planInput({ title: "重复巡查计划", startAt: "2027-08-09T01:00:00.000Z", endAt: "2027-08-09T02:00:00.000Z" }),
      recurrence: { frequency: "daily", interval: 1, count: 2, timeZone: "Asia/Shanghai" },
    },
  });
  expect(series.statusCode).toBe(201);
  const goal = await context.adminRequest({
    method: "POST",
    url: "/api/v1/monthly-goals",
    payload: { title: "八月目标", description: "", year: 2027, month: 8, workPlanId: planId },
  });
  expect(goal.statusCode).toBe(201);
  const goalId = goal.json<{ id: string }>().id;

  const goalSeries = await context.adminRequest({
    method: "POST",
    url: "/api/v1/monthly-goal-series",
    payload: { template: { title: "季度目标", description: "" }, frequency: "monthly", interval: 1, startPeriod: { year: 2027, month: 8 }, occurrenceCount: 2 },
  });
  expect(goalSeries.statusCode).toBe(201);
  const goalSeriesId = goalSeries.json<{ series: { id: string } }>().series.id;

  const template = await context.adminRequest({
    method: "POST",
    url: "/api/v1/export-templates",
    payload: { name: "标准导出", sheetName: "工作计划", columns: [{ source: "title", header: "工作内容" }] },
  });
  expect(template.statusCode).toBe(201);
  const templateId = template.json<{ id: string }>().id;

  return { planId, goalId, goalSeriesId, templateId, fieldId, optionId };
}

async function snapshotBusinessData(context: TestContext) {
  const get = async (url: string) => (await context.adminRequest({ method: "GET", url })).json();
  // lastUsedAt 随每次认证请求变化，与权限副作用无关，比较前剔除。
  const users = (await get("/api/v1/users")) as Array<{ tokens: Array<Record<string, unknown>> } & Record<string, unknown>>;
  return {
    workPlans: await get("/api/v1/work-plans?limit=500"),
    workPlanSeries: await get("/api/v1/work-plan-series"),
    monthlyGoals: await get("/api/v1/monthly-goals?includeArchived=true"),
    monthlyGoalSeries: await get("/api/v1/monthly-goal-series"),
    customFields: await get("/api/v1/custom-fields"),
    ownerAccountMappings: await get("/api/v1/owner-account-mappings"),
    exportTemplates: await get("/api/v1/export-templates"),
    users: users.map(({ tokens, ...user }) => ({
      ...user,
      tokens: tokens.map(({ lastUsedAt: _lastUsedAt, ...token }) => token),
    })),
  };
}

const businessWriteRequests = (ids: { planId: string; goalId: string; goalSeriesId: string }): InjectOptions[] => [
  { method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "Viewer 尝试新建" }) },
  { method: "PATCH", url: `/api/v1/work-plans/${ids.planId}`, payload: { title: "Viewer 尝试修改", version: 1 } },
  { method: "PATCH", url: `/api/v1/work-plans/${ids.planId}/schedule`, payload: { startAt: "2027-08-09T01:00:00.000Z", endAt: "2027-08-09T02:00:00.000Z", version: 1 } },
  { method: "DELETE", url: `/api/v1/work-plans/${ids.planId}?version=1` },
  { method: "POST", url: "/api/v1/work-plans/reorder", payload: { orderedIds: [ids.planId] } },
  {
    method: "POST",
    url: "/api/v1/work-plan-series",
    payload: {
      workPlan: planInput({ title: "Viewer 尝试新建系列" }),
      recurrence: { frequency: "daily", interval: 1, count: 1, timeZone: "Asia/Shanghai" },
    },
  },
  {
    method: "POST",
    url: `/api/v1/work-plans/${ids.planId}/series`,
    payload: {
      workPlan: planInput({ title: "Viewer 尝试附加规则" }),
      recurrence: { frequency: "weekly", interval: 1, weekdays: [1], timeZone: "Asia/Shanghai" },
      version: 1,
    },
  },
  { method: "PATCH", url: "/api/v1/work-plan-series/00000000-0000-4000-8000-000000000000", payload: { active: false, version: 1 } },
  { method: "DELETE", url: "/api/v1/work-plan-series/00000000-0000-4000-8000-000000000000?version=1" },
  {
    method: "PUT",
    url: "/api/v1/monthly-goals/quick-edit",
    payload: { year: 2027, baseline: [], rows: [{ originalTitle: null, title: "Viewer 尝试快速编辑", activeMonths: [8] }] },
  },
  { method: "POST", url: "/api/v1/monthly-goals", payload: { title: "Viewer 尝试新建目标", year: 2027, month: 9, workPlanId: null } },
  { method: "PATCH", url: `/api/v1/monthly-goals/${ids.goalId}`, payload: { title: "Viewer 尝试修改目标", version: 1 } },
  { method: "DELETE", url: `/api/v1/monthly-goals/${ids.goalId}?version=1` },
  {
    method: "POST",
    url: "/api/v1/monthly-goal-series",
    payload: { template: { title: "Viewer 尝试新建目标系列", description: "" }, frequency: "monthly", interval: 1, startPeriod: { year: 2027, month: 8 }, occurrenceCount: 1 },
  },
  { method: "PATCH", url: `/api/v1/monthly-goal-series/${ids.goalSeriesId}`, payload: { template: { title: "Viewer 尝试修改系列" }, version: 1 } },
  { method: "DELETE", url: `/api/v1/monthly-goal-series/${ids.goalSeriesId}?version=1` },
  {
    method: "POST",
    url: `/api/v1/monthly-goal-series/${ids.goalSeriesId}/dissolve`,
    payload: { keepGoalId: ids.goalId, snapshotToken: "a".repeat(64), confirmationTitle: "季度目标" },
  },
];

const adminOnlyRequests = (ids: { templateId: string; fieldId: string; optionId: string }): InjectOptions[] => [
  { method: "GET", url: "/api/v1/users" },
  {
    method: "POST",
    url: "/api/v1/users",
    payload: { username: "blocked-viewer-creation", role: "viewer", loginMode: "password", password: "blocked-password-123" },
  },
  { method: "PUT", url: "/api/v1/users/00000000-0000-4000-8000-000000000000/password", payload: { password: "blocked-password-123", version: 1 } },
  { method: "POST", url: "/api/v1/users/00000000-0000-4000-8000-000000000000/tokens", payload: { name: "blocked", expiresAt: null } },
  { method: "PATCH", url: "/api/v1/users/00000000-0000-4000-8000-000000000000", payload: { disabled: true, version: 1 } },
  { method: "DELETE", url: "/api/v1/users/00000000-0000-4000-8000-000000000000/tokens/00000000-0000-4000-8000-000000000001?version=1" },
  {
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: { key: "blocked_field", label: "被阻止的字段", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
  },
  { method: "PATCH", url: `/api/v1/custom-fields/${ids.fieldId}`, payload: { label: "被阻止的修改", version: 1 } },
  { method: "POST", url: "/api/v1/custom-fields/reorder", payload: { orderedIds: [ids.fieldId] } },
  { method: "POST", url: `/api/v1/custom-fields/${ids.fieldId}/options`, payload: { value: "blocked", label: "被阻止" } },
  { method: "PATCH", url: `/api/v1/custom-field-options/${ids.optionId}`, payload: { label: "被阻止", version: 1 } },
  { method: "POST", url: "/api/v1/owner-account-mappings", payload: { ownerName: "被阻止", account: "blocked@example.com" } },
  { method: "PUT", url: "/api/v1/owner-account-mappings/被阻止", payload: { ownerName: "被阻止", account: "blocked2@example.com" } },
  { method: "DELETE", url: "/api/v1/owner-account-mappings/被阻止" },
  { method: "POST", url: "/api/v1/import/validate", payload: {} },
  { method: "POST", url: "/api/v1/import", payload: {} },
  { method: "POST", url: "/api/v1/export-templates", payload: { name: "被阻止模板", sheetName: "计划", columns: [{ source: "title", header: "工作内容" }] } },
  { method: "PATCH", url: `/api/v1/export-templates/${ids.templateId}`, payload: { name: "被阻止", version: 1 } },
  { method: "DELETE", url: `/api/v1/export-templates/${ids.templateId}?version=1` },
  { method: "POST", url: "/api/v1/work-plans/import.xls", payload: { templateId: ids.templateId, fileName: "blocked.xls", dataBase64: "aGk=" } },
  { method: "GET", url: "/api/v1/env-config" },
  { method: "GET", url: "/api/v1/env-config/file" },
  { method: "POST", url: "/api/v1/env-config/validate", payload: { package: {} } },
  { method: "POST", url: "/api/v1/env-config/import", payload: { package: {}, mode: "additive", sections: ["customFields", "ownerAccountMappings", "exportTemplates"], confirmDestructive: false } },
];

describe("viewer authorization", () => {
  it("authenticates password and token-only viewers and reports role viewer", async () => {
    const context = await createContext();
    const passwordViewer = await createManagedAccount(context, { username: "viewer-password", role: "viewer", loginMode: "password", password: "viewer-password-123" });
    const tokenViewer = await createManagedAccount(context, {
      username: "viewer-token",
      role: "viewer",
      loginMode: "token",
      tokenName: "查询 Token",
      tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(passwordViewer.user).toMatchObject({ role: "viewer", loginMode: "password" });
    expect(tokenViewer.user).toMatchObject({ role: "viewer", loginMode: "token" });
    expect(passwordViewer.accessToken).toBeUndefined();
    expect(tokenViewer.accessToken!.token).toMatch(/^wp_/);

    const session = await loginSession(context, "viewer-password", "viewer-password-123");
    expect(session.json.user).toMatchObject({ role: "viewer" });
    const me = await session.request({ method: "GET", url: "/api/v1/auth/me" });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ authKind: "session", user: { role: "viewer", loginMode: "password" } });

    const tokenRequest = bearerRequest(context, tokenViewer.accessToken!.token);
    const meByToken = await tokenRequest({ method: "GET", url: "/api/v1/auth/me" });
    expect(meByToken.statusCode).toBe(200);
    expect(meByToken.json()).toMatchObject({ authKind: "token", user: { role: "viewer", loginMode: "token" } });

    const passwordLogin = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "viewer-token", password: "not-a-real-password" } });
    expect(passwordLogin.statusCode).toBe(401);
  });

  it("lets both viewer kinds run every query, search and export", async () => {
    const context = await createContext();
    const ids = await seedBusinessData(context);

    const passwordViewer = await createManagedAccount(context, { username: "viewer-password", role: "viewer", loginMode: "password", password: "viewer-password-123" });
    const tokenViewer = await createManagedAccount(context, { username: "viewer-token", role: "viewer", loginMode: "token", tokenName: "查询 Token", tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const session = await loginSession(context, "viewer-password", "viewer-password-123");
    const tokenRequest = bearerRequest(context, tokenViewer.accessToken!.token);

    const seriesDetail = await context.adminRequest({ method: "GET", url: `/api/v1/monthly-goal-series/${ids.goalSeriesId}` });
    const seriesInstanceId = seriesDetail.json<{ instances: Array<{ id: string }> }>().instances[0]!.id;

    const queryRequests: InjectOptions[] = [
      { method: "GET", url: "/api/v1/work-plans?limit=500" },
      { method: "GET", url: `/api/v1/work-plans/${ids.planId}` },
      { method: "POST", url: "/api/v1/work-plans/search", payload: { q: "计划", filters: [], sort: [], limit: 50, offset: 0 } },
      { method: "GET", url: "/api/v1/work-plan-series" },
      { method: "GET", url: "/api/v1/monthly-goals" },
      { method: "GET", url: `/api/v1/monthly-goals/${ids.goalId}` },
      { method: "GET", url: "/api/v1/monthly-goal-series" },
      { method: "GET", url: `/api/v1/monthly-goal-series/${ids.goalSeriesId}` },
      { method: "GET", url: `/api/v1/monthly-goal-series/${ids.goalSeriesId}/dissolve-preview?keepGoalId=${seriesInstanceId}` },
      { method: "GET", url: "/api/v1/custom-fields" },
      { method: "GET", url: "/api/v1/owner-account-mappings" },
      { method: "GET", url: "/api/v1/export-templates" },
      { method: "GET", url: "/api/v1/export" },
      { method: "GET", url: `/api/v1/work-plans/export.xls?templateId=${ids.templateId}` },
      { method: "POST", url: "/api/v1/work-plans/export.xls", payload: { columns: [{ source: "title", header: "工作内容" }] } },
      { method: "GET", url: "/api/v1/reminders?from=2027-08-01&to=2027-08-31" },
      { method: "GET", url: "/api/v1/auth/me" },
    ];

    for (const request of queryRequests) {
      const bySession = await session.request(request);
      expect(bySession.statusCode, `session viewer ${request.method} ${request.url}`).toBe(200);
      const byToken = await tokenRequest(request);
      expect(byToken.statusCode, `token viewer ${request.method} ${request.url}`).toBe(200);
    }

    const xls = await session.request({ method: "POST", url: "/api/v1/work-plans/export.xls", payload: { columns: [{ source: "title", header: "工作内容" }] } });
    expect(xls.headers["content-type"]).toBe("application/vnd.ms-excel");
    const jsonExport = await session.request({ method: "GET", url: "/api/v1/export" });
    expect(jsonExport.json()).toHaveProperty("data");

    const logout = await session.request({ method: "POST", url: "/api/v1/auth/logout" });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ loggedOut: true });
    const afterLogout = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: "x" } });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("rejects every business write and administrator operation with 403 and zero side effects", async () => {
    const context = await createContext();
    const adminIds = await seedBusinessData(context);

    const passwordViewer = await createManagedAccount(context, { username: "viewer-password", role: "viewer", loginMode: "password", password: "viewer-password-123" });
    const tokenViewer = await createManagedAccount(context, { username: "viewer-token", role: "viewer", loginMode: "token", tokenName: "查询 Token", tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const session = await loginSession(context, "viewer-password", "viewer-password-123");
    const tokenRequest = bearerRequest(context, tokenViewer.accessToken!.token);

    const before = await snapshotBusinessData(context);
    const writeAndAdminRequests = [...businessWriteRequests(adminIds), ...adminOnlyRequests(adminIds)];

    for (const request of writeAndAdminRequests) {
      const bySession = await session.request(request);
      expect(bySession.statusCode, `session viewer ${request.method} ${request.url}`).toBe(403);
      expect(bySession.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
      const byToken = await tokenRequest(request);
      expect(byToken.statusCode, `token viewer ${request.method} ${request.url}`).toBe(403);
      expect(byToken.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
    }

    const after = await snapshotBusinessData(context);
    expect(after).toEqual(before);
  });

  it("keeps editor and administrator capabilities unchanged", async () => {
    const context = await createContext();
    const ids = await seedBusinessData(context);
    const editor = await createManagedAccount(context, { username: "editor", role: "editor", loginMode: "token", tokenName: "编辑 Token", tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const editorRequest = bearerRequest(context, editor.accessToken!.token);

    const created = await editorRequest({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "编辑者新计划" }) });
    expect(created.statusCode).toBe(201);
    const planId = created.json<{ id: string; version: number }>().id;
    const updated = await editorRequest({ method: "PATCH", url: `/api/v1/work-plans/${planId}`, payload: { title: "编辑者改名", version: 1 } });
    expect(updated.statusCode).toBe(200);
    const goal = await editorRequest({ method: "POST", url: "/api/v1/monthly-goals", payload: { title: "编辑者目标", year: 2027, month: 9, workPlanId: null } });
    expect(goal.statusCode).toBe(201);
    const goalId = goal.json<{ id: string }>().id;
    const quickEdit = await editorRequest({
      method: "PUT",
      url: "/api/v1/monthly-goals/quick-edit",
      payload: { year: 2030, baseline: [], rows: [{ originalTitle: null, title: "编辑者快速目标", activeMonths: [10] }] },
    });
    expect(quickEdit.statusCode).toBe(200);
    const search = await editorRequest({ method: "POST", url: "/api/v1/work-plans/search", payload: { q: "编辑者" } });
    expect(search.statusCode).toBe(200);

    for (const request of adminOnlyRequests(ids)) {
      const response = await editorRequest(request);
      expect(response.statusCode, `editor ${request.method} ${request.url}`).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
    }
  });

  it("requires authentication before any capability decision", async () => {
    const context = await createContext();
    const anonymous = await context.app.inject({ method: "GET", url: "/api/v1/work-plans" });
    expect(anonymous.statusCode).toBe(401);
    const anonymousWrite = await context.app.inject({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    expect(anonymousWrite.statusCode).toBe(401);
  });

  it("revokes viewer credentials on disable and never restores them on re-enable", async () => {
    const context = await createContext();
    await seedBusinessData(context);

    const passwordViewer = await createManagedAccount(context, { username: "viewer-password", role: "viewer", loginMode: "password", password: "viewer-password-123" });
    const session = await loginSession(context, "viewer-password", "viewer-password-123");
    const tokenViewer = await createManagedAccount(context, { username: "viewer-token", role: "viewer", loginMode: "token", tokenName: "查询 Token", tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const tokenRequest = bearerRequest(context, tokenViewer.accessToken!.token);
    expect((await tokenRequest({ method: "GET", url: "/api/v1/work-plans" })).statusCode).toBe(200);

    const disabled = await context.adminRequest({
      method: "PATCH",
      url: `/api/v1/users/${tokenViewer.user.id}`,
      payload: { disabled: true, version: tokenViewer.user.version },
    });
    expect(disabled.statusCode).toBe(200);

    expect((await tokenRequest({ method: "GET", url: "/api/v1/work-plans" })).statusCode).toBe(401);
    const disabledSession = await context.adminRequest({
      method: "PATCH",
      url: `/api/v1/users/${passwordViewer.user.id}`,
      payload: { disabled: true, version: passwordViewer.user.version },
    });
    expect(disabledSession.statusCode).toBe(200);
    expect((await session.request({ method: "GET", url: "/api/v1/work-plans" })).statusCode).toBe(401);

    const reenabled = await context.adminRequest({
      method: "PATCH",
      url: `/api/v1/users/${tokenViewer.user.id}`,
      payload: { disabled: false, version: tokenViewer.user.version + 1 },
    });
    expect(reenabled.statusCode).toBe(200);
    expect((await tokenRequest({ method: "GET", url: "/api/v1/work-plans" })).statusCode).toBe(401);

    const reLogin = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "viewer-password", password: "viewer-password-123" } });
    expect(reLogin.statusCode).toBe(401);

    const reenabledPasswordViewer = await context.adminRequest({
      method: "PATCH",
      url: `/api/v1/users/${passwordViewer.user.id}`,
      payload: { disabled: false, version: passwordViewer.user.version + 1 },
    });
    expect(reenabledPasswordViewer.statusCode).toBe(200);

    const newPassword = await context.adminRequest({
      method: "PUT",
      url: `/api/v1/users/${passwordViewer.user.id}/password`,
      payload: { password: "brand-new-password-123", version: passwordViewer.user.version + 2 },
    });
    expect(newPassword.statusCode).toBe(200);
    const freshLogin = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "viewer-password", password: "brand-new-password-123" } });
    expect(freshLogin.statusCode).toBe(200);
    expect(freshLogin.json<{ user: { role: string } }>().user.role).toBe("viewer");

    const newToken = await context.adminRequest({
      method: "POST",
      url: `/api/v1/users/${tokenViewer.user.id}/tokens`,
      payload: { name: "重新签发", expiresAt: null },
    });
    expect(newToken.statusCode).toBe(201);
    const freshRequest = bearerRequest(context, newToken.json<{ token: string }>().token);
    expect((await freshRequest({ method: "GET", url: "/api/v1/work-plans" })).statusCode).toBe(200);
  });
});
