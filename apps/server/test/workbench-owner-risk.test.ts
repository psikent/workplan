import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { CustomFieldDefinition, WorkbenchOverview } from "@workplan/contracts";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-workbench-owner-risk-tests",
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

// 三个时间窗各一条：新开工（今天 14:00-18:00）、继续开工（昨天 09:00 → 后天 08:00）、接下来（明天周五 06:00-10:00）。
const WINDOWS = [
  { window: "新开工", startAt: "2026-09-03T06:00:00.000Z", endAt: "2026-09-03T10:00:00.000Z" },
  { window: "继续开工", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z" },
  { window: "接下来", startAt: "2026-09-03T22:00:00.000Z", endAt: "2026-09-04T02:00:00.000Z" },
] as const;

// 选项 value 刻意≠label（人名/档位都不用 value 直译），钉死「持久化 value、下发 label」的换算。
const OWNERS = [
  { value: "acct_zhang", label: "张三" },
  { value: "acct_li", label: "李四" },
] as const;
const RISKS = [
  { value: "opt_acceptable", label: "可接受" },
  { value: "opt_low", label: "低" },
  { value: "opt_medium", label: "中" },
  { value: "opt_high", label: "高" },
] as const;

// 各窗口行的负责人与风险：覆盖四档中的 可接受/中/高，「低」由回退用例覆盖。
const ASSIGNMENTS = [
  { owner: "acct_zhang", risk: "opt_medium" },
  { owner: "acct_li", risk: "opt_acceptable" },
  { owner: "acct_zhang", risk: "opt_high" },
] as const;

async function createFields(context: TestContext): Promise<{ owner: CustomFieldDefinition; risk: CustomFieldDefinition }> {
  const owner = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: { key: "owner", label: "负责人", description: "", type: "single_select", required: false, defaultValue: null, options: [...OWNERS] },
  });
  const risk = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: { key: "risk", label: "风险等级", description: "", type: "single_select", required: false, defaultValue: null, options: [...RISKS] },
  });
  expect(owner.statusCode).toBe(201);
  expect(risk.statusCode).toBe(201);
  return { owner: owner.json<CustomFieldDefinition>(), risk: risk.json<CustomFieldDefinition>() };
}

async function seedPlans(context: TestContext, assign: boolean) {
  for (const [index, { window, startAt, endAt }] of WINDOWS.entries()) {
    const assignment = ASSIGNMENTS[index]!;
    const response = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: {
        title: `计划-${window}`,
        description: "",
        startAt,
        endAt,
        ...(assign ? { customFields: { owner: assignment.owner, risk: assignment.risk } } : {}),
      },
    });
    expect(response.statusCode).toBe(201);
  }
}

async function overview(context: TestContext): Promise<WorkbenchOverview> {
  const response = await context.request({ method: "GET", url: "/api/v1/workbench/overview" });
  expect(response.statusCode).toBe(200);
  return response.json<WorkbenchOverview>();
}

async function archiveOption(context: TestContext, optionId: string) {
  const response = await context.request({
    method: "PATCH",
    url: `/api/v1/custom-field-options/${optionId}`,
    payload: { archived: true, version: 1 },
  });
  expect(response.statusCode).toBe(200);
}

describe("工作台负责人与风险标签投影", () => {
  it("字段齐备：按定义把选项 value 换算成 label 下发", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await createFields(context);
    await seedPlans(context, true);
    const data = await overview(context);
    expect(data.startingToday.items.map((item) => [item.title, item.ownerLabel, item.riskLabel])).toEqual([["计划-新开工", "张三", "中"]]);
    expect(data.continuingToday.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([["李四", "可接受"]]);
    expect(data.upcoming.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([["张三", "高"]]);
  });

  it("值未填：ownerLabel 为 null，riskLabel 回退「低」", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await createFields(context);
    await seedPlans(context, false);
    const data = await overview(context);
    for (const block of [data.startingToday, data.continuingToday, data.upcoming]) {
      expect(block.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([[null, "低"]]);
    }
  });

  it("字段缺失：ownerLabel 为 null，riskLabel 回退「低」", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await seedPlans(context, false);
    const data = await overview(context);
    for (const block of [data.startingToday, data.continuingToday, data.upcoming]) {
      expect(block.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([[null, "低"]]);
    }
  });

  it("字段类型不符（非 single_select）：值不可换算，ownerLabel 为 null、riskLabel 回退「低」", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    // owner 建为 short_text：值是自由文本而非选项 value，换算必须走回退而非报错。
    const created = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "owner", label: "负责人", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
    });
    expect(created.statusCode).toBe(201);
    for (const { window, startAt, endAt } of WINDOWS) {
      const response = await context.request({
        method: "POST",
        url: "/api/v1/work-plans",
        payload: { title: `计划-${window}`, description: "", startAt, endAt, customFields: { owner: "张三本人" } },
      });
      expect(response.statusCode).toBe(201);
    }
    const data = await overview(context);
    for (const block of [data.startingToday, data.continuingToday, data.upcoming]) {
      expect(block.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([[null, "低"]]);
    }
  });

  it("选项已归档：owner 回退 null，risk 回退「低」", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    const { owner, risk } = await createFields(context);
    await seedPlans(context, true);
    await archiveOption(context, owner.options.find((option) => option.value === "acct_zhang")!.id);
    await archiveOption(context, risk.options.find((option) => option.value === "opt_high")!.id);
    const data = await overview(context);
    // 新开工行引用 张三/中（张三已归档）；接下来的行引用 张三/高（两者均已归档）。
    expect(data.startingToday.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([[null, "中"]]);
    expect(data.upcoming.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([[null, "低"]]);
    // 继续开工行引用 李四/可接受，均未归档，换算不受影响。
    expect(data.continuingToday.items.map((item) => [item.ownerLabel, item.riskLabel])).toEqual([["李四", "可接受"]]);
  });
});
