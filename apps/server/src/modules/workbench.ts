import { Temporal } from "@js-temporal/polyfill";
import type { CustomFieldDefinition, OwnerConflict, WorkPlan, WorkPlanQueryRequest, WorkPlanStatus, WorkbenchBlock, WorkbenchOverview, WorkbenchPlan } from "@workplan/contracts";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { WorkPlanQueryEngine } from "./work-plan-query.js";

export const WORKBENCH_TIME_ZONE = "Asia/Shanghai";

// Upcoming Window：从明天开始、以向后数第七个工作日为包含式终点，包含中间周末。
export const UPCOMING_WINDOW_WORKING_DAYS = 7;

// Production Work 判别（代码级规则，与提醒规则的检修单字段同一先例，不做管理员配置）：
// 单选 text_value 存的是选项 value（如 option_N），语义在 label——必须按 label 解析出 value 再过滤。
const PLAN_NATURE_FIELD_KEY = "plan_nature";
const PRODUCTION_OPTION_LABEL = "生产类";

// 负责人与风险标签（代码级规则，同 plan_nature 过滤与提醒 riskLabelOf 的先例，不做配置）：
// 行内 customFields 存选项 value（option_N），语义在 label——下发前按定义换算。
// owner 不可解析（值未填/字段缺失/归档/类型不符/选项缺失或归档）为 null；
// risk 不可解析回退词汇表默认档「低」。
const OWNER_FIELD_KEY = "owner";
const RISK_FIELD_KEY = "risk";
const RISK_DEFAULT_LABEL = "低";

function isWorkingDay(date: Temporal.PlainDate): boolean {
  // 节假日表接缝：工作日 = 非周六/周日，与 reminders 口径一致。
  return date.dayOfWeek <= 5;
}

function workingDaysAfter(date: Temporal.PlainDate, count: number): Temporal.PlainDate {
  let cursor = date;
  let remaining = count;
  while (remaining > 0) {
    cursor = cursor.add({ days: 1 });
    if (isWorkingDay(cursor)) remaining -= 1;
  }
  return cursor;
}

export class WorkbenchService {
  constructor(
    readonly queryEngine: WorkPlanQueryEngine,
  ) {}

  // 三个计划区块在同一求值时刻互斥判定：
  // - 今日新开工：开始本地日 = 今天，且未取消（含今天已完成）。
  // - 今日继续开工：开始本地日 < 今天、与今天相交（[startAt,endAt) 半开），且有效状态未完成未取消。
  // - 接下来的计划：开始本地日 ∈ (今天, 第七个工作日]，且未完成未取消。
  // 手动状态覆盖自动状态；同一求值时刻的成员、计数与顺序（排期兜底）全部由服务端产生。
  overview(input: { limit?: number } = {}): WorkbenchOverview {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);
    const evaluatedAt = new Date().toISOString();
    const now = Temporal.Instant.from(evaluatedAt);
    const today = now.toZonedDateTimeISO(WORKBENCH_TIME_ZONE).toPlainDate();
    const dayStartInstant = (date: Temporal.PlainDate) => date.toZonedDateTime(WORKBENCH_TIME_ZONE).startOfDay().toInstant().toString();
    const windowEnd = workingDaysAfter(today, UPCOMING_WINDOW_WORKING_DAYS);

    const todayStart = dayStartInstant(today);
    const tomorrowStart = dayStartInstant(today.add({ days: 1 }));
    const afterWindowStart = dayStartInstant(windowEnd.add({ days: 1 }));

    const statusNeq = (value: WorkPlanStatus): WorkPlanQueryRequest["filters"][number] => ({ field: "status", op: "neq", value });

    // 字段定义只取一次：生产类过滤与 owner/risk 标签换算共用（同提醒模块 definitions 复用先例）。
    const definitions = this.queryEngine.customFields.list(true);

    // 生产类过滤：每次求值时解析，齐备才注入；不可解析（字段缺失/归档/类型不符、选项缺失/归档）→
    // 回退不过滤，工作台展示全部。引擎目录缺字段时过滤会直接 422，故绝不能注入未解析的过滤。
    const productionFilter = this.productionFilter(definitions);

    // owner/risk 的 value→label 映射：字段不可解析时为空映射，行走回退。
    const ownerLabels = this.optionLabelIndex(definitions, OWNER_FIELD_KEY);
    const riskLabels = this.optionLabelIndex(definitions, RISK_FIELD_KEY);
    const projectRow = (item: WorkPlan): WorkbenchPlan => this.projectRow(item, ownerLabels, riskLabels);

    // 全局冲突映射只算一次：三次 queryAt + 四次计数若各自计算会重复全表扫描 7 遍。
    const conflicts = this.queryEngine.ownerConflictsAt(evaluatedAt);

