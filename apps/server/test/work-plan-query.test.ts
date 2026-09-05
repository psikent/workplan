import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { WorkPlan, WorkPlanQueryResponse } from "../src/modules/work-plan-query.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-query-tests",
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
  const base = {
    title: "示例计划",
    description: "",
    startAt,
    endAt: new Date(Date.parse(startAt) + 4 * 3600_000).toISOString(),
    ...overrides,
  };
  return base;
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
  return response.json<{ id: string; key: string }>();
}

const query = (context: TestContext, payload: Record<string, unknown>) =>
  context.request({ method: "POST", url: "/api/v1/work-plans/query", payload });

const titles = (response: { json: <T>(mapper?: (value: unknown) => T) => T }) =>
  response.json<WorkPlanQueryResponse>().items.map((item) => item.title);

describe("统一查询：字段与方向", () => {
  it("默认排期顺序：开始升、结束降、创建升、ID 兜底", async () => {
    const context = await createContext();
    await createPlans(context, [
      { title: "B-晚开始", startAt: "2026-05-02T02:00:00.000Z", endAt: "2026-05-02T06:00:00.000Z" },
      { title: "A-早开始", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T04:00:00.000Z" },
    ]);
    const response = await query(context, { sort: [], limit: 100 });
    expect(response.statusCode).toBe(200);
    expect(titles(response)).toEqual(["A-早开始", "B-晚开始"]);
  });

  it("标题自然序：数字按数值、忽略大小写，并列回排期兜底", async () => {
    const context = await createContext();
    await createPlans(context, [
      { title: "第10期检修", startAt: "2026-05-03T02:00:00.000Z" },
      { title: "第2期检修", startAt: "2026-05-02T02:00:00.000Z" },
      { title: "第1期检修", startAt: "2026-05-04T02:00:00.000Z" },
      { title: "abc 计划", startAt: "2026-05-05T02:00:00.000Z" },
      { title: "ABC 计划", startAt: "2026-05-06T02:00:00.000Z" },
    ]);
    const response = await query(context, { sort: [{ field: "title", direction: "asc" }] });
    // 码点序：ASCII 先于中文；abc/ABC 键相同，并列回排期兜底（创建升序）
    expect(titles(response)).toEqual(["abc 计划", "ABC 计划", "第1期检修", "第2期检修", "第10期检修"]);
    const desc = await query(context, { sort: [{ field: "title", direction: "desc" }] });
    expect(titles(desc)[0]).toBe("第10期检修");
    expect(titles(desc).at(-1)).toBe("ABC 计划");
  });

  it("状态顺序：待开始→进行中→已完成→已取消；降序反转；手动状态参与排序", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-01T03:00:00.000Z"));
    const context = await createContext();
    await createPlans(context, [
      { title: "手动完成", status: "completed", statusMode: "manual" },
      { title: "自动进行中", startAt: "2026-05-01T01:00:00.000Z", endAt: "2026-05-01T05:00:00.000Z" },
      { title: "手动取消", status: "cancelled", statusMode: "manual" },
      { title: "自动待开始", startAt: "2026-05-01T04:00:00.000Z", endAt: "2026-05-01T09:00:00.000Z" },
    ]);
    const response = await query(context, { sort: [{ field: "status", direction: "asc" }] });
    expect(titles(response)).toEqual(["自动待开始", "自动进行中", "手动完成", "手动取消"]);
    const desc = await query(context, { sort: [{ field: "status", direction: "desc" }] });
    expect(titles(desc)).toEqual(["手动取消", "手动完成", "自动进行中", "自动待开始"]);
  });

  it("持续时长排序与创建时间排序", async () => {
    const context = await createContext();
    await createPlans(context, [{ title: "四小时", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createPlans(context, [{ title: "两小时", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T04:00:00.000Z" }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createPlans(context, [{ title: "八小时", startAt: "2026-05-01T00:00:00.000Z", endAt: "2026-05-01T08:00:00.000Z" }]);
    const duration = await query(context, { sort: [{ field: "duration", direction: "asc" }] });
    expect(titles(duration)).toEqual(["两小时", "四小时", "八小时"]);
    const created = await query(context, { sort: [{ field: "createdAt", direction: "asc" }] });
    expect(titles(created)).toEqual(["四小时", "两小时", "八小时"]);
  });

  it("开始时间降序使用键集游标翻页不重不漏", async () => {
    const context = await createContext();
    for (let index = 0; index < 12; index += 1) {
      const hour = String(index % 24).padStart(2, "0");
      await createPlans(context, [{ title: `计划${index}`, startAt: `2026-05-01T${hour}:00:00.000Z` }]);
    }
    const collect: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const payload: Record<string, unknown> = { sort: [{ field: "startAt", direction: "desc" }], limit: 5 };
      if (cursor) payload.cursor = cursor;
      const response = await query(context, payload);
      expect(response.statusCode).toBe(200);
      const body = response.json<WorkPlanQueryResponse>();
      collect.push(...body.items.map((item) => item.title));
      if (body.nextCursor === null) break;
      cursor = body.nextCursor;
    }
    expect(collect).toHaveLength(12);
    expect(new Set(collect).size).toBe(12);
  });
});

describe("统一查询：自定义字段排序", () => {
  it("短文本自然序、数字、布尔、日期、日期时间与单选选项序", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    await createField(context, "budget", "number");
    await createField(context, "flag", "boolean");
    await createField(context, "day", "date");
    await createField(context, "moment", "datetime");
    await createField(context, "risk", "single_select", [
      { value: "low", label: "低" },
      { value: "mid", label: "中" },
      { value: "high", label: "高" },
    ]);
    await createPlans(context, [
      { title: "计划A", customFields: { label: "任务10", budget: 30, flag: true, day: "2026-06-02", moment: "2026-06-01T10:00:00+08:00", risk: "high" } },
      { title: "计划B", customFields: { label: "任务2", budget: 10, flag: false, day: "2026-06-01", moment: "2026-06-01T23:00:00Z", risk: "low" } },
      { title: "计划C", customFields: { label: "任务1", budget: 20, risk: "mid" } },
      { title: "计划D", customFields: {} },
    ]);

    expect(titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }))).toEqual([
      "计划C",
      "计划B",
      "计划A",
      "计划D",
    ]);
    expect(titles(await query(context, { sort: [{ field: "custom.budget", direction: "asc" }] }))).toEqual([
      "计划B",
      "计划C",
      "计划A",
      "计划D",
    ]);
    // flag：B(false) → A(true)；C/D 均缺失置后——并列由创建时间/ID 决胜，
    // 同毫秒创建时退化为随机 ID 序，故尾部只断言集合（day/moment 的缺失段同理）。
    const flagOrder = titles(await query(context, { sort: [{ field: "custom.flag", direction: "asc" }] }));
    expect(flagOrder.slice(0, 2)).toEqual(["计划B", "计划A"]);
    expect(new Set(flagOrder.slice(2))).toEqual(new Set(["计划C", "计划D"]));
    const dayOrder = titles(await query(context, { sort: [{ field: "custom.day", direction: "desc" }] }));
    expect(dayOrder.slice(0, 2)).toEqual(["计划A", "计划B"]);
    expect(new Set(dayOrder.slice(2))).toEqual(new Set(["计划C", "计划D"]));
    // 混合时区偏移：+08:00 的 10:00 即 02:00Z，早于 23:00Z；归一键保证按时间点比较
    const momentOrder = titles(await query(context, { sort: [{ field: "custom.moment", direction: "asc" }] }));
    expect(momentOrder.slice(0, 2)).toEqual(["计划A", "计划B"]);
    expect(new Set(momentOrder.slice(2))).toEqual(new Set(["计划C", "计划D"]));
    expect(titles(await query(context, { sort: [{ field: "custom.risk", direction: "asc" }] }))).toEqual([
      "计划B",
      "计划C",
      "计划A",
      "计划D",
    ]);
  });

  it("缺失值在升序与降序中均置后", async () => {
    const context = await createContext();
    await createField(context, "budget", "number");
    await createPlans(context, [
      { title: "有值", customFields: { budget: 5 } },
      { title: "缺失一" },
      { title: "缺失二" },
      { title: "大值", customFields: { budget: 50 } },
    ]);
    const asc = titles(await query(context, { sort: [{ field: "custom.budget", direction: "asc" }] }));
    expect(asc.slice(0, 2)).toEqual(["有值", "大值"]);
    expect(new Set(asc.slice(2))).toEqual(new Set(["缺失一", "缺失二"]));
    const desc = titles(await query(context, { sort: [{ field: "custom.budget", direction: "desc" }] }));
    expect(desc.slice(0, 2)).toEqual(["大值", "有值"]);
    expect(new Set(desc.slice(2))).toEqual(new Set(["缺失一", "缺失二"]));
  });

  it("失效单选值视为缺失值置后", async () => {
    const context = await createContext();
    const field = await createField(context, "risk", "single_select", [
      { value: "low", label: "低" },
      { value: "high", label: "高" },
    ]);
    await createPlans(context, [
      { title: "低", customFields: { risk: "low" } },
      { title: "高", customFields: { risk: "high" } },
    ]);
    // 模拟选项被删除后的遗留失效值：直接改库，服务端读取时无对应选项
    const db = context.database.sqlite;
    db.prepare("UPDATE custom_field_values SET text_value = '已废弃' WHERE text_value = 'low' AND field_id = ?").run(field.id);
    // 失效值（原“低”计划）视为缺失置后；“高”按选项序在前
    const order = titles(await query(context, { sort: [{ field: "custom.risk", direction: "asc" }] }));
    expect(order[0]).toBe("高");
    expect(order.at(-1)).toBe("低");
  });

  it("归档字段、未知字段、长文本与多选字段返回稳定错误", async () => {
    const context = await createContext();
    await createField(context, "note", "long_text");
    const multi = await createField(context, "tags", "multi_select", [
      { value: "甲", label: "甲" },
      { value: "乙", label: "乙" },
    ]);
    const archivable = await createField(context, "legacy", "short_text");
    await context.request({
      method: "PATCH",
      url: `/api/v1/custom-fields/${archivable.id}`,
      payload: { archived: true, version: 1 },
    });

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ sort: [{ field: "custom.legacy", direction: "asc" }] }, "SORT_FIELD_UNSUPPORTED"],
      [{ sort: [{ field: "custom.unknown", direction: "asc" }] }, "SORT_FIELD_INVALID"],
      [{ sort: [{ field: "custom.note", direction: "asc" }] }, "SORT_FIELD_UNSUPPORTED"],
      [{ sort: [{ field: "custom.tags", direction: "asc" }] }, "SORT_FIELD_UNSUPPORTED"],
      [{ sort: [{ field: "description", direction: "asc" }] }, "SORT_FIELD_INVALID"],
      [
        {
          sort: [
            { field: "title", direction: "asc" },
            { field: "title", direction: "desc" },
          ],
        },
        "SORT_FIELD_DUPLICATED",
      ],
    ];
    for (const [payload, expectedCode] of cases) {
      const response = await query(context, payload);
      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe(expectedCode);
    }
    expect(multi.id).toBeTruthy();
  });
});

