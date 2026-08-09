import type {
  CreateWorkPlan,
  WorkPlan,
  WorkPlanSearch,
  WorkPlanStatus,
  WorkPlanStatusMode,
} from "@workplan/contracts";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput, notFound, versionConflict } from "../errors.js";
import { newId, nowIso } from "../utils.js";
import type { CustomFieldService } from "./custom-fields.js";
import type { OwnerAccountService } from "./owner-accounts.js";

type WorkPlanRow = {
  id: string;
  title: string;
  description: string;
  status: WorkPlanStatus;
  status_mode: WorkPlanStatusMode;
  start_at: string;
  end_at: string;
  sort_order: number;
  version: number;
  series_id: string | null;
  occurrence_key: string | null;
  is_exception: number;
  created_at: string;
  updated_at: string;
};

export type UpdateWorkPlanInput = { [K in keyof CreateWorkPlan]?: CreateWorkPlan[K] | undefined } & { version: number };

export class WorkPlanService {
  constructor(
    readonly database: DatabaseBundle,
    readonly customFields: CustomFieldService,
    readonly ownerAccounts: OwnerAccountService,
  ) {}

  list(query: {
    q?: string | undefined;
    status?: WorkPlanStatus | undefined;
    from?: string | undefined;
    to?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  } = {}): WorkPlan[] {
    const where: string[] = [];
    const values: unknown[] = [];
    const timestamp = nowIso();
    if (query.q) {
      where.push("(wp.title LIKE ? ESCAPE '\\' OR wp.description LIKE ? ESCAPE '\\')");
      const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      values.push(pattern, pattern);
    }
    if (query.status) {
      where.push("CASE WHEN wp.status_mode = 'manual' THEN wp.status WHEN julianday(wp.start_at) > julianday(?) THEN 'pending' WHEN julianday(wp.end_at) <= julianday(?) THEN 'completed' ELSE 'in_progress' END = ?");
      values.push(timestamp, timestamp, query.status);
    }
    if (query.from) {
      where.push("wp.end_at >= ?");
      values.push(query.from);
    }
    if (query.to) {
      where.push("wp.start_at <= ?");
      values.push(query.to);
    }
    values.push(query.limit ?? 100, query.offset ?? 0);
    const sql = `SELECT wp.* FROM work_plans wp ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY julianday(wp.start_at) ASC, julianday(wp.end_at) DESC, wp.series_id IS NULL ASC, wp.sort_order ASC, wp.id ASC LIMIT ? OFFSET ?`;
    const rows = this.database.sqlite.prepare(sql).all(...values) as WorkPlanRow[];
    const now = Date.parse(timestamp);
    const ownerAccountByValue = this.ownerAccounts.indexByOwnerValue();
    return rows.map((row) => this.serialize(row, now, ownerAccountByValue));
  }

  search(input: WorkPlanSearch): WorkPlan[] {
    let plans = this.list({ ...(input.q ? { q: input.q } : {}), limit: 10_000, offset: 0 });
    const fieldDefinitions = new Map(this.customFields.list(true).map((field) => [field.key, field]));

    const compare = (actual: unknown, op: string, expected: unknown) => {
      if (op === "eq") return actual === expected;
      if (op === "neq") return actual !== expected;
      if (op === "contains") return String(actual ?? "").toLocaleLowerCase().includes(String(expected ?? "").toLocaleLowerCase());
      if (op === "any") {
        const actualValues = Array.isArray(actual) ? actual : [actual];
        const expectedValues = Array.isArray(expected) ? expected : [expected];
        return expectedValues.some((item) => actualValues.includes(item));
      }
      if (op === "all") {
        const actualValues = Array.isArray(actual) ? actual : [actual];
        const expectedValues = Array.isArray(expected) ? expected : [expected];
        return expectedValues.every((item) => actualValues.includes(item));
      }
      if (op === "between" && Array.isArray(expected) && expected.length === 2) return actual! >= expected[0]! && actual! <= expected[1]!;
      if (op === "gt") return actual! > expected!;
      if (op === "gte") return actual! >= expected!;
      if (op === "lt") return actual! < expected!;
      if (op === "lte") return actual! <= expected!;
      return false;
    };

    for (const filter of input.filters) {
      plans = plans.filter((plan) => {
        const actual = filter.field.startsWith("custom.")
          ? plan.customFields[filter.field.slice("custom.".length)]
          : (plan as unknown as Record<string, unknown>)[filter.field];
        return compare(actual, filter.op, filter.value);
      });
    }

    if (input.sort.length > 0) {
      plans.sort((left, right) => {
        for (const sort of input.sort) {
          const key = sort.field.startsWith("custom.") ? sort.field.slice("custom.".length) : sort.field;
          if (sort.field.startsWith("custom.")) {
            const definition = fieldDefinitions.get(key);
            if (!definition || ["long_text", "multi_select"].includes(definition.type)) continue;
          }
          const leftValue = sort.field.startsWith("custom.")
            ? left.customFields[key]
            : (left as unknown as Record<string, unknown>)[key];
          const rightValue = sort.field.startsWith("custom.")
            ? right.customFields[key]
            : (right as unknown as Record<string, unknown>)[key];
          if (leftValue === rightValue) continue;
          if (leftValue == null) return 1;
          if (rightValue == null) return -1;
          const direction = sort.direction === "asc" ? 1 : -1;
          return (leftValue < rightValue ? -1 : 1) * direction;
        }
        return left.sortOrder - right.sortOrder;
      });
    }
    return plans.slice(input.offset, input.offset + input.limit);
  }

