import type { CreateMonthlyGoal, MonthlyGoal, MonthlyGoalQuickEdit, MonthlyGoalQuickEditResult, UpdateMonthlyGoal, WorkPlanStatus } from "@workplan/contracts";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput, notFound, versionConflict } from "../errors.js";
import { newId, nowIso } from "../utils.js";

type MonthlyGoalRow = {
  id: string;
  title: string;
  description: string;
  year: number;
  month: number;
  work_plan_id: string | null;
  archived_at: string | null;
  version: number;
  series_id: string | null;
  occurrence_key: string | null;
  created_at: string;
  updated_at: string;
};

type LinkedWorkPlanRow = {
  id: string;
  title: string;
  status: WorkPlanStatus;
  status_mode: "automatic" | "manual";
  start_at: string;
  end_at: string;
};

export class MonthlyGoalService {
  constructor(private readonly database: DatabaseBundle) {}

  list(query: { year?: number | undefined; month?: number | undefined; includeArchived?: boolean | undefined } = {}): MonthlyGoal[] {
    const where: string[] = [];
    const values: unknown[] = [];
    if (query.year !== undefined) {
      where.push("year = ?");
      values.push(query.year);
    }
    if (query.month !== undefined) {
      where.push("month = ?");
      values.push(query.month);
    }
    if (!query.includeArchived) where.push("archived_at IS NULL");
    const rows = this.database.sqlite
      .prepare(`SELECT * FROM monthly_goals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY year DESC, month DESC, created_at ASC, rowid ASC`)
      .all(...values) as MonthlyGoalRow[];
    return this.serializeMany(rows, Date.now());
  }

  get(id: string): MonthlyGoal {
    const row = this.database.sqlite.prepare("SELECT * FROM monthly_goals WHERE id = ?").get(id) as MonthlyGoalRow | undefined;
    if (!row) throw notFound("月目标不存在");
    return this.serializeMany([row], Date.now())[0]!;
  }

  create(input: CreateMonthlyGoal): MonthlyGoal {
    if (input.workPlanId) this.assertWorkPlanExists(input.workPlanId);
    const id = newId();
    const timestamp = nowIso();
    this.database.sqlite
      .prepare(
        "INSERT INTO monthly_goals(id, title, description, year, month, work_plan_id, archived_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)",
      )
      .run(id, input.title, input.description, input.year, input.month, input.workPlanId, timestamp, timestamp);
    return this.get(id);
  }