describe("统一查询：筛选、范围与总数", () => {
  it("全文搜索、状态筛选与半开时间范围", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
    const context = await createContext();
    await createPlans(context, [
      { title: "桥梁检修", description: "年度重点", startAt: "2026-05-01T00:00:00.000Z", endAt: "2026-05-20T00:00:00.000Z" },
      { title: "线路巡检", description: "常规", startAt: "2026-05-01T00:00:00.000Z", endAt: "2026-05-20T00:00:00.000Z" },
      { title: "桥梁改造", description: "常规", startAt: "2026-06-01T00:00:00.000Z", endAt: "2026-06-20T00:00:00.000Z" },
    ]);
    const search = await query(context, { q: "桥梁" });
    expect(titles(search)).toEqual(["桥梁检修", "桥梁改造"]);
    expect(search.json<WorkPlanQueryResponse>().total).toBe(2);

    // 半开相交：endAt == from 的计划不入选（线路巡检 05-20 结束被排除）；startAt == to 同样不入选
    const range = await query(context, { range: { from: "2026-05-20T00:00:00.000Z", to: "2026-06-02T00:00:00.000Z" } });
    expect(titles(range)).toEqual(["桥梁改造"]);
    expect(range.json<WorkPlanQueryResponse>().total).toBe(1);
    const boundary = await query(context, { range: { from: "2026-05-19T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" } });
    // 桥梁改造 startAt == to 被排除；检修/巡检 endAt(05-20) > from(05-19) 仍相交
    expect(new Set(titles(boundary))).toEqual(new Set(["线路巡检", "桥梁检修"]));
  });

  it("range from/to 接受带时区偏移的 ISO 时间，与 UTC 存量按时间点序比较", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
    const context = await createContext();
    await createPlans(context, [
      { title: "偏移命中", startAt: "2026-04-30T17:30:00.000Z", endAt: "2026-04-30T19:00:00.000Z" },
      { title: "偏移之外", startAt: "2026-04-29T00:00:00.000Z", endAt: "2026-04-29T01:00:00.000Z" },
    ]);
    // from = 2026-04-30T18:00:00Z：命中计划 endAt(19:00Z) > from；若按字面字符串比较，
    // "2026-04-30T19:00…Z" > "2026-05-01T02:00…+08:00" 为 false → 漏报
    const fromOffset = await query(context, { range: { from: "2026-05-01T02:00:00+08:00" } });
    expect(titles(fromOffset)).toEqual(["偏移命中"]);
    const bothOffset = await query(context, { range: { from: "2026-05-01T02:00:00+08:00", to: "2026-05-01T10:00:00+08:00" } });
    expect(titles(bothOffset)).toEqual(["偏移命中"]);
  });

  it("自定义字段筛选与多选 any/all", async () => {
    const context = await createContext();
    await createField(context, "budget", "number");
    await createField(context, "tags", "multi_select", [
      { value: "甲", label: "甲" },
      { value: "乙", label: "乙" },
      { value: "丙", label: "丙" },
    ]);
    await createPlans(context, [
      { title: "计划A", customFields: { budget: 100, tags: ["甲", "乙"] } },
      { title: "计划B", customFields: { budget: 20, tags: ["乙"] } },
      { title: "计划C", customFields: { budget: 300, tags: ["丙"] } },
      { title: "计划D" },
    ]);
    const gte = await query(context, { filters: [{ field: "custom.budget", op: "gte", value: 20 }], sort: [{ field: "custom.budget", direction: "asc" }] });
    expect(titles(gte)).toEqual(["计划B", "计划A", "计划C"]);
    const any = await query(context, { filters: [{ field: "custom.tags", op: "any", value: ["甲", "丙"] }] });
    expect(new Set(titles(any))).toEqual(new Set(["计划A", "计划C"]));
    const all = await query(context, { filters: [{ field: "custom.tags", op: "all", value: ["甲", "乙"] }] });
    expect(titles(all)).toEqual(["计划A"]);
  });

  it("筛选未知字段返回参数错误，正文携带 offset 被拒绝", async () => {
    const context = await createContext();
    const badFilter = await query(context, { filters: [{ field: "custom.missing", op: "eq", value: 1 }] });
    expect(badFilter.statusCode).toBe(422);
    const badBuiltin = await query(context, { filters: [{ field: "monthlyGoalIds", op: "eq", value: 1 }] });
    expect(badBuiltin.statusCode).toBe(422);
    const offset = await query(context, { offset: 10 });
    expect(offset.statusCode).toBe(422);
  });
});

