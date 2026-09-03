import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { WorkPlan, WorkbenchOverview } from "../src/modules/workbench.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-workbench-tests",
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

// 求值时刻：2026-09-03（周四）11:30 北京时间 = 03:30Z。
// 第七个工作日（含）= 2026-09-14（周一）；窗口含周末 09-05/09-06。
const FROZEN_NOW = "2026-09-03T03:30:00.000Z";
const todayStart = "2026-09-02T16:00:00.000Z"; // 北京时间 09-03 00:00
const yesterdayStart = "2026-09-01T16:00:00.000Z";

const planInput = (overrides: Record<string, unknown> = {}) => ({
  title: "示例计划",
  description: "",
  startAt: "2026-09-03T01:00:00.000Z",
  endAt: "2026-09-03T05:00:00.000Z",
  ...overrides,
});

async function createPlans(context: TestContext, inputs: Array<Record<string, unknown>>): Promise<WorkPlan[]> {
  const plans: WorkPlan[] = [];
  for (const input of inputs) {
    const response = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput(input) });
    expect(response.statusCode).toBe(201);
    plans.push(response.json<WorkPlan>());
  }
  return plans;
}

async function overview(context: TestContext, limit?: number): Promise<WorkbenchOverview> {
  const response = await context.request({ method: "GET", url: `/api/v1/workbench/overview${limit ? `?limit=${limit}` : ""}` });
  expect(response.statusCode).toBe(200);
  return response.json<WorkbenchOverview>();
}

describe("工作台区块成员与边界", () => {
  it("半开区间：恰在午夜开始属于今天，恰在午夜结束不属于继续开工", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await createPlans(context, [
      { title: "午夜开始", startAt: todayStart, endAt: "2026-09-03T02:00:00.000Z" }, // 09-03 00:00 本地
      { title: "午夜即结束", startAt: "2026-09-02T01:00:00.000Z", endAt: todayStart }, // 09-02 01:00 → 09-03 00:00
      { title: "跨日未结束", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-03T09:00:00.000Z" },
    ]);
    const data = await overview(context);
    expect(data.today).toBe("2026-09-03");
    expect(data.startingToday.items.map((item) => item.title)).toEqual(["午夜开始"]);
    expect(data.continuingToday.items.map((item) => item.title)).toEqual(["跨日未结束"]);
  });

  it("有效状态：手动完成覆盖自动状态；今天完成的仍在今日新开工；取消不进任何区块", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await createPlans(context, [
      { title: "今天新开-已完成", status: "completed", statusMode: "manual" },
      { title: "今天新开-已取消", status: "cancelled", statusMode: "manual" },
      { title: "昨天开工-手动完成", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z", status: "completed", statusMode: "manual" },
      { title: "昨天开工-今天已结束", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-02T19:00:00.000Z" }, // 本地 09-03 03:00 结束
      { title: "昨天开工-仍在进行", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z" },
    ]);
    const data = await overview(context);
    expect(data.startingToday.items.map((item) => item.title)).toEqual(["今天新开-已完成"]);
    // 今天 03:00 已结束的计划有效状态为已完成，不进入继续开工
    expect(data.continuingToday.items.map((item) => item.title)).toEqual(["昨天开工-仍在进行"]);
    const all = [...data.startingToday.items, ...data.continuingToday.items, ...data.upcoming.items].map((item) => item.title);
    expect(all).not.toContain("今天新开-已取消");
  });

  it("Upcoming Window：明天起至第七个工作日（含），包含中间周末", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await createPlans(context, [
      { title: "明天周五", startAt: "2026-09-03T22:00:00.000Z", endAt: "2026-09-04T02:00:00.000Z" }, // 本地 09-04 06:00
      { title: "周六", startAt: "2026-09-04T22:30:00.000Z", endAt: "2026-09-05T02:00:00.000Z" }, // 本地 09-05 06:30
      { title: "第七工作日周一", startAt: "2026-09-13T22:00:00.000Z", endAt: "2026-09-14T02:00:00.000Z" }, // 本地 09-14 06:00
      { title: "第八日周二", startAt: "2026-09-14T22:00:00.000Z", endAt: "2026-09-15T02:00:00.000Z" }, // 本地 09-15 06:00
    ]);
    const data = await overview(context);
    expect(data.windowEnd).toBe("2026-09-14");
    expect(data.upcoming.items.map((item) => item.title)).toEqual(["明天周五", "周六", "第七工作日周一"]);
  });

  it("三区块互斥且行序为排期兜底；超过 limit 时计数仍准确", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    const starting = [];
    for (let index = 0; index < 4; index += 1) {
      starting.push({ title: `新开工${index}`, startAt: `2026-09-03T0${index}:00:00.000Z`, endAt: "2026-09-04T00:00:00.000Z" });
    }
    await createPlans(context, starting);
    await createPlans(context, [{ title: "继续中", startAt: "2026-09-01T01:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z" }]);
    const data = await overview(context, 2);
    expect(data.startingToday.total).toBe(4);
    expect(data.startingToday.items).toHaveLength(2);
    // 排期兜底：开始升序的前两条
    expect(data.startingToday.items.map((item) => item.title)).toEqual(["新开工0", "新开工1"]);
    expect(data.continuingToday.total).toBe(1);
    const seen = new Map<string, number>();
    for (const item of [...data.startingToday.items, ...data.continuingToday.items, ...data.upcoming.items]) {
      seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
    }
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it("summary 提供四项准确计数；区块与提醒可重复出现", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW));
    const context = await createContext();
    await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "need_ticket", label: "是否需起检修单", description: "", type: "boolean", required: false, defaultValue: null, options: [] },
    });
    // 检修单计划：本地 09-14（第七个工作日）开工，其提醒日 = 开始前 7 个工作日 = 今天 09-03
    await createPlans(context, [
      { title: "检修单计划", startAt: "2026-09-13T22:00:00.000Z", endAt: "2026-09-14T02:00:00.000Z", customFields: { need_ticket: true } },
      { title: "进行中计划", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z" },
      { title: "已完成计划", startAt: "2026-08-01T01:00:00.000Z", endAt: "2026-08-02T00:00:00.000Z" },
    ]);
    const data = await overview(context);
    expect(data.summary).toMatchObject({ all: 3, pending: 1, inProgress: 1, completed: 1 });
    // 同一工作计划可同时出现在提醒与接下来的计划区块
    const reminders = await context.request({ method: "GET", url: "/api/v1/reminders?from=2026-09-03&to=2026-09-03" });
    const day = reminders.json<{ days: Array<{ date: string; reminders: Array<{ type: string; plans: Array<{ id: string }> }> }> }>().days.find((item) => item.date === "2026-09-03");
    const reminderPlanIds = new Set((day?.reminders ?? []).flatMap((reminder) => reminder.plans.map((plan) => plan.id)));
    const upcomingIds = new Set(data.upcoming.items.map((item) => item.id));
    expect([...upcomingIds].some((id) => reminderPlanIds.has(id))).toBe(true);
  });
});
