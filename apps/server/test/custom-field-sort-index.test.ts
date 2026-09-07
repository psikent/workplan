import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { WorkPlan, WorkPlanQueryResponse } from "../src/modules/work-plan-query.js";

// 票据 20：自定义字段排序物化索引（custom_field_sort_index）回归。
// 覆盖：快路径与排序语义、触发器一致性（值变更/改期/选项重排/删除/导入恢复）、游标跨空值区、筛选组合。

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-sort-index-tests",
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

const planInput = (overrides: Record<string, unknown> = {}) => {
  const startAt = typeof overrides.startAt === "string" ? overrides.startAt : "2026-05-01T02:00:00.000Z";
  return {
    title: "示例计划",
    description: "",
    startAt,
    endAt: new Date(Date.parse(startAt) + 4 * 3600_000).toISOString(),
    ...overrides,
  };
};

async function createPlans(context: TestContext, inputs: Array<Record<string, unknown>>): Promise<WorkPlan[]> {
  const plans: WorkPlan[] = [];
  for (const input of inputs) {
    const response = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput(input) });
    expect(response.statusCode).toBe(201);
    plans.push(response.json<WorkPlan>());
  }
  return plans;
}

async function createField(context: TestContext, key: string, type: string, options: Array<{ value: string; label: string }> = []) {
  const response = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: { key, label: key, description: "", type, required: false, defaultValue: null, options },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; key: string; options: Array<{ id: string; value: string }> }>();
}

const query = (context: TestContext, payload: Record<string, unknown>) =>
  context.request({ method: "POST", url: "/api/v1/work-plans/query", payload });

const titles = (response: { json: <T>(mapper?: (value: unknown) => T) => T }) =>
  response.json<WorkPlanQueryResponse>().items.map((item) => item.title);

describe("排序索引快路径：排序语义", () => {
  it("物化索引与 NULLIF 空白防御：短文本空白与缺失同置后，快路径顺序稳定", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    await createPlans(context, [
      { title: "空白文本", customFields: { label: "   " } },
      { title: "有值甲", customFields: { label: "任务2" } },
      { title: "完全缺失" },
      { title: "有值乙", customFields: { label: "任务10" } },
    ]);
    const db = context.database.sqlite;
    // 索引表仅存非空键行：空白文本与完全缺失不入表，由查询侧空值区补齐
    const indexRows = db.prepare("SELECT COUNT(*) AS count FROM custom_field_sort_index").get() as { count: number };
    expect(indexRows.count).toBe(2);
    const blankRow = db
      .prepare("SELECT work_plan_id FROM custom_field_sort_index WHERE work_plan_id = (SELECT id FROM work_plans WHERE title = '空白文本')")
      .get();
    expect(blankRow).toBeUndefined();

    const asc = titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }));
    expect(asc).toEqual(["有值甲", "有值乙", "空白文本", "完全缺失"]);
    const desc = titles(await query(context, { sort: [{ field: "custom.label", direction: "desc" }] }));
    expect(desc).toEqual(["有值乙", "有值甲", "空白文本", "完全缺失"]);
  });

  it("数字/布尔/日期/日期时间类型快路径与 JOIN 路径语义一致", async () => {
    const context = await createContext();
    await createField(context, "budget", "number");
    await createField(context, "flag", "boolean");
    await createField(context, "day", "date");
    await createField(context, "moment", "datetime");
    await createPlans(context, [
      { title: "A", customFields: { budget: 30, flag: true, day: "2026-06-02", moment: "2026-06-01T10:00:00+08:00" } },
      { title: "B", customFields: { budget: -5, flag: false, day: "2026-06-01", moment: "2026-06-01T23:00:00Z" } },
      { title: "C", customFields: { budget: 12 } },
      { title: "D", customFields: {} },
    ]);
    expect(titles(await query(context, { sort: [{ field: "custom.budget", direction: "asc" }] }))).toEqual(["B", "C", "A", "D"]);
    expect(titles(await query(context, { sort: [{ field: "custom.budget", direction: "desc" }] }))[0]).toBe("A");
    const flagOrder = titles(await query(context, { sort: [{ field: "custom.flag", direction: "asc" }] }));
    expect(flagOrder.slice(0, 2)).toEqual(["B", "A"]);
    expect(new Set(flagOrder.slice(2))).toEqual(new Set(["C", "D"]));
    const dayOrder = titles(await query(context, { sort: [{ field: "custom.day", direction: "desc" }] }));
    expect(dayOrder.slice(0, 2)).toEqual(["A", "B"]);
    const momentOrder = titles(await query(context, { sort: [{ field: "custom.moment", direction: "asc" }] }));
    // +08:00 的 10:00 即 02:00Z，早于 23:00Z
    expect(momentOrder.slice(0, 2)).toEqual(["A", "B"]);
  });

  it("多级排序（自定义+内置）不走快路径且语义不变", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    await createPlans(context, [
      { title: "B-2", customFields: { label: "同值" } },
      { title: "A-1", customFields: { label: "同值" } },
      { title: "C-3", customFields: { label: "另一值" } },
    ]);
    const response = await query(context, {
      sort: [
        { field: "custom.label", direction: "asc" },
        { field: "title", direction: "asc" },
      ],
    });
    expect(titles(response)).toEqual(["C-3", "A-1", "B-2"]);
  });
});