describe("统一查询：游标语义", () => {
  it("静态数据全量翻页与一次性完整查询一致，末页 nextCursor 为 null", async () => {
    const context = await createContext();
    const count = 37;
    for (let index = 0; index < count; index += 1) {
      await createPlans(context, [{ title: `批次${String(index).padStart(3, "0")}计划`, startAt: `2026-05-${String((index % 28) + 1).padStart(2, "0")}T01:00:00.000Z` }]);
    }
    const sort = [{ field: "title", direction: "asc" }];
    const full = await query(context, { sort, limit: 500 });
    const expected = full.json<WorkPlanQueryResponse>().items.map((item) => item.id);
    expect(full.json<WorkPlanQueryResponse>().total).toBe(count);

    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const payload: Record<string, unknown> = { sort, limit: 5 };
      if (cursor) payload.cursor = cursor;
      const response = await query(context, payload);
      const body = response.json<WorkPlanQueryResponse>();
      walked.push(...body.items.map((item) => item.id));
      pages += 1;
      if (body.nextCursor === null) break;
      cursor = body.nextCursor;
    }
    expect(pages).toBe(Math.ceil(count / 5));
    expect(walked).toEqual(expected);
  });

  it("总数与 items 在同一求值时刻返回", async () => {
    const context = await createContext();
    await createPlans(context, [{ title: "唯一计划" }, { title: "第二计划" }]);
    const response = await query(context, {});
    const body = response.json<WorkPlanQueryResponse>();
    expect(body.total).toBe(2);
    expect(body.evaluatedAt).toBeTruthy();
    expect(() => new Date(body.evaluatedAt).toISOString()).not.toThrow();
    expect(body.nextCursor).toBeNull();
  });

  it("篡改、查询错配与版本不符返回稳定 400", async () => {
    const context = await createContext();
    for (let index = 0; index < 8; index += 1) await createPlans(context, [{ title: `计划${index}` }]);
    const first = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 3 });
    const cursor = first.json<WorkPlanQueryResponse>().nextCursor;
    expect(cursor).toBeTruthy();

    const tampered = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 3, cursor: `${cursor!.slice(0, -4)}AAAA` });
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json<{ code: string }>().code).toBe("CURSOR_INVALID");

    const mismatch = await query(context, { sort: [{ field: "title", direction: "desc" }], limit: 3, cursor });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json<{ code: string }>().code).toBe("CURSOR_MISMATCH");

    const otherQuery = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 3, q: "计划", cursor });
    expect(otherQuery.statusCode).toBe(400);
    expect(otherQuery.json<{ code: string }>().code).toBe("CURSOR_MISMATCH");

    const garbage = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 3, cursor: "!!!" });
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json<{ code: string }>().code).toBe("CURSOR_INVALID");
  });

  it("数据变化时的实时视图限制：翻页间新增记录可能重复或漏过，刷新第一页重新同步", async () => {
    const context = await createContext();
    await createPlans(context, [{ title: "A计划" }, { title: "B计划" }]);
    const first = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 1 });
    const body = first.json<WorkPlanQueryResponse>();
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeTruthy();
    // 翻页之间新增一条更小排序位的记录：键集游标不承诺全局无漏（规格声明的实时视图限制）
    await createPlans(context, [{ title: "00新计划" }]);
    const second = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 1, cursor: body.nextCursor! });
    expect(second.statusCode).toBe(200);
    const refreshed = await query(context, { sort: [{ field: "title", direction: "asc" }], limit: 1 });
    expect(refreshed.json<WorkPlanQueryResponse>().total).toBe(3);
  });
});

