import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { Temporal } from "@js-temporal/polyfill";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { isWorkingDay, WORK_ORDER_LEAD_WORKING_DAYS, workingDaysBefore } from "../src/modules/reminders.js";

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
  title: "提醒测试计划",
  description: "",
  startAt: "2027-08-23T01:00:00.000Z",
  endAt: "2027-08-23T03:00:00.000Z",
  customFields: {},
  ...overrides,
});

async function seedRuleFields(context: TestContext) {
  const ticket = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key: "need_ticket",
      label: "是否需起检修单",
      description: "",
      type: "boolean",
      required: false,
      defaultValue: false,
      options: [],
    },
  });
  expect(ticket.statusCode).toBe(201);
  const risk = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key: "risk",
      label: "风险等级",
      description: "",
      type: "single_select",
      required: false,
      defaultValue: "low",
      options: [
        { value: "acceptable", label: "可接受" },
        { value: "low", label: "低" },
        { value: "medium", label: "中" },
        { value: "high", label: "高" },
      ],
    },
  });
  expect(risk.statusCode).toBe(201);
}

async function createPlan(context: TestContext, overrides: Record<string, unknown> = {}) {
  const response = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput(overrides) });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; version: number; title: string; startAt: string }>();
}

type ReminderPayload = {
  days: Array<{
    date: string;
    reminders: Array<{
      type: string;
      date: string;
      originalDate: string | null;
      plans: Array<{ id: string; title: string; startAt: string; risk: string | null }>;
    }>;
  }>;
};

function remindersOf(payload: ReminderPayload, date: string) {
  return payload.days.find((day) => day.date === date)!.reminders;
}

function nonEmptyDays(payload: ReminderPayload) {
  return payload.days.filter((day) => day.reminders.length > 0).map((day) => day.date);
}

async function getReminders(context: TestContext, from: string, to: string) {
  return context.request({ method: "GET", url: `/api/v1/reminders?from=${from}&to=${to}` });
}

describe("workingDaysBefore", () => {
  it("walks back 7 working days across weekends", () => {
    // 2027-08-23 是周一；回溯 7 个工作日 = 2027-08-12（周四），中途跳过 8/20–21 与 8/14–15 两个周末
    expect(workingDaysBefore(Temporal.PlainDate.from("2027-08-23"), WORK_ORDER_LEAD_WORKING_DAYS).toString()).toBe("2027-08-12");
  });

  it("treats Saturday and Sunday as non-working days", () => {
    expect(isWorkingDay(Temporal.PlainDate.from("2027-08-13"))).toBe(true); // 周五
    expect(isWorkingDay(Temporal.PlainDate.from("2027-08-14"))).toBe(false); // 周六
    expect(isWorkingDay(Temporal.PlainDate.from("2027-08-15"))).toBe(false); // 周日
    expect(workingDaysBefore(Temporal.PlainDate.from("2027-08-09"), 1).toString()).toBe("2027-08-06"); // 周一 → 上周五
  });

  it("honors the holidays seam", () => {
    const holidays = new Set(["2027-08-11"]);
    expect(workingDaysBefore(Temporal.PlainDate.from("2027-08-12"), 1, holidays).toString()).toBe("2027-08-10");
  });
});