  update(id: string, input: UpdateMonthlyGoal): MonthlyGoal {
    const current = this.database.sqlite.prepare("SELECT * FROM monthly_goals WHERE id = ?").get(id) as MonthlyGoalRow | undefined;
    if (!current) throw notFound("月目标不存在");
    if (input.workPlanId !== undefined && input.workPlanId !== null) this.assertWorkPlanExists(input.workPlanId);
    const title = input.title ?? current.title;
    const description = input.description ?? current.description;
    const year = input.year ?? current.year;
    const month = input.month ?? current.month;
    const workPlanId = input.workPlanId !== undefined ? input.workPlanId : current.work_plan_id;
    const archivedAt = input.archived === undefined ? current.archived_at : input.archived ? nowIso() : null;
    const result = this.database.sqlite
      .prepare(
        "UPDATE monthly_goals SET title = ?, description = ?, year = ?, month = ?, work_plan_id = ?, archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .run(title, description, year, month, workPlanId, archivedAt, nowIso(), id, input.version);
    if (result.changes === 0) throw versionConflict();
    return this.get(id);
  }

  quickEdit(input: MonthlyGoalQuickEdit): MonthlyGoalQuickEditResult {
    const execute = this.database.sqlite.transaction(() => {
      const current = this.database.sqlite
        .prepare("SELECT * FROM monthly_goals WHERE year = ? ORDER BY created_at ASC, title ASC, id ASC")
        .all(input.year) as MonthlyGoalRow[];
      const baseline = new Map(input.baseline.map((item) => [item.id, item.version]));
      if (baseline.size !== current.length || current.some((row) => baseline.get(row.id) !== row.version)) {
        throw versionConflict();
      }

      const groups = new Map<string, MonthlyGoalRow[]>();
      for (const goal of current) {
        const title = goal.title.trim();
        const group = groups.get(title) ?? [];
        group.push(goal);
        groups.set(title, group);
      }

      const rowsByOriginalTitle = new Map<string, MonthlyGoalQuickEdit["rows"][number]>();
      for (const row of input.rows) {
        if (row.originalTitle === null) continue;
        if (rowsByOriginalTitle.has(row.originalTitle)) throw invalidInput("已有目标名称不能重复");
        if (!groups.has(row.originalTitle)) throw invalidInput(`年度目标「${row.originalTitle}」不存在或已发生变化`);
        rowsByOriginalTitle.set(row.originalTitle, row);
      }
      for (const title of groups.keys()) {
        if (!rowsByOriginalTitle.has(title)) throw invalidInput(`年度目标「${title}」未提交`);
      }

      let createdCount = 0;
      let updatedCount = 0;
      const timestamp = nowIso();
      const update = this.database.sqlite.prepare(
        "UPDATE monthly_goals SET title = ?, archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      );
      const insert = this.database.sqlite.prepare(
        "INSERT INTO monthly_goals(id, title, description, year, month, work_plan_id, archived_at, version, series_id, occurrence_key, created_at, updated_at) VALUES (?, ?, '', ?, ?, NULL, NULL, 1, NULL, NULL, ?, ?)",
      );

      for (const [originalTitle, group] of groups) {
        const row = rowsByOriginalTitle.get(originalTitle)!;
        const activeMonths = new Set(row.activeMonths);
        const existingMonths = new Set(group.map((goal) => goal.month));
        const initiallyActiveMonths = new Set(
          group.filter((goal) => goal.archived_at === null).map((goal) => goal.month),
        );

        for (const goal of group) {
          const initiallyActive = initiallyActiveMonths.has(goal.month);
          const shouldBeActive = activeMonths.has(goal.month);
          let archivedAt = goal.archived_at;
          if (initiallyActive && !shouldBeActive && goal.archived_at === null) archivedAt = timestamp;
          if (!initiallyActive && shouldBeActive && goal.archived_at !== null) archivedAt = null;
          if (goal.title !== row.title || archivedAt !== goal.archived_at) {
            const result = update.run(row.title, archivedAt, timestamp, goal.id, goal.version);
            if (result.changes !== 1) throw versionConflict();
            updatedCount += 1;
          }
        }

        for (const month of activeMonths) {
          if (existingMonths.has(month)) continue;
          insert.run(newId(), row.title, input.year, month, timestamp, timestamp);
          createdCount += 1;
        }
      }

      for (const row of input.rows) {
        if (row.originalTitle !== null) continue;
        for (const month of row.activeMonths) {
          insert.run(newId(), row.title, input.year, month, timestamp, timestamp);
          createdCount += 1;
        }
      }

      const saved = this.database.sqlite
        .prepare("SELECT * FROM monthly_goals WHERE year = ? ORDER BY year DESC, month DESC, created_at ASC, rowid ASC")
        .all(input.year) as MonthlyGoalRow[];
      return {
        createdCount,
        updatedCount,
        goals: this.serializeMany(saved, Date.now()),
      };
    });
    return execute();
  }

  delete(id: string, version: number): void {
    const result = this.database.sqlite.prepare("DELETE FROM monthly_goals WHERE id = ? AND version = ?").run(id, version);
    if (result.changes === 0) {
      const exists = this.database.sqlite.prepare("SELECT id FROM monthly_goals WHERE id = ?").get(id);
      if (!exists) throw notFound("月目标不存在");
      throw versionConflict();
    }
  }

  /**
   * Replaces the set of Monthly Goals linked to one Work Plan.
   * Validation: every referenced goal must exist, and a goal already linked to
   * another plan is rejected with a clear 422. Archived goals may still be linked.
   */
  setTaskLinks(workPlanId: string, goalIds: string[]): void {
    const uniqueIds = [...new Set(goalIds)];
    this.validateGoalIds(uniqueIds);
    const occupied = uniqueIds.length > 0
      ? (this.database.sqlite
          .prepare(`SELECT id, title FROM monthly_goals WHERE id IN (${uniqueIds.map(() => "?").join(",")}) AND work_plan_id IS NOT NULL AND work_plan_id != ?`)
          .all(...uniqueIds, workPlanId) as Array<{ id: string; title: string }>)
      : [];
    if (occupied.length > 0) {
      throw invalidInput(`月目标「${occupied[0]!.title}」已关联其他工作计划`, { monthlyGoalIds: [occupied[0]!.id] });
    }
    const execute = this.database.sqlite.transaction(() => {
      const timestamp = nowIso();
      if (uniqueIds.length > 0) {
        this.database.sqlite
          .prepare(`UPDATE monthly_goals SET work_plan_id = NULL, version = version + 1, updated_at = ? WHERE work_plan_id = ? AND id NOT IN (${uniqueIds.map(() => "?").join(",")})`)
          .run(timestamp, workPlanId, ...uniqueIds);
        this.database.sqlite
          .prepare(`UPDATE monthly_goals SET work_plan_id = ?, version = version + 1, updated_at = ? WHERE id IN (${uniqueIds.map(() => "?").join(",")}) AND (work_plan_id IS NULL OR work_plan_id != ?)`)
          .run(workPlanId, timestamp, ...uniqueIds, workPlanId);
      } else {
        this.database.sqlite.prepare("UPDATE monthly_goals SET work_plan_id = NULL, version = version + 1, updated_at = ? WHERE work_plan_id = ?").run(timestamp, workPlanId);
      }
    });
    execute();
  }

  getGoalIdsByWorkPlan(workPlanId: string): string[] {
    const rows = this.database.sqlite
      .prepare("SELECT id FROM monthly_goals WHERE work_plan_id = ? ORDER BY created_at ASC")
      .all(workPlanId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Batch variant of getGoalIdsByWorkPlan for avoid N+1 in WorkPlan list/search serialization. */
  indexGoalIdsByWorkPlan(workPlanIds: string[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    if (workPlanIds.length === 0) return index;
    const rows = this.database.sqlite
      .prepare(`SELECT id, work_plan_id FROM monthly_goals WHERE work_plan_id IN (${workPlanIds.map(() => "?").join(",")}) ORDER BY created_at ASC`)
      .all(...workPlanIds) as Array<{ id: string; work_plan_id: string }>;
    for (const row of rows) {
      const list = index.get(row.work_plan_id) ?? [];
      list.push(row.id);
      index.set(row.work_plan_id, list);
    }
    return index;
  }

  validateGoalIds(goalIds: string[]): void {
    if (goalIds.length === 0) return;
    const rows = this.database.sqlite
      .prepare(`SELECT id FROM monthly_goals WHERE id IN (${goalIds.map(() => "?").join(",")})`)
      .all(...goalIds) as Array<{ id: string }>;
    if (rows.length !== new Set(goalIds).size) {
      throw invalidInput("关联的月目标不存在");
    }
  }

  private assertWorkPlanExists(workPlanId: string): void {
    const row = this.database.sqlite.prepare("SELECT id FROM work_plans WHERE id = ?").get(workPlanId);
    if (!row) throw invalidInput("关联的工作计划不存在");
  }

  private serializeMany(rows: MonthlyGoalRow[], now: number): MonthlyGoal[] {
    const linkedIds = [...new Set(rows.map((row) => row.work_plan_id).filter((id): id is string => id !== null))];
    const linkedByWorkPlan = new Map<string, LinkedWorkPlanRow>();
    if (linkedIds.length > 0) {
      const linkedRows = this.database.sqlite
        .prepare(`SELECT id, title, status, status_mode, start_at, end_at FROM work_plans WHERE id IN (${linkedIds.map(() => "?").join(",")})`)
        .all(...linkedIds) as LinkedWorkPlanRow[];
      for (const row of linkedRows) linkedByWorkPlan.set(row.id, row);
    }
    return rows.map((row) => this.serialize(row, row.work_plan_id ? linkedByWorkPlan.get(row.work_plan_id) : undefined, now));
  }

  private serialize(row: MonthlyGoalRow, linked: LinkedWorkPlanRow | undefined, now: number): MonthlyGoal {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      year: row.year,
      month: row.month,
      archivedAt: row.archived_at,
      version: row.version,
      status: linked ? (linked.status_mode === "manual" ? linked.status : deriveWorkPlanStatus(linked.start_at, linked.end_at, now)) : null,
      linkedWorkPlan: linked ? { id: linked.id, title: linked.title } : null,
      seriesId: row.series_id,
      occurrenceKey: row.occurrence_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
