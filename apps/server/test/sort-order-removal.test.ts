import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { naturalSortKey } from "@workplan/contracts";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-removal-tests",
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

describe("工作计划 sortOrder 存储移除", () => {
  it("重排路由已删除：请求 404 且无任何数据副作用", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    const plan = created.json<{ id: string; version: number }>();

    const response = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/reorder",
      payload: { orderedIds: [plan.id] },
    });
    expect(response.statusCode).toBe(404);

    // 无副作用：数据未被改动
    const after = context.database.sqlite.prepare("SELECT version FROM work_plans WHERE id = ?").get(plan.id) as { version: number };
    expect(after.version).toBe(plan.version);
  });

  it("生产 schema 不再含 work_plans.sort_order 列与索引，其余索引与唯一约束保留", async () => {
    const context = await createContext();
    expect(context.database.sqlite.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 16 });

    const columns = (context.database.sqlite.prepare("PRAGMA table_info(work_plans)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).not.toContain("sort_order");
    expect(columns).toContain("title_sort_key");

    const indexes = (context.database.sqlite.prepare("PRAGMA index_list(work_plans)").all() as Array<{ name: string }>).map((index) => index.name);
    expect(indexes).not.toContain("work_plans_sort_idx");
    for (const kept of ["work_plans_schedule_idx", "work_plans_status_idx", "idx_work_plans_schedule_full", "idx_work_plans_title_key_asc", "idx_work_plans_title_key_desc"]) {
      expect(indexes).toContain(kept);
    }

    // UNIQUE(series_id, occurrence_key) 随重建保留：重复键仍被拒绝。
    context.database.sqlite
      .prepare("INSERT INTO work_plan_series(id, template_json, frequency, interval, time_zone, active, version, created_at, updated_at) VALUES ('series-x', '{}', 'daily', 1, 'Asia/Shanghai', 1, 1, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')")
      .run();
    const insert = context.database.sqlite.prepare(
      "INSERT INTO work_plans(id, title, status, status_mode, priority, start_at, end_at, created_at, updated_at, series_id, occurrence_key) VALUES (?, '撞键', 'pending', 'automatic', 'none', '2026-05-01T02:00:00.000Z', '2026-05-01T06:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'series-x', 'occ-x')",
    );
    insert.run("00000000-0000-4000-8000-00000000000a");
    expect(() => insert.run("00000000-0000-4000-8000-00000000000b")).toThrow();
  });

  it("新建、更新与全部读取路径不涉及 sort_order", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "无遗留列计划" }) });
    expect(created.statusCode).toBe(201);
    const plan = created.json<Record<string, unknown>>();
    expect(plan).not.toHaveProperty("sortOrder");

    const updated = await context.request({ method: "PATCH", url: `/api/v1/work-plans/${String(plan.id)}`, payload: { title: "更新后", version: 1 } });
    expect(updated.statusCode).toBe(200);

    const listed = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    for (const item of listed.json<Array<Record<string, unknown>>>()) expect(item).not.toHaveProperty("sortOrder");

    const queried = await context.request({ method: "POST", url: "/api/v1/work-plans/query", payload: { filters: [], range: {}, sort: [] } });
    for (const item of queried.json<{ items: Array<Record<string, unknown>> }>().items) expect(item).not.toHaveProperty("sortOrder");

    const searched = await context.request({ method: "POST", url: "/api/v1/work-plans/search", payload: { filters: [], sort: [], limit: 10, offset: 0 } });
    for (const item of searched.json<Array<Record<string, unknown>>>()) expect(item).not.toHaveProperty("sortOrder");

    const single = await context.request({ method: "GET", url: `/api/v1/work-plans/${String(plan.id)}` });
    expect(single.json<Record<string, unknown>>()).not.toHaveProperty("sortOrder");

    // SELECT * 的行对象里也不存在该列（列已从表中移除）。
    const row = context.database.sqlite.prepare("SELECT * FROM work_plans WHERE id = ?").get(plan.id) as Record<string, unknown>;
    expect(row).not.toHaveProperty("sort_order");
  });

  it("版本 4 旧备份（携带 sort_order 遗留键）可校验并导入，新导出为版本 5 且不含该键", async () => {
    const context = await createContext();
    await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "risk", label: "风险", description: "", type: "single_select", required: false, defaultValue: null, options: [{ value: "low", label: "低" }, { value: "high", label: "高" }] },
    });
    await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ title: "旧备份计划", customFields: { risk: "high" } }) });

    const exported = await context.request({ method: "GET", url: "/api/v1/export" });
    const backup = exported.json<{ schemaVersion: number; exportedAt: string; data: Record<string, Array<Record<string, unknown>>> }>();
    expect(backup.schemaVersion).toBe(5);
    for (const row of backup.data.work_plans) expect(row).not.toHaveProperty("sort_order");

    // 模拟票据 14–16 时代导出的版本 4 文件：work_plans 行带遗留 sort_order。
    const version4 = {
      schemaVersion: 4,
      exportedAt: backup.exportedAt,
      data: {
        ...backup.data,
        work_plans: backup.data.work_plans.map((row, index) => ({ ...row, sort_order: 100 - index })),
      },
    };
    const validation = await context.request({ method: "POST", url: "/api/v1/import/validate", payload: version4 });
    expect(validation.statusCode).toBe(200);
    expect(validation.json<{ valid: boolean }>().valid).toBe(true);

    const imported = await context.request({ method: "POST", url: "/api/v1/import", payload: version4 });
    expect(imported.statusCode).toBe(200);

    // 遗留列被忽略、业务数据完整、标题排序键重算。
    const listed = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=500" });
    expect(listed.json<Array<{ title: string }>>().map((item) => item.title)).toEqual(["旧备份计划"]);
    const row = context.database.sqlite.prepare("SELECT title_sort_key FROM work_plans").get() as { title_sort_key: string | null };
    expect(row.title_sort_key).toBe(naturalSortKey("旧备份计划"));
    const field = await context.request({ method: "GET", url: "/api/v1/custom-fields?includeArchived=true" });
    const risk = field.json<Array<{ key: string; sortOrder: number; options: Array<{ value: string; sortOrder: number }> }>>().find((item) => item.key === "risk");
    expect(risk?.sortOrder).toBe(0);
    expect(risk?.options.map((option) => option.sortOrder)).toEqual([0, 1]);
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

    const plan = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput({ customFields: { risk: "low" } }) });
    expect(plan.statusCode).toBe(201);
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
