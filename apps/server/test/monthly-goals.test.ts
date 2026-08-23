import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions } from "fastify";
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

const planInput = (overrides: Record<string, unknown> = {}) => ({
  title: "官网改版计划",
  description: "完成新版官网的设计与发布",
  status: "pending",
  startAt: new Date(Date.now() + 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 7_200_000).toISOString(),
  customFields: {},
  ...overrides,
});

/** Strips the manual status so the plan records itself as automatic. */
const automaticPlanInput = (overrides: Record<string, unknown> = {}) => {
  const { status: _status, ...input } = planInput(overrides);
  return input;
};

const goalInput = (overrides: Record<string, unknown> = {}) => ({
  title: "完成官网改版",
  description: "主页与详情页上线",
  year: 2026,
  month: 8,
  ...overrides,
});

async function createGoal(context: TestContext, overrides: Record<string, unknown> = {}) {
  const response = await context.request({ method: "POST", url: "/api/v1/monthly-goals", payload: goalInput(overrides) });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; version: number; title: string }>();
}

async function createPlan(context: TestContext, input: Record<string, unknown>) {
  const response = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: input });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; version: number; title: string }>();
}

describe("monthly goal CRUD", () => {
  it("creates, reads, updates and lists goals with optimistic locking", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/monthly-goals", payload: goalInput() });
    expect(created.statusCode).toBe(201);
    const goal = created.json<{ id: string; version: number; status: string | null; linkedWorkPlan: unknown }>();
    expect(goal).toMatchObject({
      title: "完成官网改版",
      description: "主页与详情页上线",
      year: 2026,
      month: 8,
      version: 1,
      archivedAt: null,
      status: null,
      linkedWorkPlan: null,
    });

    const fetched = await context.request({ method: "GET", url: `/api/v1/monthly-goals/${goal.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(goal);

    const updated = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${goal.id}`,
      payload: { title: "完成新版官网改版", version: goal.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: "完成新版官网改版", description: "主页与详情页上线", version: 2 });

    const stale = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${goal.id}`,
      payload: { title: "并发修改", version: goal.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "VERSION_CONFLICT", detail: "数据已被修改，请刷新后重试" });

    const missing = await context.request({ method: "GET", url: `/api/v1/monthly-goals/00000000-0000-4000-8000-000000000001` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ code: string }>().code).toBe("NOT_FOUND");

    const badLink = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goals",
      payload: goalInput({ workPlanId: "00000000-0000-4000-8000-000000000002" }),
    });
    expect(badLink.statusCode).toBe(422);
    expect(badLink.json<{ detail: string }>().detail).toBe("关联的工作计划不存在");
  });

  it("filters and orders the list by year and month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const context = await createContext();
    await createGoal(context, { title: "八月目标", year: 2026, month: 8 });
    await createGoal(context, { title: "七月目标", year: 2026, month: 7 });
    await createGoal(context, { title: "去年目标", year: 2025, month: 12 });

    const august = await context.request({ method: "GET", url: "/api/v1/monthly-goals?year=2026&month=8" });
    expect(august.statusCode).toBe(200);
    expect(august.json<Array<{ title: string }>>().map((item) => item.title)).toEqual(["八月目标"]);

    const all = await context.request({ method: "GET", url: "/api/v1/monthly-goals" });
    expect(all.json<Array<{ title: string }>>().map((item) => item.title)).toEqual(["八月目标", "七月目标", "去年目标"]);

    const invalid = await context.request({ method: "GET", url: "/api/v1/monthly-goals?year=9999" });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json<{ detail: string }>().detail).toBe("查询参数无效");
  });

  it("archives and restores goals while hiding them from the default list", async () => {
    const context = await createContext();
    const goal = await createGoal(context);

    const archived = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${goal.id}`,
      payload: { archived: true, version: goal.version },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<{ archivedAt: string | null; version: number }>().archivedAt).not.toBeNull();

    const defaultList = await context.request({ method: "GET", url: "/api/v1/monthly-goals" });
    expect(defaultList.json<unknown[]>()).toHaveLength(0);
    const withArchived = await context.request({ method: "GET", url: "/api/v1/monthly-goals?includeArchived=true" });
    expect(withArchived.json<Array<{ title: string }>>().map((item) => item.title)).toEqual([goal.title]);

    const restored = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${goal.id}`,
      payload: { archived: false, version: archived.json<{ version: number }>().version },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ archivedAt: string | null }>().archivedAt).toBeNull();
    const afterRestore = await context.request({ method: "GET", url: "/api/v1/monthly-goals" });
    expect(afterRestore.json<unknown[]>()).toHaveLength(1);
  });

  it("deletes a goal permanently after version confirmation", async () => {
    const context = await createContext();
    const goal = await createGoal(context);

    const wrongVersion = await context.request({ method: "DELETE", url: `/api/v1/monthly-goals/${goal.id}?version=9` });
    expect(wrongVersion.statusCode).toBe(409);
    expect(wrongVersion.json<{ code: string }>().code).toBe("VERSION_CONFLICT");

    const deleted = await context.request({ method: "DELETE", url: `/api/v1/monthly-goals/${goal.id}?version=${goal.version}` });
    expect(deleted.statusCode).toBe(204);

    const gone = await context.request({ method: "GET", url: `/api/v1/monthly-goals/${goal.id}` });
    expect(gone.statusCode).toBe(404);
  });
});

describe("derived goal status", () => {
  it("derives status from the linked plan at read time, respecting manual overrides", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-22T04:00:00.000Z"));
    const context = await createContext();

    const future = await createPlan(context, automaticPlanInput({ title: "未来计划", startAt: "2026-08-22T05:00:00.000Z", endAt: "2026-08-22T06:00:00.000Z" }));
    const active = await createPlan(context, automaticPlanInput({ title: "进行中计划", startAt: "2026-08-22T03:00:00.000Z", endAt: "2026-08-22T05:00:00.000Z" }));
    const past = await createPlan(context, automaticPlanInput({ title: "过去计划", startAt: "2026-08-22T01:00:00.000Z", endAt: "2026-08-22T02:00:00.000Z" }));
    const cancelled = await createPlan(context, planInput({ title: "已取消计划", status: "cancelled", statusMode: "manual" }));

    await createGoal(context, { title: "跟随未来", workPlanId: future.id });
    await createGoal(context, { title: "跟随进行中", workPlanId: active.id });
    await createGoal(context, { title: "跟随过去", workPlanId: past.id });
    await createGoal(context, { title: "跟随已取消", workPlanId: cancelled.id });
    await createGoal(context, { title: "未关联目标" });

    const listed = await context.request({ method: "GET", url: "/api/v1/monthly-goals?year=2026&month=8" });
    const byTitle = new Map(listed.json<Array<{ title: string; status: string | null; linkedWorkPlan: { id: string; title: string } | null }>>().map((item) => [item.title, item]));
    expect(byTitle.get("跟随未来")?.status).toBe("pending");
    expect(byTitle.get("跟随进行中")?.status).toBe("in_progress");
    expect(byTitle.get("跟随过去")?.status).toBe("completed");
    expect(byTitle.get("跟随已取消")?.status).toBe("cancelled");
    expect(byTitle.get("未关联目标")?.status).toBeNull();
    expect(byTitle.get("跟随进行中")?.linkedWorkPlan).toEqual({ id: active.id, title: "进行中计划" });
    expect(byTitle.get("未关联目标")?.linkedWorkPlan).toBeNull();

    // The derivation is recomputed from the calendar, not from a stored snapshot.
    vi.setSystemTime(new Date("2026-08-22T06:30:00.000Z"));
    const refreshed = await context.request({ method: "GET", url: "/api/v1/monthly-goals?year=2026&month=8" });
    const refreshedByTitle = new Map(refreshed.json<Array<{ id: string; title: string; version: number; status: string | null }>>().map((item) => [item.title, item]));
    expect(refreshedByTitle.get("跟随进行中")?.status).toBe("completed");
    expect(refreshedByTitle.get("跟随已取消")?.status).toBe("cancelled");

    // Linking a goal to a plan after creation switches its status too.
    const unlinkedGoal = refreshedByTitle.get("未关联目标")!;
    const relinked = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${unlinkedGoal.id}`,
      payload: { workPlanId: active.id, version: unlinkedGoal.version },
    });
    expect(relinked.statusCode).toBe(200);
    expect(relinked.json<{ status: string | null; version: number }>()).toMatchObject({ status: "completed", version: 2 });

    const unlinked = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${unlinkedGoal.id}`,
      payload: { workPlanId: null, version: relinked.json<{ version: number }>().version },
    });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json<{ status: string | null; linkedWorkPlan: unknown }>()).toMatchObject({ status: null, linkedWorkPlan: null });
  });
});

describe("work plan side links", () => {
  it("creates, replaces and clears monthlyGoalIds from the work plan side", async () => {
    const context = await createContext();
    const first = await createGoal(context, { title: "第一目标" });
    const second = await createGoal(context, { title: "第二目标" });
    const third = await createGoal(context, { title: "第三目标" });

    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "关联计划", monthlyGoalIds: [first.id, second.id] }),
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json<{ id: string; version: number; monthlyGoalIds: string[] }>();
    expect(plan.monthlyGoalIds).toEqual([first.id, second.id]);

    const replaced = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plan.id}`,
      payload: { monthlyGoalIds: [second.id, third.id], version: plan.version },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json<{ monthlyGoalIds: string[] }>().monthlyGoalIds).toEqual([second.id, third.id]);

    const kept = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plan.id}`,
      payload: { title: "改名但保留关联", version: replaced.json<{ version: number }>().version },
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json<{ monthlyGoalIds: string[] }>().monthlyGoalIds).toEqual([second.id, third.id]);

    const cleared = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plan.id}`,
      payload: { monthlyGoalIds: [], version: kept.json<{ version: number }>().version },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<{ monthlyGoalIds: string[] }>().monthlyGoalIds).toEqual([]);

    const firstGoal = await context.request({ method: "GET", url: `/api/v1/monthly-goals/${first.id}` });
    expect(firstGoal.json<{ linkedWorkPlan: unknown }>().linkedWorkPlan).toBeNull();
  });

  it("rejects goals already linked to another plan and unknown goal ids", async () => {
    const context = await createContext();
    const goal = await createGoal(context, { title: "被占用的目标" });
    const owner = await createPlan(context, planInput({ title: "占用计划", monthlyGoalIds: [goal.id] }));

    const conflict = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "冲突计划", monthlyGoalIds: [goal.id] }),
    });
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json<{ detail: string; errors?: Record<string, string[]> }>()).toMatchObject({
      detail: "月目标「被占用的目标」已关联其他工作任务",
      errors: { monthlyGoalIds: [goal.id] },
    });

    const unknown = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${owner.id}`,
      payload: { monthlyGoalIds: ["00000000-0000-4000-8000-000000000003"], version: owner.version },
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json<{ detail: string }>().detail).toBe("关联的月目标不存在");
  });

  it("inherits monthlyGoalIds into generated series occurrences", async () => {
    const context = await createContext();
    const goal = await createGoal(context, { title: "周期目标" });
    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plan-series",
      payload: {
        workPlan: planInput({ title: "周期计划", monthlyGoalIds: [goal.id] }),
        recurrence: { frequency: "daily", interval: 1, count: 1, timeZone: "Asia/Shanghai" },
      },
    });
    expect(created.statusCode).toBe(201);
    const generated = created.json<{ generated: Array<{ id: string; monthlyGoalIds: string[] }> }>().generated;
    expect(generated).toHaveLength(1);
    expect(generated[0]!.monthlyGoalIds).toEqual([goal.id]);

    const occupied = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: planInput({ title: "撞车计划", monthlyGoalIds: [goal.id] }),
    });
    expect(occupied.statusCode).toBe(422);
  });
});

describe("editor permissions", () => {
  it("lets token and password editors fully manage monthly goals without admin restriction", async () => {
    const context = await createContext();

    const tokenEditor = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "token-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "月目标测试 Token",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(tokenEditor.statusCode).toBe(201);
    const bearer = tokenEditor.json<{ accessToken: { token: string } }>().accessToken.token;
    const tokenRequest = (options: InjectOptions) => context.app.inject({
      ...options,
      headers: { authorization: `Bearer ${bearer}`, ...options.headers },
    });

    const tokenCreated = await tokenRequest({ method: "POST", url: "/api/v1/monthly-goals", payload: goalInput({ title: "Token 编辑者目标" }) });
    expect(tokenCreated.statusCode).toBe(201);
    const tokenGoal = tokenCreated.json<{ id: string; version: number }>();
    const tokenList = await tokenRequest({ method: "GET", url: "/api/v1/monthly-goals" });
    expect(tokenList.statusCode).toBe(200);
    expect(tokenList.json<Array<{ title: string }>>().map((item) => item.title)).toContain("Token 编辑者目标");
    expect((await tokenRequest({ method: "PATCH", url: `/api/v1/monthly-goals/${tokenGoal.id}`, payload: { title: "Token 编辑者目标-改名", version: tokenGoal.version } })).statusCode).toBe(200);
    expect((await tokenRequest({ method: "DELETE", url: `/api/v1/monthly-goals/${tokenGoal.id}?version=${tokenGoal.version + 1}` })).statusCode).toBe(204);

    const tokenSeries = await tokenRequest({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: { template: { title: "Token 系列" }, frequency: "monthly", startPeriod: { year: 2026, month: 8 }, occurrenceCount: 2 },
    });
    expect(tokenSeries.statusCode).toBe(201);
    const tokenSeriesBody = tokenSeries.json<{ series: { id: string; version: number } }>().series;
    expect((await tokenRequest({ method: "GET", url: "/api/v1/monthly-goal-series" })).statusCode).toBe(200);
    expect((await tokenRequest({ method: "GET", url: `/api/v1/monthly-goal-series/${tokenSeriesBody.id}` })).statusCode).toBe(200);
    expect((await tokenRequest({ method: "DELETE", url: `/api/v1/monthly-goal-series/${tokenSeriesBody.id}?version=${tokenSeriesBody.version}` })).statusCode).toBe(204);

    const password = "very-secure-web-editor-password";
    const passwordEditor = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: { username: "web-editor", role: "editor", loginMode: "password", password },
    });
    expect(passwordEditor.statusCode).toBe(201);
    const login = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "web-editor", password } });
    expect(login.statusCode).toBe(200);
    const loginCookieHeader = login.headers["set-cookie"];
    const webCookie = (Array.isArray(loginCookieHeader) ? loginCookieHeader[0] : loginCookieHeader)!.split(";")[0]!;
    const webCsrf = login.json<{ csrfToken: string }>().csrfToken;
    const passwordRequest = (options: InjectOptions) => context.app.inject({
      ...options,
      headers: {
        cookie: webCookie,
        ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": webCsrf } : {}),
        ...options.headers,
      },
    });

    const webCreated = await passwordRequest({ method: "POST", url: "/api/v1/monthly-goals", payload: goalInput({ title: "密码编辑者目标" }) });
    expect(webCreated.statusCode).toBe(201);
    const webGoal = webCreated.json<{ id: string; version: number }>();
    expect((await passwordRequest({ method: "GET", url: `/api/v1/monthly-goals/${webGoal.id}` })).statusCode).toBe(200);
    expect((await passwordRequest({ method: "PATCH", url: `/api/v1/monthly-goals/${webGoal.id}`, payload: { archived: true, version: webGoal.version } })).statusCode).toBe(200);
    expect((await passwordRequest({ method: "DELETE", url: `/api/v1/monthly-goals/${webGoal.id}?version=${webGoal.version + 1}` })).statusCode).toBe(204);

    const webSeries = await passwordRequest({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: { template: { title: "密码系列" }, frequency: "quarterly", startPeriod: { year: 2026, month: 8 }, occurrenceCount: 2 },
    });
    expect(webSeries.statusCode).toBe(201);
    const webSeriesBody = webSeries.json<{ series: { id: string; version: number } }>().series;
    expect((await passwordRequest({ method: "PATCH", url: `/api/v1/monthly-goal-series/${webSeriesBody.id}`, payload: { occurrenceCount: 3, version: webSeriesBody.version } })).statusCode).toBe(200);
  });
});

describe("monthly goal series", () => {
  const seriesInput = (overrides: Record<string, unknown> = {}) => ({
    template: { title: "定期巡检", description: "每月巡检一次" },
    frequency: "monthly",
    interval: 1,
    startPeriod: { year: 2026, month: 8 },
    occurrenceCount: 3,
    ...overrides,
  });

  it("generates one independent instance per period with correct stepping", async () => {
    const context = await createContext();
    const monthly = await context.request({ method: "POST", url: "/api/v1/monthly-goal-series", payload: seriesInput() });
    expect(monthly.statusCode).toBe(201);
    const monthlyBody = monthly.json<{
      series: { id: string; frequency: string; interval: number; startPeriod: { year: number; month: number }; occurrenceCount: number | null; untilPeriod: { year: number; month: number } | null; active: boolean; instanceCount: number };
      generated: Array<{ title: string; description: string; year: number; month: number; seriesId: string; occurrenceKey: string; status: string | null; linkedWorkPlan: unknown }>;
    }>();
    expect(monthlyBody.series).toMatchObject({ frequency: "monthly", interval: 1, startPeriod: { year: 2026, month: 8 }, occurrenceCount: 3, untilPeriod: null, active: true, instanceCount: 3 });
    expect(monthlyBody.generated.map((goal) => goal.occurrenceKey)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthlyBody.generated.every((goal) => goal.title === "定期巡检" && goal.description === "每月巡检一次" && goal.seriesId === monthlyBody.series.id && goal.status === null && goal.linkedWorkPlan === null)).toBe(true);

    const quarterly = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ template: { title: "季度复盘" }, frequency: "quarterly", interval: 2, untilPeriod: { year: 2027, month: 8 }, occurrenceCount: null }),
    });
    expect(quarterly.statusCode).toBe(201);
    const quarterlyBody = quarterly.json<{ generated: Array<{ year: number; month: number }> }>();
    expect(quarterlyBody.generated.map((goal) => `${goal.year}-${String(goal.month).padStart(2, "0")}`)).toEqual(["2026-08", "2027-02", "2027-08"]);

    const yearly = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ frequency: "yearly", interval: 1, occurrenceCount: 3 }),
    });
    expect(yearly.statusCode).toBe(201);
    expect(yearly.json<{ generated: Array<{ year: number; month: number }> }>().generated.map((goal) => `${goal.year}-${String(goal.month).padStart(2, "0")}`)).toEqual(["2026-08", "2027-08", "2028-08"]);
  });

  it("intersects count and until periods, preferring whichever ends first", async () => {
    const context = await createContext();
    const untilFirst = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ occurrenceCount: 5, untilPeriod: { year: 2026, month: 11 } }),
    });
    expect(untilFirst.statusCode).toBe(201);
    expect(untilFirst.json<{ generated: unknown[] }>().generated).toHaveLength(4);

    const countFirst = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ occurrenceCount: 2, untilPeriod: { year: 2026, month: 12 } }),
    });
    expect(countFirst.statusCode).toBe(201);
    expect(countFirst.json<{ generated: unknown[] }>().generated).toHaveLength(2);
  });

  it("rejects unbounded, oversized and inverted ranges", async () => {
    const context = await createContext();
    const unbounded = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ occurrenceCount: null, untilPeriod: null }),
    });
    expect(unbounded.statusCode).toBe(422);
    expect(unbounded.json<{ detail: string }>().detail).toContain("必须指定期数或结束月份之一");

    const oversized = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ occurrenceCount: null, untilPeriod: { year: 2100, month: 8 } }),
    });
    expect(oversized.statusCode).toBe(422);
    expect(oversized.json<{ detail: string }>().detail).toBe("单次生成的期数不能超过 600");

    const inverted = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: seriesInput({ occurrenceCount: null, untilPeriod: { year: 2026, month: 7 } }),
    });
    expect(inverted.statusCode).toBe(422);
    expect(inverted.json<{ detail: string }>().detail).toContain("结束月份不能早于起始月份");
  });

  it("keeps instances independent and refills missing periods on rule update", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/monthly-goal-series", payload: seriesInput({ occurrenceCount: 3 }) });
    const series = created.json<{ series: { id: string; version: number; template: { title: string } }; generated: Array<{ id: string; version: number; title: string }> }>().series;
    const instances = created.json<{ generated: Array<{ id: string; version: number; title: string }> }>().generated;
    expect(instances).toHaveLength(3);

    const edited = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${instances[1]!.id}`,
      payload: { title: "巡检计划-独立修改", version: instances[1]!.version },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<{ title: string; seriesId: string }>()).toMatchObject({ title: "巡检计划-独立修改", seriesId: series.id });

    const archived = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goals/${instances[2]!.id}`,
      payload: { archived: true, version: instances[2]!.version },
    });
    expect(archived.statusCode).toBe(200);
    const detail = await context.request({ method: "GET", url: `/api/v1/monthly-goal-series/${series.id}` });
    expect(detail.json<{ instanceCount: number; template: { title: string } }>()).toMatchObject({ instanceCount: 3, template: { title: "定期巡检" } });
    expect(detail.json<{ instances: Array<{ archivedAt: string | null }> }>().instances.map((instance) => instance.archivedAt !== null).filter(Boolean)).toHaveLength(1);

    const extended = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goal-series/${series.id}`,
      payload: { occurrenceCount: 5, template: { title: "定期巡检（新模板）" }, version: series.version },
    });
    expect(extended.statusCode).toBe(200);
    const extendedBody = extended.json<{ series: { version: number; instanceCount: number }; generated: Array<{ occurrenceKey: string; title: string }> }>();
    expect(extendedBody.generated.map((goal) => ({ key: goal.occurrenceKey, title: goal.title }))).toEqual([
      { key: "2026-11", title: "定期巡检（新模板）" },
      { key: "2026-12", title: "定期巡检（新模板）" },
    ]);
    expect(extendedBody.series.instanceCount).toBe(5);

    // Deleting one instance removes it; the next rule update refills only missing periods.
    const deleted = await context.request({ method: "DELETE", url: `/api/v1/monthly-goals/${instances[0]!.id}?version=${instances[0]!.version}` });
    expect(deleted.statusCode).toBe(204);
    expect((await context.request({ method: "GET", url: `/api/v1/monthly-goal-series/${series.id}` })).json<{ instanceCount: number }>().instanceCount).toBe(4);
    const refilled = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goal-series/${series.id}`,
      payload: { occurrenceCount: 5, version: extendedBody.series.version },
    });
    expect(refilled.statusCode).toBe(200);
    expect(refilled.json<{ generated: Array<{ occurrenceKey: string }> }>().generated).toHaveLength(1);
    expect(refilled.json<{ generated: Array<{ occurrenceKey: string }> }>().generated[0]!.occurrenceKey).toBe("2026-08");
  });

  it("rejects stale versions and stops future generation while keeping instances", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/monthly-goal-series", payload: seriesInput() });
    const series = created.json<{ series: { id: string; version: number } }>().series;

    const stale = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goal-series/${series.id}`,
      payload: { occurrenceCount: 4, version: 99 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe("VERSION_CONFLICT");

    const stopped = await context.request({ method: "DELETE", url: `/api/v1/monthly-goal-series/${series.id}?version=${series.version}` });
    expect(stopped.statusCode).toBe(204);
    const afterStop = await context.request({ method: "GET", url: `/api/v1/monthly-goal-series/${series.id}` });
    expect(afterStop.json<{ active: boolean; instanceCount: number }>()).toMatchObject({ active: false, instanceCount: 3 });

    const stillGeneratesNothing = await context.request({
      method: "PATCH",
      url: `/api/v1/monthly-goal-series/${series.id}`,
      payload: { occurrenceCount: 4, version: series.version + 1 },
    });
    expect(stillGeneratesNothing.statusCode).toBe(200);
    expect(stillGeneratesNothing.json<{ generated: unknown[]; series: { active: boolean } }>().generated).toHaveLength(0);
    expect(stillGeneratesNothing.json<{ series: { active: boolean } }>().series.active).toBe(false);

    const missing = await context.request({ method: "GET", url: `/api/v1/monthly-goal-series/00000000-0000-4000-8000-000000000001` });
    expect(missing.statusCode).toBe(404);
  });
});

