import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { CustomFieldDefinition, WorkbenchOverview } from "@workplan/contracts";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-workbench-production-tests",
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

// 求值时刻：2026-09-03（周四）11:30 北京时间 = 03:30Z（与 workbench.test.ts 同一时刻）。
const FROZEN_NOW = "2026-09-03T03:30:00.000Z";

// 三类计划性质：value 刻意与 label 不同——单选 text_value 存选项 value，
// 若实现误以 label「生产类」当过滤值，区块将一个不剩，用例即失败。
const NATURES = [
  { nature: "生产类", value: "production" },
  { nature: "非生产类", value: "non_production" },
  { nature: "未填", value: null },
] as const;

// 三个时间窗各铺一条：新开工（今天 14:00-18:00 尚未开始，pending）、
// 继续开工（昨天 09:00 → 后天 08:00，进行中）、接下来（明天周五 06:00-10:00，pending）。
const WINDOWS = [
  { window: "新开工", startAt: "2026-09-03T06:00:00.000Z", endAt: "2026-09-03T10:00:00.000Z" },
  { window: "继续开工", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z" },
  { window: "接下来", startAt: "2026-09-03T22:00:00.000Z", endAt: "2026-09-04T02:00:00.000Z" },
] as const;

const planTitle = (nature: string, window: string) => `${nature}-${window}`;

async function createPlanNatureField(context: TestContext): Promise<CustomFieldDefinition> {
  const response = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key: "plan_nature",
      label: "计划性质",
      description: "",
      type: "single_select",
      required: false,
      defaultValue: null,
      options: [
        { value: "production", label: "生产类" },
        { value: "non_production", label: "非生产类" },
      ],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<CustomFieldDefinition>();
}

async function seedPlansForAllNatures(context: TestContext, { withField = true }: { withField?: boolean } = {}) {
  for (const { nature, value } of NATURES) {
    for (const { window, startAt, endAt } of WINDOWS) {
      const response = await context.request({
        method: "POST",
        url: "/api/v1/work-plans",
        payload: {
          title: planTitle(nature, window),
          description: "",
          startAt,
          endAt,
          ...(withField && value ? { customFields: { plan_nature: value } } : {}),
        },
      });
      expect(response.statusCode).toBe(201);
    }
  }
}

async function overview(context: TestContext): Promise<WorkbenchOverview> {
  const response = await context.request({ method: "GET", url: "/api/v1/workbench/overview" });
  expect(response.statusCode).toBe(200);
  return response.json<WorkbenchOverview>();
}

function expectFallback(data: WorkbenchOverview) {
  expect(data.productionOnly).toBe(false);
  // 回退时区块含全部计划；同 startAt 的并列顺序无保证，按集合比较。
  expect([...data.startingToday.items.map((item) => item.title)].sort()).toEqual(
    NATURES.map(({ nature }) => planTitle(nature, "新开工")).sort(),
  );
  expect(data.startingToday.total).toBe(NATURES.length);
  expect(data.continuingToday.items).toHaveLength(NATURES.length);
  expect(data.upcoming.items).toHaveLength(NATURES.length);
  // 9 条：新开工与接下来各 3 条 pending、继续开工 3 条进行中
  expect(data.summary).toEqual({ all: 9, pending: 6, inProgress: 3, completed: 0 });
}

describe("工作台生产类过滤", () => {
  it("字段与选项齐备：三区块与汇总只含生产类，productionOnly 为 true", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await createPlanNatureField(context);
    await seedPlansForAllNatures(context);
    const data = await overview(context);
    expect(data.productionOnly).toBe(true);
    expect(data.startingToday.items.map((item) => item.title)).toEqual(["生产类-新开工"]);
    expect(data.continuingToday.items.map((item) => item.title)).toEqual(["生产类-继续开工"]);
    expect(data.upcoming.items.map((item) => item.title)).toEqual(["生产类-接下来"]);
    // 生产类 3 条：新开工与接下来 pending、继续开工进行中
    expect(data.summary).toEqual({ all: 3, pending: 2, inProgress: 1, completed: 0 });
  });

  it("无 plan_nature 字段：回退全量，productionOnly 为 false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    // 字段不存在时计划无法携带该自定义字段值，铺不带 customFields 的计划验证不过滤。
    await seedPlansForAllNatures(context, { withField: false });
    expectFallback(await overview(context));
  });

  it("字段已归档：回退全量，productionOnly 为 false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    const field = await createPlanNatureField(context);
    await seedPlansForAllNatures(context);
    const archived = await context.request({ method: "PATCH", url: `/api/v1/custom-fields/${field.id}`, payload: { archived: true, version: 1 } });
    expect(archived.statusCode).toBe(200);
    expectFallback(await overview(context));
  });

  it("「生产类」选项已归档：回退全量，productionOnly 为 false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    const field = await createPlanNatureField(context);
    await seedPlansForAllNatures(context);
    const productionOption = field.options.find((option) => option.label === "生产类")!;
    const archived = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-field-options/${productionOption.id}`,
      payload: { archived: true, version: 1 },
    });
    expect(archived.statusCode).toBe(200);
    expectFallback(await overview(context));
  });

  it("plan_nature 字段类型不符（非 single_select）：回退全量，productionOnly 为 false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "plan_nature", label: "计划性质", description: "", type: "boolean", required: false, defaultValue: null, options: [] },
    });
    expect(created.statusCode).toBe(201);
    await seedPlansForAllNatures(context, { withField: false });
    expectFallback(await overview(context));
  });

  it("多个非归档选项同 label「生产类」：判别歧义回退全量，productionOnly 为 false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "plan_nature",
        label: "计划性质",
        description: "",
        type: "single_select",
        required: false,
        defaultValue: null,
        options: [
          { value: "production_a", label: "生产类" },
          { value: "production_b", label: "生产类" },
          { value: "non_production", label: "非生产类" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    await seedPlansForAllNatures(context, { withField: false });
    expectFallback(await overview(context));
  });
});