    const startingToday = this.block(
      {
        filters: [...productionFilter, { field: "startAt", op: "gte", value: todayStart }, { field: "startAt", op: "lt", value: tomorrowStart }, statusNeq("cancelled")],
        range: {},
        sort: [],
        limit,
      },
      evaluatedAt,
      conflicts,
      projectRow,
    );
    const continuingToday = this.block(
      {
        filters: [
          ...productionFilter,
          { field: "startAt", op: "lt", value: todayStart },
          { field: "endAt", op: "gt", value: todayStart },
          statusNeq("completed"),
          statusNeq("cancelled"),
        ],
        range: {},
        sort: [],
        limit,
      },
      evaluatedAt,
      conflicts,
      projectRow,
    );
    const upcoming = this.block(
      {
        filters: [
          ...productionFilter,
          { field: "startAt", op: "gte", value: tomorrowStart },
          { field: "startAt", op: "lt", value: afterWindowStart },
          statusNeq("completed"),
          statusNeq("cancelled"),
        ],
        range: {},
        sort: [],
        limit,
      },
      evaluatedAt,
      conflicts,
      projectRow,
    );

    const countByStatus = (status: WorkPlanStatus) =>
      this.queryEngine.queryAt({ filters: [...productionFilter, { field: "status", op: "eq", value: status }], range: {}, sort: [], limit: 1 }, evaluatedAt, { offset: 0, conflicts }).total;
    const summary = {
      all: this.queryEngine.queryAt({ filters: productionFilter, range: {}, sort: [], limit: 1 }, evaluatedAt, { offset: 0, conflicts }).total,
      pending: countByStatus("pending"),
      inProgress: countByStatus("in_progress"),
      completed: countByStatus("completed"),
    };

    return {
      evaluatedAt,
      timeZone: WORKBENCH_TIME_ZONE,
      today: today.toString(),
      windowEnd: windowEnd.toString(),
      startingToday,
      continuingToday,
      upcoming,
      summary,
      productionOnly: productionFilter.length > 0,
    };
  }

  // 解析「计划性质 = 生产类」的过滤项：字段须非归档且类型 single_select，
  // 选项须 label 精确等于「生产类」且非归档；恰好一个匹配才注入，缺失或有歧义
  // （含多个非归档选项同 label）一律回退不过滤，工作台展示全部。
  private productionFilter(definitions: CustomFieldDefinition[]): WorkPlanQueryRequest["filters"] {
    const field = definitions.find((item) => item.key === PLAN_NATURE_FIELD_KEY && !item.archivedAt && item.type === "single_select");
    const matches = field?.options.filter((item) => item.label === PRODUCTION_OPTION_LABEL && !item.archivedAt) ?? [];
    if (matches.length !== 1) return [];
    return [{ field: `custom.${PLAN_NATURE_FIELD_KEY}`, op: "eq", value: matches[0]!.value }];
  }

  // 非归档 single_select 字段的选项 value→label 映射；字段缺失/归档/类型不符时为空映射。
  private optionLabelIndex(definitions: CustomFieldDefinition[], fieldKey: string): Map<string, string> {
    const field = definitions.find((item) => item.key === fieldKey && !item.archivedAt && item.type === "single_select");
    const labels = new Map<string, string>();
    for (const option of field?.options ?? []) {
      if (!option.archivedAt) labels.set(option.value, option.label);
    }
    return labels;
  }

  // 行投影：追加 ownerLabel/riskLabel。customFields 值未填或映射不到非归档选项时——
  // owner 为 null，risk 回退「低」；映射到的 label 原样下发（含四档外自定义档位）。
  private projectRow(
    item: WorkPlan,
    ownerLabels: ReadonlyMap<string, string>,
    riskLabels: ReadonlyMap<string, string>,
  ): WorkbenchPlan {
    const ownerValue = item.customFields[OWNER_FIELD_KEY];
    const riskValue = item.customFields[RISK_FIELD_KEY];
    return {
      ...item,
      ownerLabel: typeof ownerValue === "string" ? ownerLabels.get(ownerValue) ?? null : null,
      riskLabel: (typeof riskValue === "string" ? riskLabels.get(riskValue) : undefined) ?? RISK_DEFAULT_LABEL,
    };
  }

  private block(
    request: WorkPlanQueryRequest,
    evaluatedAt: string,
    conflicts: ReadonlyMap<string, OwnerConflict>,
    projectRow: (item: WorkPlan) => WorkbenchPlan,
  ): WorkbenchBlock {
    // 统一引擎以请求自带的求值时刻推导有效状态，区块成员与总数同源。
    const result = this.queryEngine.queryAt(request, evaluatedAt, { offset: 0, conflicts });
    return { items: result.items.map(projectRow), total: result.total };
  }
}
