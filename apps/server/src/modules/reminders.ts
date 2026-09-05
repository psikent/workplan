import { Temporal } from "@js-temporal/polyfill";
import type {
  CustomFieldDefinition,
  ListRemindersResponse,
  Reminder,
  ReminderType,
  WorkPlanStatus,
  WorkPlanStatusMode,
} from "@workplan/contracts";
import { compareWorkPlansBySchedule, deriveWorkPlanStatus } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import type { CustomFieldService } from "./custom-fields.js";

export const DEFAULT_REMINDERS_TIME_ZONE = "Asia/Shanghai";

// 规则参数（按规格 R1 集中为常量）
export const WORK_ORDER_LEAD_WORKING_DAYS = 7;
export const RISK_THRESHOLD_LABELS: readonly string[] = ["中", "高"];
export const PLAN_SUBMISSION_TRIGGER_WEEKDAY = 3; // Temporal dayOfWeek：周一=1 … 周日=7

// 检修单字段的 key（规则按 key 匹配，不按定义 id）：运行库实际 key 为 need_ticket（boolean）。
// 规格旧字面 key ticket 已移除——不再触发提醒。
export const WORK_ORDER_FIELD_KEYS: readonly string[] = ["need_ticket"];

// 节假日表接缝：工作日 = 非周六/周日；后续可替换为按节假日表查询的函数，本模块先并入常量空集。
const WORKING_DAY_HOLIDAYS: ReadonlySet<string> = new Set();

export function isWorkingDay(date: Temporal.PlainDate, holidays: ReadonlySet<string> = WORKING_DAY_HOLIDAYS): boolean {
  return date.dayOfWeek <= 5 && !holidays.has(date.toString());
}