describe("reminder derivation API", () => {
  it("derives a work-order reminder on the 7th working day before the start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z")); // 周三
    const context = await createContext();
    await seedRuleFields(context);
    const plan = await createPlan(context, {
      title: "需要检修单的计划",
      startAt: "2027-08-23T01:00:00.000Z", // 周一
      endAt: "2027-08-23T03:00:00.000Z",
      customFields: { need_ticket: true, risk: "low" },
    });

    const response = await getReminders(context, "2027-08-10", "2027-08-20");
    expect(response.statusCode).toBe(200);
    const payload = response.json<ReminderPayload>();
    expect(payload.days).toHaveLength(11);
    expect(nonEmptyDays(payload)).toEqual(["2027-08-12"]);
    expect(remindersOf(payload, "2027-08-12")).toEqual([
      {
        type: "work-order",
        date: "2027-08-12",
        originalDate: null,
        plans: [{ id: plan.id, title: "需要检修单的计划", startAt: "2027-08-23T01:00:00.000Z", risk: "低" }],
      },
    ]);
  });

  it("matches the work-order boolean field by its runtime key need_ticket", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z")); // 周三
    const context = await createContext();
    const ticketField = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "need_ticket",
        label: "是否需起检修单",
        description: "",
        type: "boolean",
        required: false,
        defaultValue: false,
        options: [],
      },
    });
    expect(ticketField.statusCode).toBe(201);
    const plan = await createPlan(context, {
      title: "运行库 need_ticket 计划",
      startAt: "2027-08-23T01:00:00.000Z", // 周一
      endAt: "2027-08-23T03:00:00.000Z",
      customFields: { need_ticket: true },
    });

    const response = await getReminders(context, "2027-08-10", "2027-08-20");
    expect(response.statusCode).toBe(200);
    const payload = response.json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-12"]);
    expect(remindersOf(payload, "2027-08-12")).toEqual([
      {
        type: "work-order",
        date: "2027-08-12",
        originalDate: null,
        plans: [{ id: plan.id, title: "运行库 need_ticket 计划", startAt: "2027-08-23T01:00:00.000Z", risk: null }],
      },
    ]);
  });

  it("moves an overdue work-order reminder to today and annotates originalDate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z"));
    const context = await createContext();
    await seedRuleFields(context);
    const plan = await createPlan(context, {
      title: "已错过提醒日",
      startAt: "2027-08-16T01:00:00.000Z", // 周一；提醒日应为 2027-08-05
      endAt: "2027-08-16T03:00:00.000Z",
      customFields: { need_ticket: true, risk: "low" },
    });

    const response = await getReminders(context, "2027-08-05", "2027-08-11");
    const payload = response.json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-11"]);
    expect(remindersOf(payload, "2027-08-11")).toEqual([
      {
        type: "work-order",
        date: "2027-08-11",
        originalDate: "2027-08-05",
        plans: [{ id: plan.id, title: "已错过提醒日", startAt: "2027-08-16T01:00:00.000Z", risk: "低" }],
      },
    ]);
  });

  it("stops producing work-order reminders once a plan starts or is cancelled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z"));
    const context = await createContext();
    await seedRuleFields(context);

    // 已开始的计划（automatic => in_progress）
    await createPlan(context, {
      title: "已开始",
      startAt: "2027-08-10T01:00:00.000Z",
      endAt: "2027-08-12T01:00:00.000Z",
      customFields: { need_ticket: true, risk: "low" },
    });
    // 已取消的计划（manual => cancelled）
    const cancelled = await createPlan(context, {
      title: "已取消",
      startAt: "2027-08-23T01:00:00.000Z",
      endAt: "2027-08-23T03:00:00.000Z",
      customFields: { need_ticket: true, risk: "low" },
    });
    const patched = await context.request({
      method: "PATCH",
      url: `/api/v1/work-plans/${cancelled.id}`,
      payload: { status: "cancelled", version: cancelled.version },
    });
    expect(patched.statusCode).toBe(200);

    const response = await getReminders(context, "2027-08-01", "2027-08-20");
    expect(response.statusCode).toBe(200);
    expect(nonEmptyDays(response.json<ReminderPayload>())).toEqual([]);
  });

  it("aggregates a plan-submission reminder on Wednesday for next week's 中/高 risk plans", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z")); // 周三
    const context = await createContext();
    await seedRuleFields(context);

    const nextMonday = await createPlan(context, {
      title: "下周一的计划",
      startAt: "2027-08-16T01:00:00.000Z",
      endAt: "2027-08-16T03:00:00.000Z",
      customFields: { risk: "high" },
    });
    const nextSunday = await createPlan(context, {
      title: "下周日计划",
      startAt: "2027-08-22T01:00:00.000Z",
      endAt: "2027-08-22T03:00:00.000Z",
      customFields: { risk: "medium" },
    });
    await createPlan(context, { title: "下周低风险", startAt: "2027-08-17T01:00:00.000Z", endAt: "2027-08-17T03:00:00.000Z", customFields: { risk: "low" } });
    await createPlan(context, { title: "本周高风险", startAt: "2027-08-12T01:00:00.000Z", endAt: "2027-08-12T03:00:00.000Z", customFields: { risk: "medium" } });
    await createPlan(context, { title: "下周可接受", startAt: "2027-08-18T01:00:00.000Z", endAt: "2027-08-18T03:00:00.000Z", customFields: { risk: "acceptable" } });

    const response = await getReminders(context, "2027-08-11", "2027-08-15");
    const payload = response.json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-11"]);
    expect(remindersOf(payload, "2027-08-11")).toEqual([
      {
        type: "plan-submission",
        date: "2027-08-11",
        originalDate: null,
        plans: [
          { id: nextMonday.id, title: "下周一的计划", startAt: "2027-08-16T01:00:00.000Z", risk: "高" },
          { id: nextSunday.id, title: "下周日计划", startAt: "2027-08-22T01:00:00.000Z", risk: "中" },
        ],
      },
    ]);
  });

  it("spans the Wednesday-to-Sunday window and expires afterwards", async () => {
    const planOverrides = {
      title: "下周高风险计划",
      startAt: "2027-08-16T01:00:00.000Z",
      endAt: "2027-08-16T03:00:00.000Z",
      customFields: { risk: "high" },
    };

    // 周二（尚未到达本周三）：提醒已提前挂在本周三（8/11），无需等到周三
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-10T01:00:00.000Z"));
    let context = await createContext();
    await seedRuleFields(context);
    await createPlan(context, planOverrides);
    let payload = (await getReminders(context, "2027-08-10", "2027-08-15")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-11"]);

    // 周日（窗口内）：本周三的汇总提醒仍存在
    vi.setSystemTime(new Date("2027-08-15T01:00:00.000Z"));
    payload = (await getReminders(context, "2027-08-11", "2027-08-15")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-11"]);

    // 下周一（过期周）：不再产出
    vi.setSystemTime(new Date("2027-08-16T01:00:00.000Z"));
    payload = (await getReminders(context, "2027-08-11", "2027-08-31")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual([]);
  });

  it("pre-places future submission reminders on their trigger Wednesday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z")); // 周三
    const context = await createContext();
    await seedRuleFields(context);
    await createPlan(context, {
      title: "更远一周的中风险计划",
      startAt: "2027-08-30T01:00:00.000Z", // 周一；所在周为 8/23 那周，触发三 = 8/25
      endAt: "2027-08-30T03:00:00.000Z",
      customFields: { need_ticket: false, risk: "medium" },
    });

    const response = await getReminders(context, "2027-08-20", "2027-08-31");
    const payload = response.json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-25"]);
    expect(remindersOf(payload, "2027-08-25")).toEqual([
      {
        type: "plan-submission",
        date: "2027-08-25",
        originalDate: null,
        plans: [
          { id: expect.any(String) as string, title: "更远一周的中风险计划", startAt: "2027-08-30T01:00:00.000Z", risk: "中" },
        ],
      },
    ]);
  });

  it("ignores the legacy ticket key when only need_ticket is recognized", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z"));
    const context = await createContext();

    // 规格旧 key ticket（boolean）不再被识别：字段存在且计划标记 true 也静默跳过，不产出提醒
    const ticket = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "ticket",
        label: "是否需起检修单",
        description: "",
        type: "boolean",
        required: false,
        defaultValue: false,
        options: [],
      },
    });
    expect(ticket.statusCode).toBe(201);
    await createPlan(context, {
      title: "只有旧 key 检修单标记",
      startAt: "2027-08-23T01:00:00.000Z",
      endAt: "2027-08-23T03:00:00.000Z",
      customFields: { ticket: true },
    });

    const payload = (await getReminders(context, "2027-08-10", "2027-08-20")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual([]);
  });

  it("returns empty days when no rules are configured at all", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z"));
    const context = await createContext();
    await createPlan(context, { title: "无规则字段的计划", customFields: {} });

    const response = await getReminders(context, "2027-08-01", "2027-08-31");
    expect(response.statusCode).toBe(200);
    const payload = response.json<ReminderPayload>();
    expect(payload.days).toHaveLength(31);
    expect(nonEmptyDays(payload)).toEqual([]);
  });

  it("skips the silent rules when risk options lack 中/高 labels", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z"));
    const context = await createContext();
    const risk = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "risk",
        label: "风险等级",
        description: "",
        type: "single_select",
        required: false,
        defaultValue: "low",
        options: [
          { value: "acceptable", label: "可接受" },
          { value: "low", label: "低" },
        ],
      },
    });
    expect(risk.statusCode).toBe(201);
    await createPlan(context, {
      title: "下周围绕低风险",
      startAt: "2027-08-16T01:00:00.000Z",
      endAt: "2027-08-16T03:00:00.000Z",
      customFields: { risk: "low" },
    });

    const payload = (await getReminders(context, "2027-08-11", "2027-08-15")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual([]);
  });

  it("respects the from/to boundary and rejects invalid ranges", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-11T01:00:00.000Z"));
    const context = await createContext();
    await seedRuleFields(context);
    await createPlan(context, {
      title: "边界计划",
      startAt: "2027-08-23T01:00:00.000Z",
      endAt: "2027-08-23T03:00:00.000Z",
      customFields: { need_ticket: true, risk: "low" },
    });

    // 覆盖提醒日（含边界）
    let payload = (await getReminders(context, "2027-08-01", "2027-08-12")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual(["2027-08-12"]);

    // 提醒日在范围之外则不返回
    payload = (await getReminders(context, "2027-08-13", "2027-08-20")).json<ReminderPayload>();
    expect(nonEmptyDays(payload)).toEqual([]);

    // from 晚于 to
    const reversed = await getReminders(context, "2027-08-20", "2027-08-10");
    expect(reversed.statusCode).toBe(422);

    // 非法日期格式
    const malformed = await getReminders(context, "2027-08-10", "not-a-date");
    expect(malformed.statusCode).toBe(422);

    // 缺少参数
    const missing = await context.request({ method: "GET", url: "/api/v1/reminders?from=2027-08-10" });
    expect(missing.statusCode).toBe(422);
  });
});