  get(id: string): WorkPlan {
    const row = this.database.sqlite.prepare("SELECT * FROM work_plans WHERE id = ?").get(id) as WorkPlanRow | undefined;
    if (!row) throw notFound("工作计划不存在");
    return this.serialize(row, Date.now(), this.ownerAccounts.indexByOwnerValue());
  }

  create(input: CreateWorkPlan): WorkPlan {
    return this.createInternal(input, null, null);
  }

  createOccurrence(input: CreateWorkPlan, seriesId: string, occurrenceKey: string): WorkPlan | null {
    const exists = this.database.sqlite
      .prepare("SELECT id FROM work_plans WHERE series_id = ? AND occurrence_key = ?")
      .get(seriesId, occurrenceKey) as { id: string } | undefined;
    if (exists) return null;
    return this.createInternal(input, seriesId, occurrenceKey);
  }

  private createInternal(input: CreateWorkPlan, seriesId: string | null, occurrenceKey: string | null): WorkPlan {
    this.assertTimeRange(input.startAt, input.endAt);
    const id = newId();
    const timestamp = nowIso();
    const statusMode = input.statusMode ?? (input.status !== undefined ? "manual" : "automatic");
    if (statusMode === "manual" && !input.status) throw invalidInput("手动状态必须指定状态值");
    const status = statusMode === "manual"
      ? input.status!
      : deriveWorkPlanStatus(input.startAt, input.endAt, Date.parse(timestamp));
    const order = this.database.sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM work_plans").get() as {
      value: number;
    };
    const execute = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare("INSERT INTO work_plans(id, title, description, status, status_mode, priority, start_at, end_at, sort_order, version, series_id, occurrence_key, is_exception, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)")
        .run(
          id,
          input.title,
          input.description,
          status,
          statusMode,
          "none",
          input.startAt,
          input.endAt,
          order.value,
          seriesId,
          occurrenceKey,
          timestamp,
          timestamp,
        );
      this.customFields.setValues(id, input.customFields, true);
    });
    execute();
    return this.get(id);
  }

  update(id: string, input: UpdateWorkPlanInput): WorkPlan {
    const current = this.get(id);
    const startAt = input.startAt ?? current.startAt;
    const endAt = input.endAt ?? current.endAt;
    this.assertTimeRange(startAt, endAt);
    const statusMode = input.statusMode ?? (input.status !== undefined ? "manual" : current.statusMode);
    if (statusMode === "manual" && !input.status && current.statusMode !== "manual") {
      throw invalidInput("手动状态必须指定状态值");
    }
    const status = statusMode === "automatic"
      ? deriveWorkPlanStatus(startAt, endAt)
      : input.status ?? current.status;
    const execute = this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare("UPDATE work_plans SET title = ?, description = ?, status = ?, status_mode = ?, start_at = ?, end_at = ?, is_exception = CASE WHEN series_id IS NOT NULL THEN 1 ELSE is_exception END, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(
          input.title ?? current.title,
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
    });
    execute();
    return this.get(id);
  }

  updateSchedule(id: string, input: { startAt: string; endAt: string; version: number }): WorkPlan {
    this.assertTimeRange(input.startAt, input.endAt);
    const current = this.get(id);
    const status = current.statusMode === "automatic"
      ? deriveWorkPlanStatus(input.startAt, input.endAt)
      : current.status;
    const result = this.database.sqlite
      .prepare("UPDATE work_plans SET status = ?, start_at = ?, end_at = ?, is_exception = CASE WHEN series_id IS NOT NULL THEN 1 ELSE is_exception END, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(status, input.startAt, input.endAt, nowIso(), id, input.version);
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

  reorder(orderedIds: string[]): WorkPlan[] {
    const known = this.database.sqlite.prepare(`SELECT id FROM work_plans WHERE id IN (${orderedIds.map(() => "?").join(",")})`).all(...orderedIds) as Array<{ id: string }>;
    if (known.length !== orderedIds.length) throw invalidInput("排序列表包含不存在的工作计划");
    const execute = this.database.sqlite.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.database.sqlite.prepare("UPDATE work_plans SET sort_order = ?, version = version + 1, updated_at = ? WHERE id = ?").run(index, nowIso(), id);
      });
    });
    execute();
    return this.list({ limit: 500 });
  }

  private serialize(row: WorkPlanRow, now: number, ownerAccountByValue: ReadonlyMap<string, string>): WorkPlan {
    const customFields = this.customFields.getValues(row.id);
    const ownerValue = typeof customFields.owner === "string" ? customFields.owner : null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status_mode === "automatic" ? deriveWorkPlanStatus(row.start_at, row.end_at, now) : row.status,
      statusMode: row.status_mode,
      startAt: row.start_at,
      endAt: row.end_at,
      sortOrder: row.sort_order,
      version: row.version,
      seriesId: row.series_id,
      occurrenceKey: row.occurrence_key,
      isException: Boolean(row.is_exception),
      customFields,
      ownerAccount: ownerValue ? ownerAccountByValue.get(ownerValue) ?? null : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assertTimeRange(startAt: string, endAt: string): void {
    if (Date.parse(startAt) >= Date.parse(endAt)) throw invalidInput("结束时间必须晚于开始时间");
  }
}