/** 从 date 往回数 count 个工作日（排除周六/周日），返回提醒日期。 */
export function workingDaysBefore(
  date: Temporal.PlainDate,
  count: number,
  holidays: ReadonlySet<string> = WORKING_DAY_HOLIDAYS,
): Temporal.PlainDate {
  let cursor = date;
  let remaining = count;
  while (remaining > 0) {
    cursor = cursor.subtract({ days: 1 });
    if (isWorkingDay(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

function toLocalDate(instant: string | number, timeZone: string): Temporal.PlainDate {
  const value = typeof instant === "number" ? Temporal.Instant.fromEpochMilliseconds(instant) : Temporal.Instant.from(instant);
  return value.toZonedDateTimeISO(timeZone).toPlainDate();
}

function mondayOf(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

type PlanSnapshot = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  createdAt: string;
  status: WorkPlanStatus;
  customFields: Record<string, unknown>;
};

type RuleContext = {
  timeZone: string;
  today: Temporal.PlainDate;
  plans: PlanSnapshot[];
  definitions: CustomFieldDefinition[];
};

type ProducedReminder = {
  type: ReminderType;
  date: Temporal.PlainDate;
  originalDate: Temporal.PlainDate | null;
  plans: Reminder["plans"];
};

type ReminderRule = {
  type: ReminderType;
  description: string;
  derive: (context: RuleContext) => ProducedReminder[];
};

/** risk 回传选项标签（如「中」）而非稳定 value，供展示使用；无匹配时为空。 */
function riskLabelOf(value: unknown, definitions: CustomFieldDefinition[]): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const field = definitions.find((definition) => definition.key === "risk" && definition.type === "single_select");
  if (!field) return null;
  const option = field.options.find((item) => item.archivedAt === null && item.value === value);
  return option?.label ?? null;
}

function planRef(plan: PlanSnapshot, definitions: CustomFieldDefinition[]): Reminder["plans"][number] {
  return {
    id: plan.id,
    title: plan.title,
    startAt: plan.startAt,
    endAt: plan.endAt,
    createdAt: plan.createdAt,
    risk: riskLabelOf(plan.customFields.risk, definitions),
  };
}

// 同类提醒内的计划改用统一排期顺序（开始升、结束降、创建升、ID 码点升）。
function comparePlans(
  left: { id: string; startAt: string; endAt: string; createdAt: string },
  right: { id: string; startAt: string; endAt: string; createdAt: string },
): number {
  return compareWorkPlansBySchedule(left, right);
}

/** 从计划 customFields 中取出检修单布尔值（兼容 need_ticket/ticket 两个 key）。 */
function ticketValueOf(customFields: Record<string, unknown>): unknown {
  for (const key of WORK_ORDER_FIELD_KEYS) {
    if (customFields[key] !== undefined) return customFields[key];
  }
  return undefined;
}

/** rule1 检修单提醒：ticket=true 且有效状态为 pending 的计划，开始日回溯 7 个工作日的提醒日。 */
function deriveWorkOrderReminders(context: RuleContext): ProducedReminder[] {
  const ticketField = context.definitions.find(
    (definition) => WORK_ORDER_FIELD_KEYS.includes(definition.key) && definition.type === "boolean",
  );
  if (!ticketField) return []; // 字段缺失或类型不符：规则静默跳过

  const groups = new Map<string, { date: Temporal.PlainDate; originalDate: Temporal.PlainDate | null; plans: Reminder["plans"] }>();
  for (const plan of context.plans) {
    if (plan.status !== "pending") continue; // 开始或取消后不再产出
    if (ticketValueOf(plan.customFields) !== true) continue;
    const reminderDate = workingDaysBefore(toLocalDate(plan.startAt, context.timeZone), WORK_ORDER_LEAD_WORKING_DAYS);
    const overdue = Temporal.PlainDate.compare(context.today, reminderDate) > 0;
    const date = overdue ? context.today : reminderDate;
    const originalDate = overdue ? reminderDate : null;
    const key = `${date.toString()}|${originalDate?.toString() ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { date, originalDate, plans: [] };
      groups.set(key, group);
    }
    group.plans.push(planRef(plan, context.definitions));
  }
  return [...groups.values()].map((group) => {
    group.plans.sort(comparePlans);
    return { type: "work-order" as const, date: group.date, originalDate: group.originalDate, plans: group.plans };
  });
}

/**
 * rule2 作业计划提交提醒（提前挂）：
 * 对每个中/高计划，在「其开始日所在周的上一周三」挂汇总铃铛——不用等到周三到达才产出；
 * 过期（已过该周三所在周日）不再产出，避免过期周残留。
 * 对计划状态不加约束（规格 R2 仅要求时间范围重叠 + 风险等级）。
 */
function derivePlanSubmissionReminders(context: RuleContext): ProducedReminder[] {
  const riskField = context.definitions.find((definition) => definition.key === "risk" && definition.type === "single_select");
  if (!riskField) return []; // 字段缺失：规则静默跳过
  const thresholdValues = new Set(
    riskField.options
      .filter((option) => option.archivedAt === null && RISK_THRESHOLD_LABELS.includes(option.label))
      .map((option) => option.value),
  );
  if (thresholdValues.size === 0) return []; // 中/高选项缺失：规则静默跳过

  const candidates = context.plans.filter((plan) => {
    const risk = plan.customFields.risk;
    return typeof risk === "string" && thresholdValues.has(risk);
  });
  if (candidates.length === 0) return [];

  // 所有中/高计划中最晚的结束日：循环到此之后不再有窗口可重叠
  const lastEnd = candidates.reduce((latest, plan) => {
    const end = toLocalDate(plan.endAt, context.timeZone);
    return Temporal.PlainDate.compare(end, latest) > 0 ? end : latest;
  }, toLocalDate(candidates[0]!.endAt, context.timeZone));

  const groups = new Map<string, { type: ReminderType; date: Temporal.PlainDate; originalDate: Temporal.PlainDate | null; plans: Reminder["plans"] }>();
  for (let monday = mondayOf(context.today); ; monday = monday.add({ days: 7 })) {
    const weekEnd = monday.add({ days: 6 }); // 该周周日
    if (Temporal.PlainDate.compare(context.today, weekEnd) > 0) continue; // 该周已过：过期周不再产出
    const triggerDate = monday.add({ days: PLAN_SUBMISSION_TRIGGER_WEEKDAY - 1 }); // 该周周三
    const nextMonday = monday.add({ days: 7 });
    const nextSunday = nextMonday.add({ days: 6 });
    const matching = candidates
      .filter((plan) => {
        const startDate = toLocalDate(plan.startAt, context.timeZone);
        const endDate = toLocalDate(plan.endAt, context.timeZone);
        return Temporal.PlainDate.compare(startDate, nextSunday) <= 0 && Temporal.PlainDate.compare(endDate, nextMonday) >= 0;
      })
      .sort(comparePlans)
      .map((plan) => planRef(plan, context.definitions));
    if (matching.length > 0) {
      const key = triggerDate.toString();
      let group = groups.get(key);
      if (!group) {
        group = { type: "plan-submission", date: triggerDate, originalDate: null, plans: [] };
        groups.set(key, group);
      }
      group.plans.push(...matching);
    }
    // 所有计划都早于下一下周窗口：不再可能有新产出
    if (Temporal.PlainDate.compare(nextMonday, lastEnd) > 0) break;
  }
  return [...groups.values()].map((group) => {
    group.plans.sort(comparePlans);
    return group;
  });
}

// 规则表（代码内常量数组，数据驱动；新增规则在此注册即可）
const REMINDER_RULES: readonly ReminderRule[] = [
  {
    type: "work-order",
    description: "检修单提醒：ticket=true 且 pending 的计划，开始日前 7 个工作日的提醒日",
    derive: deriveWorkOrderReminders,
  },
  {
    type: "plan-submission",
    description: "作业计划提交提醒：本周三，下周存在风险等级为 中/高 的计划",
    derive: derivePlanSubmissionReminders,
  },
];

const reminderTypeOrder = (type: ReminderType) => (type === "work-order" ? 0 : 1);

/**
 * 纯只读提醒推导：不写任何表，不接触 legacy notifications/reminder_rules/tags。
 * 返回 [from, to] 内每个本地日期的提醒列表（无提醒的日期也返回空数组）。
 */
export class ReminderService {
  constructor(
    private readonly database: DatabaseBundle,
    private readonly customFields: CustomFieldService,
    private readonly timeZone: string = DEFAULT_REMINDERS_TIME_ZONE,
  ) {}

  derive(from: string, to: string, now: number = Date.now()): ListRemindersResponse {
    const fromDate = Temporal.PlainDate.from(from);
    const toDate = Temporal.PlainDate.from(to);
    const today = toLocalDate(now, this.timeZone);
    const definitions = this.customFields.list();

    const rows = this.database.sqlite
      .prepare("SELECT id, title, status, status_mode, start_at, end_at, created_at FROM work_plans")
      .all() as Array<{
      id: string;
      title: string;
      status: WorkPlanStatus;
      status_mode: WorkPlanStatusMode;
      start_at: string;
      end_at: string;
      created_at: string;
    }>;
    const customValuesById = this.customFields.getValuesForPlans(rows.map((row) => row.id));
    const plans: PlanSnapshot[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      startAt: row.start_at,
      endAt: row.end_at,
      status: row.status_mode === "automatic" ? deriveWorkPlanStatus(row.start_at, row.end_at, now) : row.status,
      customFields: customValuesById.get(row.id) ?? {},
    }));

    const context: RuleContext = { timeZone: this.timeZone, today, plans, definitions };
    const produced: ProducedReminder[] = [];
    for (const rule of REMINDER_RULES) produced.push(...rule.derive(context));

    const remindersByDate = new Map<string, Reminder[]>();
    for (const item of produced) {
      const dateKey = item.date.toString();
      const list = remindersByDate.get(dateKey) ?? [];
      list.push({ type: item.type, date: dateKey, originalDate: item.originalDate?.toString() ?? null, plans: item.plans });
      remindersByDate.set(dateKey, list);
    }

    const days: ListRemindersResponse["days"] = [];
    for (let cursor = fromDate; Temporal.PlainDate.compare(cursor, toDate) <= 0; cursor = cursor.add({ days: 1 })) {
      const dateKey = cursor.toString();
      const reminders = (remindersByDate.get(dateKey) ?? [])
        .slice()
        .sort((left, right) => reminderTypeOrder(left.type) - reminderTypeOrder(right.type)
          || (left.originalDate ?? "").localeCompare(right.originalDate ?? ""));
      days.push({ date: dateKey, reminders });
    }
    return { days };
  }
}
