import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { WORK_PLAN_SORT_ORDER_NEUTRAL } from "../src/modules/work-plans.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-retire-tests",
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
    request: (options: InjectOptions) =>
      built.app.inject({
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
  title: "示例计划",
  description: "",
  startAt: "2026-05-01T02:00:00.000Z",
  endAt: "2026-05-01T06:00:00.000Z",
  ...overrides,
});

describe("工作计划 sortOrder 兼容退役", () => {
  it("重排路由成为无副作用 410 墓碑并输出可计数的结构化日志", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    const plan = created.json<{ id: string; version: number }>();

    const response = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/reorder",
      payload: { orderedIds: [plan.id] },
    });
    expect(response.statusCode).toBe(410);
    const problem = response.json<{ code: string; title: string; status: number }>();
    expect(problem.code).toBe("WORK_PLAN_REORDER_RETIRED");
    expect(problem.status).toBe(410);

    // 无副作用：数据未被改动
    const after = context.database.sqlite.prepare("SELECT version, sort_order FROM work_plans WHERE id = ?").get(plan.id) as { version: number; sort_order: number };
    expect(after.version).toBe(plan.version);
    expect(after.sort_order).toBe(WORK_PLAN_SORT_ORDER_NEUTRAL);
  });

  it("任一 Work Plan 响应不含 sortOrder，新建记录仅写中性兼容值", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "中性值计划" }) });
    expect(created.statusCode).toBe(201);
    const plan = created.json<Record<string, unknown>>();
    expect(plan).not.toHaveProperty("sortOrder");

    const listed = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    for (const item of listed.json<Array<Record<string, unknown>>>()) expect(item).not.toHaveProperty("sortOrder");

    const queried = await context.request({ method: "POST", url: "/api/v1/work-plans/query", payload: { filters: [], range: {}, sort: [] } });
    for (const item of queried.json<{ items: Array<Record<string, unknown>> }>().items) expect(item).not.toHaveProperty("sortOrder");

    const searched = await context.request({ method: "POST", url: "/api/v1/work-plans/search", payload: { filters: [], sort: [], limit: 10, offset: 0 } });
    for (const item of searched.json<Array<Record<string, unknown>>>()) expect(item).not.toHaveProperty("sortOrder");

    const single = await context.request({ method: "GET", url: `/api/v1/work-plans/${String(plan.id)}` });
    expect(single.json<Record<string, unknown>>()).not.toHaveProperty("sortOrder");

    const row = context.database.sqlite.prepare("SELECT sort_order FROM work_plans WHERE id = ?").get(plan.id) as { sort_order: number };
    expect(row.sort_order).toBe(WORK_PLAN_SORT_ORDER_NEUTRAL);
  });

  it("退役不影响自定义字段定义、选项与配置包排序", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "risk",
        label: "风险",
        description: "",
        type: "single_select",
        required: false,
        defaultValue: null,
        options: [
          { value: "low", label: "低" },
          { value: "high", label: "高" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);

    // 触发墓碑与一次完整导出/导入往返后再检查字段排序
    const plan = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ customFields: { risk: "low" } }) });
    expect(plan.statusCode).toBe(201);
    await context.request({ method: "POST", url: "/api/v1/work-plans/reorder", payload: { orderedIds: [String(plan.json<{ id: string }>().id)] } });
    const exported = await context.request({ method: "GET", url: "/api/v1/export" });
    expect(exported.statusCode).toBe(200);

    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields?includeArchived=true" });
    const field = fields.json<Array<{ key: string; sortOrder: number; options: Array<{ value: string; sortOrder: number }> }>>().find((item) => item.key === "risk");
    expect(field?.sortOrder).toBe(0);
    expect(field?.options.map((option) => option.sortOrder)).toEqual([0, 1]);

    const backup = exported.json<{ data: Record<string, Array<Record<string, unknown>>> }>();
    const definition = backup.data.custom_field_definitions?.find((row) => row.key === "risk");
    expect(definition).toMatchObject({ sort_order: 0 });
    const optionRows = (backup.data.custom_field_options ?? []).filter((row) => row.field_id === definition?.id);
    expect(optionRows.map((row) => row.sort_order)).toEqual([0, 1]);
  });
});