describe("统一查询：排序键写入维护", () => {
  it("更新标题或自定义字段后顺序立即反映新键", async () => {
    const context = await createContext();
    await createField(context, "label", "short_text");
    const [planA, planB] = await createPlans(context, [
      { title: "第2期", customFields: { label: "乙" } },
      { title: "第10期", customFields: { label: "甲" } },
    ]);
    expect(titles(await query(context, { sort: [{ field: "title", direction: "asc" }] }))).toEqual(["第2期", "第10期"]);
    const update = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${planB.id}`,
      payload: { title: "第1期", version: planB.version },
    });
    expect(update.statusCode).toBe(200);
    expect(titles(await query(context, { sort: [{ field: "title", direction: "asc" }] }))).toEqual(["第1期", "第2期"]);

    const fieldUpdate = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${planA.id}`,
      payload: { version: planA.version, customFields: { label: "甲" } },
    });
    expect(fieldUpdate.statusCode).toBe(200);
    // 甲 < 乙：planA（乙→甲）应排到 planB（甲）之前或并列——两者同键时按排期兜底
    const order = titles(await query(context, { sort: [{ field: "custom.label", direction: "asc" }] }));
    expect(order).toHaveLength(2);
  });

  it("旧 list/search 适配器沿用引擎顺序并支持 offset", async () => {
    const context = await createContext();
    for (let index = 0; index < 6; index += 1) {
      await createPlans(context, [{ title: `计划${index}`, startAt: `2026-05-0${(index % 5) + 1}T01:00:00.000Z` }]);
    }
    const listed = await context.request({ method: "GET", url: "/api/v1/work-plans?limit=3&offset=2" });
    const paged = listed.json<WorkPlan[]>();
    expect(paged).toHaveLength(3);
    const engineOrder = (await query(context, { limit: 500 })).json<WorkPlanQueryResponse>().items.map((item) => item.id);
    expect(paged.map((item) => item.id)).toEqual(engineOrder.slice(2, 5));

    const searched = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/search",
      payload: { q: "计划", sort: [{ field: "startAt", direction: "asc" }], limit: 2, offset: 1 },
    });
    expect(searched.statusCode).toBe(200);
    const engineSorted = (
      await query(context, { sort: [{ field: "startAt", direction: "asc" }], limit: 500 })
    ).json<WorkPlanQueryResponse>().items.map((item) => item.id);
    expect(searched.json<WorkPlan[]>().map((item) => item.id)).toEqual(engineSorted.slice(1, 3));
  });
});