describe("排序索引触发器一致性", () => {
  it("改期触发器：并列排序键由排期链决胜，改期后次序跟随", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    const plans = await createPlans(context, [
      { title: "早", startAt: "2026-05-01T02:00:00.000Z", customFields: { label: "同值" } },
      { title: "晚", startAt: "2026-05-02T02:00:00.000Z", customFields: { label: "同值" } },
    ]);
    expect(titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual(["早", "晚"]);
    // 改期：早 → 更晚，次序应反转
    const reschedule = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plans[0]!.id}/schedule`,
      payload: { startAt: "2026-05-03T02:00:00.000Z", endAt: "2026-05-03T06:00:00.000Z", version: 1 },
    });
    expect(reschedule.statusCode).toBe(200);
    const tailRow = context.database.sqlite
      .prepare("SELECT start_at FROM custom_field_sort_index WHERE work_plan_id = ?")
      .get(plans[0]!.id) as { start_at: string };
    expect(tailRow.start_at).toBe("2026-05-03T02:00:00.000Z");
    expect(titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual(["晚", "早"]);  });

  it("值变更触发器：更新值后索引随动", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    const plans = await createPlans(context, [
      { title: "甲", customFields: { label: "任务1" } },
      { title: "乙", customFields: { label: "任务2" } },
    ]);
    expect(titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual(["甲", "乙"]);
    const update = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plans[0]!.id}`,
      payload: { customFields: { label: "任务9" }, version: 1 },
    });
    expect(update.statusCode).toBe(200);
    expect(titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual(["乙", "甲"]);
    // 清空值 → 缺失置后（索引行随之删除）
    const clear = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${plans[0]!.id}`,
      payload: { customFields: { label: "" }, version: 2 },
    });
    expect(clear.statusCode).toBe(200);
    const rows = context.database.sqlite
      .prepare("SELECT work_plan_id FROM custom_field_sort_index WHERE work_plan_id = ?")
      .get(plans[0]!.id);
    expect(rows).toBeUndefined();
    expect(titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual(["乙", "甲"]);
  });

  it("选项重排与新增选项触发器：单选管理顺序即时生效", async () => {
    const context = await createContext();
    const field = await createField(context, "risk", "single_select", [
      { value: "low", label: "低" },
      { value: "mid", label: "中" },
      { value: "high", label: "高" },
    ]);
    await createPlans(context, [
      { title: "低计划", customFields: { risk: "low" } },
      { title: "中计划", customFields: { risk: "mid" } },
      { title: "高计划", customFields: { risk: "high" } },
    ]);
    const order = async () => titles(await query(context, { sort: [{ field: "custom.risk", direction: "asc" }] }));
    expect(await order()).toEqual(["低计划", "中计划", "高计划"]);

    // 重排：高 → 中 → 低
    const reordered = [field.options[2]!.id, field.options[1]!.id, field.options[0]!.id];
    const reorder = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: reordered },
    });
    expect(reorder.statusCode).toBe(200);
    expect(await order()).toEqual(["高计划", "中计划", "低计划"]);

    // 新增选项：持有原失效值的计划进入新选项的顺序位
    const addOption = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options`,
      payload: { value: "urgent", label: "紧急" },
    });
    expect(addOption.statusCode).toBe(201);
    context.database.sqlite
      .prepare("UPDATE custom_field_values SET text_value = 'urgent' WHERE text_value = 'mid'")
      .run();
    // urgent 追加为最大顺序位（选项列表末尾），持有它的计划排最后
    expect(await order()).toEqual(["高计划", "低计划", "中计划"]);
  });

  it("删除计划级联清理索引行，总数与页内容同步", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    const plans = await createPlans(context, [
      { title: "甲", customFields: { label: "任务1" } },
      { title: "乙", customFields: { label: "任务2" } },
    ]);
    const del = await context.request({ method: "DELETE", url: `/api/v1/work-plans/${plans[1]!.id}?version=1` });
    expect(del.statusCode).toBe(204);
    const indexCount = context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM custom_field_sort_index").get() as { count: number };
    expect(indexCount.count).toBe(1);
    const response = await query(context, { sort: [{ field: "custom.label", direction: "asc" }], limit: 100 });
    expect(response.json<WorkPlanQueryResponse>()).toMatchObject({ total: 1 });
    expect(titles(response)).toEqual(["甲"]);
  });

  it("JSON 导入恢复后索引整体重建，排序语义不变", async () => {
    const source = await createContext();
    await createField(source, "label", "short_text");
    await createPlans(source, [
      { title: "计划2", customFields: { label: "任务10" } },
      { title: "计划1", customFields: { label: "任务2" } },
      { title: "计划0" },
    ]);
    const exported = await source.request({ method: "GET", url: "/api/v1/export" });
    expect(exported.statusCode).toBe(200);
    const payload = exported.json();

    const target = await createContext();
    const imported = await target.request({ method: "POST", url: "/api/v1/import", payload });
    expect(imported.statusCode).toBe(200);
    // 恢复后索引行数与值行一致
    const indexCount = target.database.sqlite.prepare("SELECT COUNT(*) AS count FROM custom_field_sort_index").get() as { count: number };
    const valueCount = target.database.sqlite.prepare("SELECT COUNT(*) AS count FROM custom_field_values").get() as { count: number };
    expect(indexCount.count).toBe(valueCount.count);
    expect(titles(await query(target, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual([
      "计划1",
      "计划2",
      "计划0",
    ]);
  });
});

describe("排序索引快路径：游标与筛选", () => {
  it("游标分页跨空值区推进，nextCursor 末页恰为 null", async () => {
    const context = await createContext();
    await createField(context, "budget", "number");
    await createPlans(context, [
      { title: "P1", customFields: { budget: 10 } },
      { title: "P2", customFields: { budget: 20 } },
      { title: "P3" },
      { title: "P4" },
    ]);
    const page1 = await query(context, { sort: [{ field: "custom.budget", direction: "asc" }], limit: 2 });
    const body1 = page1.json<WorkPlanQueryResponse>();
    expect(body1.items.map((item) => item.title)).toEqual(["P1", "P2"]);
    expect(body1.total).toBe(4);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await query(context, { sort: [{ field: "custom.budget", direction: "asc" }], limit: 2, cursor: body1.nextCursor! });
    const body2 = page2.json<WorkPlanQueryResponse>();
    // P3/P4 同毫秒创建，空值区链位并列由随机 ID 决胜，只断言集合
    expect(new Set(body2.items.map((item) => item.title))).toEqual(new Set(["P3", "P4"]));
    expect(body2.total).toBe(4);
    expect(body2.nextCursor).toBeNull();

    // 降序同样跨空值区
    const page1Desc = await query(context, { sort: [{ field: "custom.budget", direction: "desc" }], limit: 2 });
    const body1Desc = page1Desc.json<WorkPlanQueryResponse>();
    expect(body1Desc.items.map((item) => item.title)).toEqual(["P2", "P1"]);
    const page2Desc = await query(context, { sort: [{ field: "custom.budget", direction: "desc" }], limit: 2, cursor: body1Desc.nextCursor! });
    expect(new Set(page2Desc.json<WorkPlanQueryResponse>().items.map((item) => item.title))).toEqual(new Set(["P3", "P4"]));
  });

  it("筛选与快路径组合：只含命中行，顺序保持", async () => {
    const context = await createContext();
    await createField(context, "budget", "number");
    await createPlans(context, [
      { title: "命中小", customFields: { budget: 10 } },
      { title: "排除", customFields: { budget: 20 } },
      { title: "命中大", customFields: { budget: 30 } },
      { title: "无值" },
    ]);
    const filtered = await query(context, {
      filters: [{ field: "custom.budget", op: "lte", value: 25 }],
      sort: [{ field: "custom.budget", direction: "desc" }],
      limit: 100,
    });
    const body = filtered.json<WorkPlanQueryResponse>();
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.title)).toEqual(["排除", "命中小"]);

    // 主表列筛选（状态/范围）走 JOIN 回连
    const rangeFiltered = await query(context, {
      filters: [{ field: "startAt", op: "gte", value: "2026-05-01T00:00:00.000Z" }],
      sort: [{ field: "custom.budget", direction: "asc" }],
      limit: 100,
    });
    // 范围筛选命中全部 4 行（同 start_at），顺序 = 键升序 + 空值区置后
    expect(rangeFiltered.json<WorkPlanQueryResponse>().items.map((item) => item.title)).toEqual([
      "命中小",
      "排除",
      "命中大",
      "无值",
    ]);

    const statusFiltered = await query(context, {
      q: "命中",
      sort: [{ field: "custom.budget", direction: "asc" }],
      limit: 100,
    });
    expect(statusFiltered.json<WorkPlanQueryResponse>().items.map((item) => item.title)).toEqual(["命中小", "命中大"]);
  });

  it("偏移分页兼容适配器（search）在快路径下正常", async () => {
    const context = await createContext();
    await createField(context, "budget", "number");
    await createPlans(context, [
      { title: "S1", customFields: { budget: 1 } },
      { title: "S2", customFields: { budget: 2 } },
      { title: "S3", customFields: { budget: 3 } },
    ]);
    const search = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/search",
      payload: { sort: [{ field: "custom.budget", direction: "asc" }], limit: 2, offset: 1 },
    });
    expect(search.statusCode).toBe(200);
    const items = search.json<Array<{ title: string }>>();
    expect(items.map((item) => item.title)).toEqual(["S2", "S3"]);
  });
});
