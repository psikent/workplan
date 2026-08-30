import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DatabaseBundle } from "../src/db/index.js";
import { CustomFieldService } from "../src/modules/custom-fields.js";
import { ReminderService, workingDaysBefore } from "../src/modules/reminders.js";
import { runDailyBarkPush, BARK_PUSH_GROUP, BARK_PUSH_TITLE } from "../src/modules/bark-push.js";
import type { BarkDestination, BarkMessage } from "../src/modules/bark-client.js";

const TIME_ZONE = "Asia/Shanghai";

function localInstant(date: Temporal.PlainDate, hour: number, minute: number): number {
  return date.toPlainDateTime({ hour, minute }).toZonedDateTime(TIME_ZONE).toInstant().epochMilliseconds;
}

function forwardWorkingDays(date: Temporal.PlainDate, count: number): Temporal.PlainDate {
  let cursor = date;
  let remaining = count;
  while (remaining > 0) {
    cursor = cursor.add({ days: 1 });
    if (cursor.dayOfWeek <= 5) remaining -= 1;
  }
  return cursor;
}

describe("daily bark push scheduler", () => {
  let database: DatabaseBundle;
  let reminders: ReminderService;
  let pushMock: ReturnType<typeof vi.fn<(_destination: BarkDestination, _message: BarkMessage) => Promise<void>>>;
  let warnMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;
  let nowMs: number;
  let today: Temporal.PlainDate;
  let fieldId: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const customFields = new CustomFieldService(database);
    const field = customFields.create({
      key: "need_ticket",
      label: "检修单",
      description: "",
      type: "boolean",
      required: false,
      defaultValue: null,
      options: [],
    });
    fieldId = field.id;
    reminders = new ReminderService(database, customFields, TIME_ZONE);
    pushMock = vi.fn(async () => undefined);
    warnMock = vi.fn();
    errorMock = vi.fn();
    today = Temporal.PlainDate.from("2026-09-01"); // 周二
    nowMs = localInstant(today, 9, 30);
  });

  afterEach(() => {
    database.sqlite.close();
  });

  function saveConfig(deviceKey: string | null = "device-key-1") {
    database.sqlite
      .prepare("INSERT INTO bark_config(id, server_url, device_key, updated_at) VALUES (1, ?, ?, ?)")
      .run("https://api.day.app", deviceKey, "2026-08-30T00:00:00.000Z");
  }

  function insertPlan(id: string, title: string, startAt: string, status: "pending" | "completed" | "cancelled" = "pending") {
    const sqlite = database.sqlite;
    sqlite
      .prepare("INSERT INTO work_plans(id, title, description, status, status_mode, priority, start_at, end_at, sort_order, version, is_exception, created_at, updated_at) VALUES (?, ?, '', ?, 'manual', 'legacy', ?, ?, 0, 1, 0, ?, ?)")
      .run(id, title, status, startAt, startAt, "2026-08-30T00:00:00.000Z", "2026-08-30T00:00:00.000Z");
    sqlite
      .prepare("INSERT INTO custom_field_values(work_plan_id, field_id, boolean_value) VALUES (?, ?, 1)")
      .run(id, fieldId);
  }

  function planStartAt(date: Temporal.PlainDate, hour = 10): string {
    return date.toPlainDateTime({ hour }).toZonedDateTime(TIME_ZONE).toInstant().toString();
  }

  function pushLogRows(): Array<{ push_date: string; reminder_type: string; plan_id: string }> {
    return database.sqlite
      .prepare("SELECT push_date, reminder_type, plan_id FROM bark_push_log ORDER BY plan_id")
      .all() as Array<{ push_date: string; reminder_type: string; plan_id: string }>;
  }

  function createDeps() {
    return {
      database,
      reminders,
      now: () => nowMs,
      client: pushMock,
      log: { warn: warnMock, error: errorMock },
    };
  }

  it("does not push before 09:30 and pushes at 09:30 of the reminder day", async () => {
    saveConfig();
    insertPlan("plan-1", "官网改版计划", planStartAt(forwardWorkingDays(today, 7))); // 提醒日 = 今天

    nowMs = localInstant(today, 9, 29);
    await runDailyBarkPush(createDeps());
    expect(pushMock).not.toHaveBeenCalled();
    expect(pushLogRows()).toEqual([]);

    nowMs = localInstant(today, 9, 30);
    await runDailyBarkPush(createDeps());
    expect(pushMock).toHaveBeenCalledOnce();
    const [destination, message] = pushMock.mock.calls[0]!;
    expect(destination).toEqual({ serverUrl: "https://api.day.app", deviceKey: "device-key-1" });
    expect(message.title).toBe(BARK_PUSH_TITLE);
    expect(message.group).toBe(BARK_PUSH_GROUP);
    expect(message.body).toContain("官网改版计划");
    expect(message.body).toContain("日开始");
    expect(pushLogRows()).toEqual([{ push_date: today.toString(), reminder_type: "work-order", plan_id: "plan-1" }]);
  });

  it("does not push twice in the same day, even across repeated ticks", async () => {
    saveConfig();
    insertPlan("plan-1", "官网改版计划", planStartAt(forwardWorkingDays(today, 7)));

    await runDailyBarkPush(createDeps());
    await runDailyBarkPush(createDeps());
    await runDailyBarkPush(createDeps());

    expect(pushMock).toHaveBeenCalledOnce();
    expect(pushLogRows()).toHaveLength(1);
  });

  it("pushes on the day before the start and stops on the start day even while still pending", async () => {
    saveConfig();
    // 计划开始日 = 明天：今天仍可推（D4 最后一次推送 = 开始前一天）。
    insertPlan("plan-1", "明天开始的计划", planStartAt(today.add({ days: 1 }), 10));
    await runDailyBarkPush(createDeps());
    expect(pushMock).toHaveBeenCalledOnce();
    expect(pushLogRows()).toHaveLength(1);

    // 计划开始日 = 今天 14:00：09:30 时仍 pending，但开始当天 0 点起不再推（与开始时刻无关）。
    pushMock.mockClear();
    insertPlan("plan-2", "今天开始的计划", planStartAt(today, 14));
    await runDailyBarkPush(createDeps());
    expect(pushMock).not.toHaveBeenCalled();
    expect(pushLogRows()).toHaveLength(1);
  });

  it("still pushes an overdue reminder whose plan starts in the future", async () => {
    saveConfig();
    // 计划 7 个工作日后才开始 → 提醒日 = 今天？（不）实际校验：开始日在 2 天后，
    // 推导出的提醒日（回溯 7 个工作日）早于今天 → 错过提醒日仍从今天起每日推（D4）。
    insertPlan("plan-1", "迟到的提醒", planStartAt(today.add({ days: 2 }), 10));
    const derivedReminderDate = workingDaysBefore(today.add({ days: 2 }), 7);
    expect(Temporal.PlainDate.compare(derivedReminderDate, today)).toBeLessThan(0);
    await runDailyBarkPush(createDeps());
    expect(pushMock).toHaveBeenCalledOnce();
    expect(pushLogRows()).toEqual([{ push_date: today.toString(), reminder_type: "work-order", plan_id: "plan-1" }]);
  });

  it("does not push plans that are manually completed or cancelled", async () => {
    saveConfig();
    insertPlan("plan-1", "已完成", planStartAt(today.add({ days: 7 })), "completed");
    insertPlan("plan-2", "已取消", planStartAt(today.add({ days: 7 })), "cancelled");
    await runDailyBarkPush(createDeps());
    expect(pushMock).not.toHaveBeenCalled();
    expect(pushLogRows()).toEqual([]);
  });

  it("skips silently without any client call when the device key is empty or missing", async () => {
    insertPlan("plan-1", "无配置", planStartAt(today.add({ days: 7 })));
    saveConfig(null);
    await runDailyBarkPush(createDeps());
    expect(pushMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();

    database.sqlite.prepare("DELETE FROM bark_config WHERE id = 1").run();
    await runDailyBarkPush(createDeps());
    expect(pushMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("retries a failed push on the next tick and stops after success", async () => {
    saveConfig();
    insertPlan("plan-1", "会失败的计划", planStartAt(today.add({ days: 7 })));
    pushMock.mockRejectedValueOnce(new Error("Bark 服务器返回 500"));

    await runDailyBarkPush(createDeps());
    expect(pushMock).toHaveBeenCalledOnce();
    expect(pushLogRows()).toEqual([]);
    expect(warnMock).toHaveBeenCalledOnce();

    await runDailyBarkPush(createDeps());
    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushLogRows()).toHaveLength(1);
  });

  it("keeps pushing the remaining plans when one push fails", async () => {
    saveConfig();
    insertPlan("plan-1", "会失败的计划", planStartAt(today.add({ days: 1 }), 10));
    insertPlan("plan-2", "成功的计划", planStartAt(today.add({ days: 2 }), 10));
    pushMock.mockImplementation(async (_destination, message) => {
      if (message.body.includes("会失败的计划")) throw new Error("boom");
    });

    await runDailyBarkPush(createDeps());
    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushLogRows()).toEqual([{ push_date: today.toString(), reminder_type: "work-order", plan_id: "plan-2" }]);
  });
});