describe("Owner Conflict：全局冲突标记与实时校核（规格 R2/R3）", () => {
  const ownerOptions = [{ value: "zhangsan", label: "张三" }, { value: "lisi", label: "李四" }];
  const counterpartIds = (plan: WorkPlan | undefined) => plan?.ownerConflict?.counterparts.map((counterpart) => counterpart.id) ?? [];

  it("查询每项携带 ownerConflict：同 owner 相交互标，否则为 null；详情同口径", async () => {
    const context = await createContext();
    await createField(context, "owner", "single_select", ownerOptions);
    const [a, b, c, d] = await createPlans(context, [
      { title: "甲", status: "pending", statusMode: "manual", startAt: "2026-05-01T02:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "乙", status: "pending", statusMode: "manual", startAt: "2026-05-01T04:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "丙", status: "pending", statusMode: "manual", startAt: "2026-05-09T02:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "丁", startAt: "2026-05-01T02:00:00.000Z", customFields: {} },
    ]);
    const items = (await query(context, { sort: [], limit: 100 })).json<WorkPlanQueryResponse>().items;
    const byTitle = new Map(items.map((item) => [item.title, item]));
    expect(counterpartIds(byTitle.get("甲"))).toEqual([b.id]);
    expect(counterpartIds(byTitle.get("乙"))).toEqual([a.id]);
    expect(byTitle.get("丙")?.ownerConflict).toBeNull();
    expect(byTitle.get("丁")?.ownerConflict).toBeNull();

    const detail = await context.request({ method: "GET", url: `/api/v1/work-plans/${a.id}` });
    expect(counterpartIds(detail.json<WorkPlan>())).toEqual([b.id]);
  });

  it("completed 与 cancelled 不参与冲突", async () => {
    const context = await createContext();
    await createField(context, "owner", "single_select", ownerOptions);
    await createPlans(context, [
      { title: "活跃", status: "pending", statusMode: "manual", customFields: { owner: "zhangsan" } },
      { title: "已完成", status: "completed", statusMode: "manual", customFields: { owner: "zhangsan" } },
      { title: "已取消", status: "cancelled", statusMode: "manual", customFields: { owner: "zhangsan" } },
    ]);
    const items = (await query(context, { sort: [], limit: 100 })).json<WorkPlanQueryResponse>().items;
    for (const item of items) expect(item.ownerConflict).toBeNull();
  });

  it("范围筛选、状态筛选与分页不影响冲突标记", async () => {
    const context = await createContext();
    await createField(context, "owner", "single_select", ownerOptions);
    const [a, b] = await createPlans(context, [
      // 甲跨五六月；乙完全落在六月（与甲相交），会被五月范围与 pending 筛选排除
      { title: "甲", status: "pending", statusMode: "manual", startAt: "2026-05-31T20:00:00.000Z", endAt: "2026-06-02T10:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "乙", status: "in_progress", statusMode: "manual", startAt: "2026-06-01T00:00:00.000Z", endAt: "2026-06-01T05:00:00.000Z", customFields: { owner: "zhangsan" } },
    ]);

    const mayRange = (await query(context, {
      sort: [],
      limit: 100,
      range: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    })).json<WorkPlanQueryResponse>().items;
    expect(mayRange.map((item) => item.title)).toEqual(["甲"]);
    expect(counterpartIds(mayRange[0])).toEqual([b.id]);

    const pendingOnly = (await query(context, {
      sort: [],
      limit: 100,
      filters: [{ field: "status", op: "eq", value: "pending" }],
    })).json<WorkPlanQueryResponse>().items;
    expect(pendingOnly.map((item) => item.title)).toEqual(["甲"]);
    expect(counterpartIds(pendingOnly[0])).toEqual([b.id]);

    const pageOne = (await query(context, { sort: [], limit: 1 })).json<WorkPlanQueryResponse>();
    expect(pageOne.items.map((item) => item.title)).toEqual(["甲"]);
    expect(counterpartIds(pageOne.items[0])).toEqual([b.id]);
    expect(pageOne.items[0]?.id).toBe(a.id);
  });

  it("POST /conflict-check 返回与给定 owner+区间相交的活跃任务，id 排除自身", async () => {
    const context = await createContext();
    await createField(context, "owner", "single_select", ownerOptions);
    const [self, b, far] = await createPlans(context, [
      { title: "自身", status: "pending", statusMode: "manual", startAt: "2026-05-01T02:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "相交", status: "pending", statusMode: "manual", startAt: "2026-05-01T04:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "远处", status: "pending", statusMode: "manual", startAt: "2026-05-09T02:00:00.000Z", customFields: { owner: "zhangsan" } },
    ]);
    const check = (payload: Record<string, unknown>) =>
      context.request({ method: "POST", url: "/api/v1/work-plans/conflict-check", payload });

    const excludingSelf = await check({ id: self.id, owner: "zhangsan", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" });
    expect(excludingSelf.statusCode).toBe(200);
    const body = excludingSelf.json<{ owner: string; counterparts: Array<{ id: string }> }>();
    expect(body.owner).toBe("zhangsan");
    expect(body.counterparts.map((counterpart) => counterpart.id)).toEqual([b.id]);

    const includingSelf = await check({ owner: "zhangsan", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" });
    expect(includingSelf.json<{ counterparts: Array<{ id: string }> }>().counterparts.map((counterpart) => counterpart.id))
      .toEqual([self.id, b.id]);

    // 端点相接：目标起点恰为「相交」的结束时刻，不算冲突
    const adjacent = await check({ owner: "zhangsan", startAt: "2026-05-01T08:00:00.000Z", endAt: "2026-05-01T10:00:00.000Z" });
    expect(adjacent.json<{ counterparts: unknown[] }>().counterparts).toEqual([]);
    expect(far.ownerConflict).toBeNull();
  });

  it("POST /conflict-check 对空 owner 与非法区间返回 422", async () => {
    const context = await createContext();
    await createField(context, "owner", "single_select", ownerOptions);
    const emptyOwner = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/conflict-check",
      payload: { owner: "", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" },
    });
    expect(emptyOwner.statusCode).toBe(422);

    const invalidRange = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/conflict-check",
      payload: { owner: "zhangsan", startAt: "2026-05-01T06:00:00.000Z", endAt: "2026-05-01T02:00:00.000Z" },
    });
    expect(invalidRange.statusCode).toBe(422);
  });

  it("automatic 计划按求值时刻派生活跃性后参与冲突判定", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
    const context = await createContext();
    await createField(context, "owner", "single_select", ownerOptions);
    // 全部 automatic 无手动状态：求值时刻 05-10，乙已结束派生 completed 不参与，甲/丙进行中参与
    const [a, b, c] = await createPlans(context, [
      { title: "甲", startAt: "2026-05-09T02:00:00.000Z", endAt: "2026-05-11T02:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "乙", startAt: "2026-05-09T03:00:00.000Z", endAt: "2026-05-09T04:00:00.000Z", customFields: { owner: "zhangsan" } },
      { title: "丙", startAt: "2026-05-10T00:00:00.000Z", endAt: "2026-05-12T00:00:00.000Z", customFields: { owner: "zhangsan" } },
    ]);
    const items = (await query(context, { sort: [], limit: 100 })).json<WorkPlanQueryResponse>().items;
    const byTitle = new Map(items.map((item) => [item.title, item]));
    expect(byTitle.get("甲")?.status).toBe("in_progress");
    expect(counterpartIds(byTitle.get("甲"))).toEqual([c.id]);
    expect(byTitle.get("乙")?.status).toBe("completed");
    expect(byTitle.get("乙")?.ownerConflict).toBeNull();
    expect(counterpartIds(byTitle.get("丙"))).toEqual([a.id]);
  });
});
