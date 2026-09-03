import type {
  CreateWorkPlan,
  WorkPlan,
  WorkPlanQueryRequest,
  WorkPlanSearch,
  WorkPlanStatus,
  WorkPlanStatusMode,
} from "@workplan/contracts";
import { deriveWorkPlanStatus, naturalSortKey, normalizeDateTimeForSort } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput, notFound, versionConflict } from "../errors.js";
import { newId, nowIso } from "../utils.js";
import type { CustomFieldService } from "./custom-fields.js";
import type { MonthlyGoalService } from "./monthly-goals.js";
import type { OwnerAccountService } from "./owner-accounts.js";
import type { WorkPlanQueryEngine, WorkPlanQueryResult, WorkPlanRow } from "./work-plan-query.js";

export type { WorkPlanRow };

export type UpdateWorkPlanInput = { [K in keyof CreateWorkPlan]?: CreateWorkPlan[K] | undefined } & { version: number };

// 遗留 NOT NULL 列的中性兼容值：统一排序的所有路径都不读取该列（票据 14）。
export const WORK_PLAN_SORT_ORDER_NEUTRAL = 0;

export class WorkPlanService {
  constructor(
    readonly database: DatabaseBundle,
    readonly customFields: CustomFieldService,
    readonly ownerAccounts: OwnerAccountService,
    readonly monthlyGoals: MonthlyGoalService,
    readonly queryEngine: WorkPlanQueryEngine,
  ) {}

  // 旧兼容适配器：数组响应 + offset 分页，顺序由统一引擎产生（默认排期顺序）。
  list(query: {
    q?: string | undefined;
    status?: WorkPlanStatus | undefined;
    from?: string | undefined;
    to?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  } = {}): WorkPlan[] {
    const filters: WorkPlanQueryRequest["filters"] = query.status ? [{ field: "status", op: "eq", value: query.status }] : [];
    const request: WorkPlanQueryRequest = {
      filters,
      range: { from: query.from, to: query.to },
      sort: [],
      limit: query.limit ?? 100,
    };
    if (query.q) request.q = query.q;
    return this.queryEngine.query(request, { offset: query.offset ?? 0 }).items;
  }

  // 旧兼容适配器：offset 数组结果，取代原“读取一万条后内存过滤排序”的路径。
  search(input: WorkPlanSearch): WorkPlan[] {
    const request: WorkPlanQueryRequest = {
      filters: input.filters,
      range: {},
      sort: input.sort,
      limit: input.limit,
    };
    if (input.q) request.q = input.q;
    return this.queryEngine.query(request, { offset: input.offset }).items;
  }

  // 统一查询契约入口：准确总数、求值时间与不透明游标。
  query(request: WorkPlanQueryRequest): WorkPlanQueryResult {
    return this.queryEngine.query(request);
  }

  get(id: string): WorkPlan {
    const row = this.database.sqlite.prepare("SELECT * FROM work_plans WHERE id = ?").get(id) as WorkPlanRow | undefined;
    if (!row) throw notFound("工作计划不存在");
    const serialized = this.queryEngine.serializeRows([row], Date.now())[0];
    if (!serialized) throw notFound("工作计划不存在");
    return serialized;
  }

  create(input: CreateWorkPlan): WorkPlan {
    return this.createInternal(input, null, null);
  }

  createOccurrence(input: CreateWorkPlan, seriesId: string, occurrenceKey: string): WorkPlan | null {
    const exists = this.database.sqlite
      .prepare("SELECT id FROM work_plans WHERE series_id = ? AND (occurrence_key = ? OR julianday(start_at) = julianday(?))")
      .get(seriesId, occurrenceKey, input.startAt) as { id: string } | undefined;
    if (exists) return null;
    return this.createInternal(input, seriesId, occurrenceKey);
  }

