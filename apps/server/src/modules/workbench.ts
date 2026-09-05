import { Temporal } from "@js-temporal/polyfill";
import type { OwnerConflict, WorkPlanQueryRequest, WorkPlanStatus, WorkbenchBlock, WorkbenchOverview } from "@workplan/contracts";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { WorkPlanQueryEngine } from "./work-plan-query.js";

export const WORKBENCH_TIME_ZONE = "Asia/Shanghai";

// Upcoming Window：从明天开始、以向后数第七个工作日为包含式终点，包含中间周末。
export const UPCOMING_WINDOW_WORKING_DAYS = 7;

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

    // 全局冲突映射只算一次：三次 queryAt + 四次计数若各自计算会重复全表扫描 7 遍。
    const conflicts = this.queryEngine.ownerConflictsAt(evaluatedAt);

    const startingToday = this.block(
      {
        filters: [{ field: "startAt", op: "gte", value: todayStart }, { field: "startAt", op: "lt", value: tomorrowStart }, statusNeq("cancelled")],
        range: {},
        sort: [],
        limit,
      },
      evaluatedAt,
      conflicts,
    );
    const continuingToday = this.block(
      {
        filters: [
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
    );
    const upcoming = this.block(
      {
        filters: [
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
    );

    const countByStatus = (status: WorkPlanStatus) =>
      this.queryEngine.queryAt({ filters: [{ field: "status", op: "eq", value: status }], range: {}, sort: [], limit: 1 }, evaluatedAt, { offset: 0, conflicts }).total;
    const summary = {
      all: this.queryEngine.queryAt({ filters: [], range: {}, sort: [], limit: 1 }, evaluatedAt, { offset: 0, conflicts }).total,
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
    };
  }

  private block(request: WorkPlanQueryRequest, evaluatedAt: string, conflicts: ReadonlyMap<string, OwnerConflict>): WorkbenchBlock {
    // 统一引擎以请求自带的求值时刻推导有效状态，区块成员与总数同源。
    const result = this.queryEngine.queryAt(request, evaluatedAt, { offset: 0, conflicts });
    return { items: result.items, total: result.total };
  }
}