describe("transfer compatibility", () => {
  it("exports schema version 4 with goals and series while importing v1-v3 files", async () => {
    const context = await createContext();
    const plan = await createPlan(context, planInput({ title: "导出计划" }));
    await createGoal(context, { title: "导出目标", workPlanId: plan.id });
    const seriesCreated = await context.request({
      method: "POST",
      url: "/api/v1/monthly-goal-series",
      payload: {
        template: { title: "定期巡检", description: "每月巡检一次" },
        frequency: "monthly",
        interval: 1,
        startPeriod: { year: 2026, month: 8 },
        occurrenceCount: 3,
      },
    });
    expect(seriesCreated.statusCode).toBe(201);

    const exported = await context.request({ method: "GET", url: "/api/v1/export" });
    expect(exported.statusCode).toBe(200);
    const version4 = exported.json<{
      schemaVersion: number;
      exportedAt: string;
      data: Record<string, Array<Record<string, unknown>>>;
    }>();
    expect(version4.schemaVersion).toBe(4);
    expect(version4.data.monthly_goals).toHaveLength(4);
    expect(version4.data.monthly_goals[0]).toMatchObject({ title: "导出目标", work_plan_id: plan.id });
    expect(version4.data.monthly_goal_series).toHaveLength(1);
    expect(version4.data.monthly_goal_series[0]).toMatchObject({ frequency: "monthly", occurrence_count: 3 });
    expect(version4.data.monthly_goals.filter((row) => row.title === "定期巡检").every((row) => row.series_id === version4.data.monthly_goal_series[0]!.id)).toBe(true);
    expect(version4.data).not.toHaveProperty("tags");

    // A v3 file (pre-series) clears the series table and drops series columns from goals.
    const version3Payload = {
      schemaVersion: 3,
      exportedAt: version4.exportedAt,
      data: Object.fromEntries(
        Object
          .entries(version4.data)
          .filter(([key]) => key !== "monthly_goal_series")
          .map(([key, rows]) => [key, key === "monthly_goals"
            ? (rows as Array<Record<string, unknown>>).map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== "series_id" && column !== "occurrence_key")))
            : rows]),
      ),
    };
    const v3Validate = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: version3Payload });
    expect(v3Validate.statusCode).toBe(200);
    const v3Import = await context.request({ method: "POST", url: "/api/v1/import", payload: version3Payload });
    expect(v3Import.statusCode).toBe(200);
    expect(rowCount(context, "monthly_goal_series")).toBe(0);
    const goalsAfterV3 = await context.request({ method: "GET", url: "/api/v1/monthly-goals?includeArchived=true" });
    expect(goalsAfterV3.json<Array<{ title: string; seriesId: string | null }>>().map((goal) => goal.title).sort()).toEqual(["定期巡检", "定期巡检", "定期巡检", "导出目标"]);
    expect(goalsAfterV3.json<Array<{ seriesId: string | null }>>().every((goal) => goal.seriesId === null)).toBe(true);

    const version2Payload = {
      schemaVersion: 2,
      exportedAt: version4.exportedAt,
      data: Object.fromEntries(Object.entries(version4.data).filter(([key]) => key !== "monthly_goals" && key !== "monthly_goal_series")),
    };
    const v2Validate = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: version2Payload });
    expect(v2Validate.statusCode).toBe(200);
    expect(v2Validate.json<{ valid: boolean }>().valid).toBe(true);
    const v2Import = await context.request({ method: "POST", url: "/api/v1/import", payload: version2Payload });
    expect(v2Import.statusCode).toBe(200);
    expect(rowCount(context, "monthly_goals")).toBe(0);

    const version1Payload = {
      schemaVersion: 1,
      exportedAt: version4.exportedAt,
      data: Object.fromEntries(Object.entries(version2Payload.data).filter(([key]) => key !== "owner_account_mappings")),
    };
    const v1Validate = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: version1Payload });
    expect(v1Validate.statusCode).toBe(200);
    const v1Import = await context.request({ method: "POST", url: "/api/v1/import", payload: version1Payload });
    expect(v1Import.statusCode).toBe(200);
    const listed = await context.request({ method: "GET", url: "/api/v1/monthly-goals" });
    expect(listed.json<unknown[]>()).toHaveLength(0);
  });
});

function rowCount(context: TestContext, table: string): number {
  return (context.database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
