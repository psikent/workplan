import { Temporal } from "@js-temporal/polyfill";
import type { Reminder } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import type { ReminderService } from "./reminders.js";
import { sendBark, type BarkDestination, type BarkMessage } from "./bark-client.js";

export const BARK_PUSH_TIME_ZONE = "Asia/Shanghai";
export const BARK_PUSH_HOUR = 9;
export const BARK_PUSH_MINUTE = 30;
export const BARK_PUSH_REMINDER_TYPE = "work-order";
export const BARK_PUSH_TITLE = "检修单提醒";
export const BARK_PUSH_GROUP = "work-order-reminder";
export const BARK_PUSH_BODY_HINT = "请及时开检修单";

export type BarkPushDeps = {
  database: DatabaseBundle;
  reminders: ReminderService;
  /** 注入时钟（epoch ms）以便测试；默认 Date.now()。 */
  now?: () => number;
  /** 注入 Bark 客户端以便测试；默认 sendBark。 */
  client?: (destination: BarkDestination, message: BarkMessage) => Promise<void>;
  log?: { warn: (obj: unknown, message?: string) => void; error: (obj: unknown, message?: string) => void };
};

type BarkConfigRow = {
  server_url: string;
  device_key: string | null;
};

type BarkPushLogKey = {
  push_date: string;
  reminder_type: string;
  plan_id: string;
};

// 进程内在途互斥：调度 tick 每 60s 触发且不 await，推送网络耗时长于一个 tick 时
// 两个 run 可能并发——hasPushLog → await sendOne → INSERT 之间的窗口会双发
// （唯一索引只挡日志行，第二次 INSERT 抛错被吞）。单实例部署下整轮互斥即可。
let runInFlight = false;

/**
 * 每日 09:30（Asia/Shanghai）推送检修单提醒（R3/D3/D4/D5/D6）：
 * - 本地时间未到 09:30 或设备 Key 未配置 → 直接返回（功能关闭，零报错）。
 * - 只处理「计划开始本地日 > 今天」的提醒（开始当天起不再推，与开始时刻无关）。
 * - 同日同 (提醒类型, 计划) 已有日志 → 跳过（防重发）。
 * - 推送失败记 warning、不落日志（下个 tick 自然重试），不影响其余计划。
 * 本函数不向调用方抛异常；单计划失败互不影响。
 */
export async function runDailyBarkPush(deps: BarkPushDeps): Promise<void> {
  if (runInFlight) return;
  runInFlight = true;
  try {
    await runDailyBarkPushInner(deps);
  } finally {
    runInFlight = false;
  }
}

async function runDailyBarkPushInner(deps: BarkPushDeps): Promise<void> {
  const log = deps.log;
  try {
    const now = deps.now ? deps.now() : Date.now();
    const nowZoned = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(BARK_PUSH_TIME_ZONE);
    const today = nowZoned.toPlainDate();
    const cutoff = today.toPlainDateTime({ hour: BARK_PUSH_HOUR, minute: BARK_PUSH_MINUTE });
    if (Temporal.PlainDateTime.compare(nowZoned.toPlainDateTime(), cutoff) < 0) return;

    const row = deps.database.sqlite
      .prepare("SELECT server_url, device_key FROM bark_config WHERE id = 1")
      .get() as BarkConfigRow | undefined;
    const deviceKey = row?.device_key;
    if (!deviceKey || deviceKey.length === 0) return; // 功能关闭

    const response = deps.reminders.derive(today.toString(), today.toString(), now);
    const candidates = (response.days[0]?.reminders
      .filter((item) => item.type === BARK_PUSH_REMINDER_TYPE)
      .flatMap((item) => item.plans) ?? [])
      .filter((plan) => isPushableToday(plan.startAt, today));
    for (const plan of candidates) {
      try {
        const key: BarkPushLogKey = {
          push_date: today.toString(),
          reminder_type: BARK_PUSH_REMINDER_TYPE,
          plan_id: plan.id,
        };
        if (hasPushLog(deps.database, key)) continue;
        await sendOne(deps, { serverUrl: row!.server_url, deviceKey }, messageFor(plan));
        deps.database.sqlite
          .prepare("INSERT INTO bark_push_log(push_date, reminder_type, plan_id, pushed_at) VALUES (?, ?, ?, ?)")
          .run(key.push_date, key.reminder_type, key.plan_id, new Date(now).toISOString());
      } catch (error) {
        log?.warn({ err: error, planId: plan.id }, `bark push failed for plan ${plan.id}`);
      }
    }
  } catch (error) {
    log?.error({ err: error }, "bark push run failed");
  }
}

async function sendOne(
  deps: BarkPushDeps,
  destination: BarkDestination,
  message: BarkMessage,
): Promise<void> {
  const client = deps.client ?? sendBark;
  await client(destination, message);
}

/** D4 终止线：计划开始本地日必须晚于今天（开始当天 0 点起不再推，与开始时刻无关）。 */
function isPushableToday(startAt: string, today: Temporal.PlainDate): boolean {
  const startDate = Temporal.Instant.from(startAt).toZonedDateTimeISO(BARK_PUSH_TIME_ZONE).toPlainDate();
  return Temporal.PlainDate.compare(startDate, today) > 0;
}

/** D5 推送内容：title 固定「检修单提醒」；body = 计划标题 + 开始日期 + 提示语；group 固定。 */
function messageFor(plan: Reminder["plans"][number]): BarkMessage {
  const startDate = Temporal.Instant.from(plan.startAt).toZonedDateTimeISO(BARK_PUSH_TIME_ZONE).toPlainDate();
  return {
    title: BARK_PUSH_TITLE,
    body: `${plan.title}；${startDate.month} 月 ${startDate.day} 日开始，${BARK_PUSH_BODY_HINT}`,
    group: BARK_PUSH_GROUP,
  };
}

function hasPushLog(database: DatabaseBundle, key: BarkPushLogKey): boolean {
  return Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM bark_push_log WHERE push_date = ? AND reminder_type = ? AND plan_id = ?")
      .get(key.push_date, key.reminder_type, key.plan_id),
  );
}