  private createInternal(input: CreateWorkPlan, seriesId: string | null, occurrenceKey: string | null): WorkPlan {
    this.assertTimeRange(input.startAt, input.endAt);
    const startAt = this.normalizeInstant(input.startAt);
    const endAt = this.normalizeInstant(input.endAt);
    const id = newId();
    const timestamp = nowIso();
    const statusMode = input.statusMode ?? (input.status !== undefined ? "manual" : "automatic");
    if (statusMode === "manual" && !input.status) throw invalidInput("手动状态必须指定状态值");
    const status = statusMode === "manual"
      ? input.status!
      : deriveWorkPlanStatus(startAt, endAt, Date.parse(timestamp));
    const execute = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare("INSERT INTO work_plans(id, title, title_sort_key, description, status, status_mode, priority, start_at, end_at, sort_order, version, series_id, occurrence_key, is_exception, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)")
        .run(
          id,
          input.title,
          naturalSortKey(input.title),
          input.description,
          status,
          statusMode,
          "none",
          startAt,
          endAt,
          WORK_PLAN_SORT_ORDER_NEUTRAL,
          seriesId,
          occurrenceKey,
          timestamp,
          timestamp,
        );
      this.customFields.setValues(id, input.customFields, true);
      this.monthlyGoals.setTaskLinks(id, input.monthlyGoalIds ?? []);
    });
    execute();
    return this.get(id);
  }

  update(id: string, input: UpdateWorkPlanInput): WorkPlan {
    const current = this.get(id);
    const startAt = this.normalizeInstant(input.startAt ?? current.startAt);
    const endAt = this.normalizeInstant(input.endAt ?? current.endAt);
    this.assertTimeRange(startAt, endAt);
    const statusMode = input.statusMode ?? (input.status !== undefined ? "manual" : current.statusMode);
    if (statusMode === "manual" && !input.status && current.statusMode !== "manual") {
      throw invalidInput("手动状态必须指定状态值");
    }
    const status = statusMode === "automatic"
      ? deriveWorkPlanStatus(startAt, endAt, Date.parse(nowIso()))
      : input.status ?? current.status;
    const title = input.title ?? current.title;
    const execute = this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare("UPDATE work_plans SET title = ?, title_sort_key = ?, description = ?, status = ?, status_mode = ?, start_at = ?, end_at = ?, is_exception = CASE WHEN series_id IS NOT NULL THEN 1 ELSE is_exception END, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(
          title,
          naturalSortKey(title),
          input.description ?? current.description,
          status,
          statusMode,
          startAt,
          endAt,
          nowIso(),
          id,
          input.version,
        );
      if (result.changes === 0) throw versionConflict();
      if (input.customFields) this.customFields.setValues(id, input.customFields, false);
      if (input.monthlyGoalIds !== undefined) this.monthlyGoals.setTaskLinks(id, input.monthlyGoalIds);
    });
    execute();
    return this.get(id);
  }

  updateSchedule(id: string, input: { startAt: string; endAt: string; version: number }): WorkPlan {
    this.assertTimeRange(input.startAt, input.endAt);
    const startAt = this.normalizeInstant(input.startAt);
    const endAt = this.normalizeInstant(input.endAt);
    const current = this.get(id);
    const status = current.statusMode === "automatic"
      ? deriveWorkPlanStatus(input.startAt, input.endAt, Date.parse(nowIso()))
      : current.status;
    const result = this.database.sqlite
      .prepare("UPDATE work_plans SET status = ?, start_at = ?, end_at = ?, is_exception = CASE WHEN series_id IS NOT NULL THEN 1 ELSE is_exception END, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(status, startAt, endAt, nowIso(), id, input.version);
    if (result.changes === 0) {
      const exists = this.database.sqlite.prepare("SELECT id FROM work_plans WHERE id = ?").get(id);
      if (!exists) throw notFound("工作计划不存在");
      throw versionConflict();
    }
    return this.get(id);
  }

  delete(id: string, version: number): void {
    const result = this.database.sqlite.prepare("DELETE FROM work_plans WHERE id = ? AND version = ?").run(id, version);
    if (result.changes === 0) {
      const exists = this.database.sqlite.prepare("SELECT id FROM work_plans WHERE id = ?").get(id);
      if (!exists) throw notFound("工作计划不存在");
      throw versionConflict();
    }
  }

  private assertTimeRange(startAt: string, endAt: string): void {
    if (Date.parse(startAt) >= Date.parse(endAt)) throw invalidInput("结束时间必须晚于开始时间");
  }

  // 时间列统一为 toISOString() 形态（含毫秒），否则 Temporal 的零毫秒省略写法
  // 会让字典序与时间点序不一致，破坏排期兜底与键集分页。
  private normalizeInstant(value: string): string {
    return normalizeDateTimeForSort(value) ?? value;
  }
}
