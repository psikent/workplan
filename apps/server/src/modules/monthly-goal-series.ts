import { createHash } from "node:crypto";
import type {
  CreateMonthlyGoalSeries,
  DissolveMonthlyGoalSeries,
  MonthlyGoal,
  MonthlyGoalPeriod,
  MonthlyGoalSeries,
  MonthlyGoalSeriesDissolveInstance,
  MonthlyGoalSeriesDissolvePreview,
  MonthlyGoalSeriesDissolveReason,
  MonthlyGoalSeriesDissolveResult,
  MonthlyGoalSeriesFrequency,
  UpdateMonthlyGoalSeries,
  WorkPlanStatus,
  WorkPlanStatusMode,
} from "@workplan/contracts";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput, notFound, versionConflict } from "../errors.js";
import { newId, nowIso } from "../utils.js";
import type { MonthlyGoalService } from "./monthly-goals.js";

type SeriesRow = {
  id: string;
  template_json: string;
  frequency: MonthlyGoalSeriesFrequency;
  interval: number;
  start_year: number;
  start_month: number;
  occurrence_count: number | null;
  until_year: number | null;
  until_month: number | null;
  active: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type InstancePeriod = { id: string; title: string; year: number; month: number; archivedAt: string | null };

type DissolveInstanceRow = {
  id: string;
  title: string;
  description: string;
  year: number;
  month: number;
  archived_at: string | null;
  work_plan_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  work_plan_title: string | null;
  work_plan_status: WorkPlanStatus | null;
  work_plan_status_mode: WorkPlanStatusMode | null;
  work_plan_start_at: string | null;
  work_plan_end_at: string | null;
};

export type SeriesDetail = MonthlyGoalSeries & { instances: InstancePeriod[] };

const MAX_PERIODS = 600;

function periodKey(period: MonthlyGoalPeriod): number {
  return period.year * 12 + period.month - 1;
}

function addMonths(period: MonthlyGoalPeriod, months: number): MonthlyGoalPeriod {
  const key = periodKey(period) + months;
  return { year: Math.floor(key / 12), month: (key % 12) + 1 };
}

function stepMonths(frequency: MonthlyGoalSeriesFrequency, interval: number): number {
  if (frequency === "monthly") return interval;
  if (frequency === "quarterly") return interval * 3;
  return interval * 12;
}

function occurrenceKey(period: MonthlyGoalPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function validateBounds(startPeriod: MonthlyGoalPeriod, occurrenceCount: number | null, untilPeriod: MonthlyGoalPeriod | null): void {
  if (occurrenceCount == null && untilPeriod == null) throw invalidInput("必须指定期数或结束月份之一");
  if (untilPeriod && periodKey(untilPeriod) < periodKey(startPeriod)) throw invalidInput("结束月份不能早于起始月份");
}

function targetPeriods(startPeriod: MonthlyGoalPeriod, frequency: MonthlyGoalSeriesFrequency, interval: number, occurrenceCount: number | null, untilPeriod: MonthlyGoalPeriod | null): MonthlyGoalPeriod[] {
  const step = stepMonths(frequency, interval);
  const untilKey = untilPeriod ? periodKey(untilPeriod) : Number.POSITIVE_INFINITY;
  const periods: MonthlyGoalPeriod[] = [];
  let current = { ...startPeriod };
  while (periods.length < (occurrenceCount ?? Number.POSITIVE_INFINITY) && periodKey(current) <= untilKey) {
    periods.push(current);
    current = addMonths(current, step);
    if (periods.length > MAX_PERIODS) throw invalidInput(`单次生成的期数不能超过 ${MAX_PERIODS}`);
  }
  return periods;
}

export class MonthlyGoalSeriesService {
  constructor(
    private readonly database: DatabaseBundle,
    private readonly monthlyGoals: MonthlyGoalService,
  ) {}

  create(input: CreateMonthlyGoalSeries): { series: MonthlyGoalSeries; generated: MonthlyGoal[] } {
    validateBounds(input.startPeriod, input.occurrenceCount ?? null, input.untilPeriod ?? null);
    const periods = targetPeriods(input.startPeriod, input.frequency, input.interval, input.occurrenceCount ?? null, input.untilPeriod ?? null);
    const id = newId();
    const timestamp = nowIso();
    let generated: MonthlyGoal[] = [];
    // 系列行与实例同一事务：生成中途失败不留下"无实例的系列"。
    const execute = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "INSERT INTO monthly_goal_series(id, template_json, frequency, interval, start_year, start_month, occurrence_count, until_year, until_month, active, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
        )
        .run(
          id,
          JSON.stringify(input.template),
          input.frequency,
          input.interval,
          input.startPeriod.year,
          input.startPeriod.month,
          input.occurrenceCount ?? null,
          input.untilPeriod?.year ?? null,
          input.untilPeriod?.month ?? null,
          timestamp,
          timestamp,
        );
      generated = this.insertMissingPeriods(id, input.template, periods);
    });
    execute();
    return { series: this.get(id), generated };
  }

  list(): MonthlyGoalSeries[] {
    const rows = this.database.sqlite.prepare("SELECT * FROM monthly_goal_series ORDER BY created_at DESC").all() as SeriesRow[];
    const counts = this.instanceCounts(rows.map((row) => row.id));
    return rows.map((row) => this.serialize(row, counts.get(row.id) ?? 0));
  }

  get(id: string): SeriesDetail {
    const row = this.database.sqlite.prepare("SELECT * FROM monthly_goal_series WHERE id = ?").get(id) as SeriesRow | undefined;
    if (!row) throw notFound("目标重复系列不存在");
    const instances = this.database.sqlite
      .prepare("SELECT id, title, year, month, archived_at FROM monthly_goals WHERE series_id = ? ORDER BY year, month")
      .all(id) as Array<{ id: string; title: string; year: number; month: number; archived_at: string | null }>;
    return {
      ...this.serialize(row, instances.length),
      instances: instances.map((instance) => ({ id: instance.id, title: instance.title, year: instance.year, month: instance.month, archivedAt: instance.archived_at })),
    };
  }

  update(id: string, input: UpdateMonthlyGoalSeries): { series: SeriesDetail; generated: MonthlyGoal[] } {
    const current = this.database.sqlite.prepare("SELECT * FROM monthly_goal_series WHERE id = ?").get(id) as SeriesRow | undefined;
    if (!current) throw notFound("目标重复系列不存在");
    const currentTemplate = JSON.parse(current.template_json) as { title: string; description: string };
    const template = {
      title: input.template?.title ?? currentTemplate.title,
      description: input.template?.description ?? currentTemplate.description,
    };
    const frequency = input.frequency ?? current.frequency;
    const interval = input.interval ?? current.interval;
    const startPeriod: MonthlyGoalPeriod = input.startPeriod ?? { year: current.start_year, month: current.start_month };
    const occurrenceCount = input.occurrenceCount === undefined ? current.occurrence_count : input.occurrenceCount;
    const untilPeriod: MonthlyGoalPeriod | null = input.untilPeriod === undefined
      ? current.until_year != null && current.until_month != null ? { year: current.until_year, month: current.until_month } : null
      : input.untilPeriod;
    validateBounds(startPeriod, occurrenceCount, untilPeriod);
    const periods = targetPeriods(startPeriod, frequency, interval, occurrenceCount, untilPeriod);
    let generated: MonthlyGoal[] = [];
    // 规则更新与补齐实例同一事务：中途失败不留下"规则已变、实例未补"的状态。
    const execute = this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          "UPDATE monthly_goal_series SET template_json = ?, frequency = ?, interval = ?, start_year = ?, start_month = ?, occurrence_count = ?, until_year = ?, until_month = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        )
        .run(
          JSON.stringify(template),
          frequency,
          interval,
          startPeriod.year,
          startPeriod.month,
          occurrenceCount,
          untilPeriod?.year ?? null,
          untilPeriod?.month ?? null,
          nowIso(),
          id,
          input.version,
        );
      if (result.changes === 0) throw versionConflict();
      // A stopped series only accepts rule/template edits; generation stays off.
      if (current.active === 1) generated = this.insertMissingPeriods(id, template, periods);
    });
    execute();
    return { series: this.get(id), generated };
  }

  stop(id: string, version: number): void {
    const result = this.database.sqlite
      .prepare("UPDATE monthly_goal_series SET active = 0, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(nowIso(), id, version);
    if (result.changes === 0) {
      const exists = this.database.sqlite.prepare("SELECT id FROM monthly_goal_series WHERE id = ?").get(id);
      if (!exists) throw notFound("目标重复系列不存在");
      throw versionConflict();
    }
  }

  previewDissolve(id: string, keepGoalId: string): MonthlyGoalSeriesDissolvePreview {
    const series = this.database.sqlite.prepare("SELECT * FROM monthly_goal_series WHERE id = ?").get(id) as SeriesRow | undefined;
    if (!series) throw notFound("目标重复系列不存在");
    const rows = this.dissolveRows(id);
    const keep = rows.find((row) => row.id === keepGoalId);
    if (!keep) {
      const goalExists = this.database.sqlite.prepare("SELECT id FROM monthly_goals WHERE id = ?").get(keepGoalId);
      if (!goalExists) throw notFound("月目标不存在");
      throw invalidInput("发起目标不属于该重复系列");
    }
    const instances = rows.map((row) => this.classifyDissolveInstance(row, keepGoalId));
    return {
      seriesId: id,
      seriesVersion: series.version,
      snapshotToken: this.dissolveSnapshotToken(series, rows),
      keepGoal: { id: keep.id, title: keep.title, year: keep.year, month: keep.month },
      counts: {
        retained: instances.filter((instance) => instance.action === "retain").length,
        deleted: instances.filter((instance) => instance.action === "delete").length,
        linked: rows.filter((row) => row.work_plan_id !== null).length,
      },
      instances,
    };
  }

  dissolve(id: string, input: DissolveMonthlyGoalSeries): MonthlyGoalSeriesDissolveResult {
    const execute = this.database.sqlite.transaction(() => {
      const preview = this.previewDissolve(id, input.keepGoalId);
      if (preview.snapshotToken !== input.snapshotToken) throw versionConflict();
      if (preview.keepGoal.title !== input.confirmationTitle) throw invalidInput("请输入发起目标的完整名称确认解散");
      const retainedIds = preview.instances.filter((instance) => instance.action === "retain").map((instance) => instance.id);
      const deletedIds = preview.instances.filter((instance) => instance.action === "delete").map((instance) => instance.id);
      if (deletedIds.length > 0) {
        this.database.sqlite
          .prepare(`DELETE FROM monthly_goals WHERE id IN (${deletedIds.map(() => "?").join(",")})`)
          .run(...deletedIds);
      }
      this.database.sqlite
        .prepare(`UPDATE monthly_goals SET series_id = NULL, occurrence_key = NULL, version = version + 1, updated_at = ? WHERE id IN (${retainedIds.map(() => "?").join(",")})`)
        .run(nowIso(), ...retainedIds);
      this.database.sqlite.prepare("DELETE FROM monthly_goal_series WHERE id = ?").run(id);
      return { retainedCount: retainedIds.length, deletedCount: deletedIds.length };
    });
    return execute();
  }

  private dissolveRows(id: string): DissolveInstanceRow[] {
    return this.database.sqlite
      .prepare(
        `SELECT monthly_goals.id, monthly_goals.title, monthly_goals.description, monthly_goals.year, monthly_goals.month,
          monthly_goals.archived_at, monthly_goals.work_plan_id, monthly_goals.version, monthly_goals.created_at, monthly_goals.updated_at,
          work_plans.title AS work_plan_title, work_plans.status AS work_plan_status, work_plans.status_mode AS work_plan_status_mode,
          work_plans.start_at AS work_plan_start_at, work_plans.end_at AS work_plan_end_at
        FROM monthly_goals
        LEFT JOIN work_plans ON work_plans.id = monthly_goals.work_plan_id
        WHERE monthly_goals.series_id = ?
        ORDER BY monthly_goals.year, monthly_goals.month, monthly_goals.id`,
      )
      .all(id) as DissolveInstanceRow[];
  }

  private classifyDissolveInstance(row: DissolveInstanceRow, keepGoalId: string): MonthlyGoalSeriesDissolveInstance {
    const reasons: MonthlyGoalSeriesDissolveReason[] = [];
    const status = row.work_plan_id && row.work_plan_status && row.work_plan_status_mode && row.work_plan_start_at && row.work_plan_end_at
      ? row.work_plan_status_mode === "manual"
        ? row.work_plan_status
        : deriveWorkPlanStatus(row.work_plan_start_at, row.work_plan_end_at)
      : null;
    if (row.id === keepGoalId) reasons.push("selected");
    if (row.updated_at !== row.created_at) reasons.push("edited");
    if (row.archived_at !== null) reasons.push("archived");
    if (row.work_plan_id !== null) reasons.push("linked");
    if (status === "completed") reasons.push("completed");
    return {
      id: row.id,
      title: row.title,
      year: row.year,
      month: row.month,
      archivedAt: row.archived_at,
      linkedWorkPlan: row.work_plan_id && row.work_plan_title ? { id: row.work_plan_id, title: row.work_plan_title } : null,
      status,
      action: reasons.length > 0 ? "retain" : "delete",
      reasons,
    };
  }

  private dissolveSnapshotToken(series: SeriesRow, rows: DissolveInstanceRow[]): string {
    return createHash("sha256")
      .update(JSON.stringify({
        series: { id: series.id, version: series.version, active: series.active },
        instances: rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          year: row.year,
          month: row.month,
          archivedAt: row.archived_at,
          workPlanId: row.work_plan_id,
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          workPlanTitle: row.work_plan_title,
          workPlanStatus: row.work_plan_status,
          workPlanStatusMode: row.work_plan_status_mode,
          workPlanStartAt: row.work_plan_start_at,
          workPlanEndAt: row.work_plan_end_at,
        })),
      }))
      .digest("hex");
  }

  private insertMissingPeriods(id: string, template: { title: string; description: string }, periods: MonthlyGoalPeriod[]): MonthlyGoal[] {
    if (periods.length === 0) return [];
    const existingKeys = new Set(
      (this.database.sqlite.prepare("SELECT occurrence_key FROM monthly_goals WHERE series_id = ?").all(id) as Array<{ occurrence_key: string | null }>)
        .map((row) => row.occurrence_key)
        .filter((key): key is string => key !== null),
    );
    const createdIds: string[] = [];
    const execute = this.database.sqlite.transaction(() => {
      for (const period of periods) {
        const key = occurrenceKey(period);
        if (existingKeys.has(key)) continue;
        const goalId = newId();
        const timestamp = nowIso();
        this.database.sqlite
          .prepare(
            "INSERT INTO monthly_goals(id, title, description, year, month, work_plan_id, archived_at, version, series_id, occurrence_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?)",
          )
          .run(goalId, template.title, template.description, period.year, period.month, id, key, timestamp, timestamp);
        existingKeys.add(key);
        createdIds.push(goalId);
      }
    });
    execute();
    return createdIds.map((goalId) => this.monthlyGoals.get(goalId));
  }

  private instanceCounts(seriesIds: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    if (seriesIds.length === 0) return counts;
    const rows = this.database.sqlite
      .prepare(`SELECT series_id, COUNT(*) AS count FROM monthly_goals WHERE series_id IN (${seriesIds.map(() => "?").join(",")}) GROUP BY series_id`)
      .all(...seriesIds) as Array<{ series_id: string; count: number }>;
    for (const row of rows) counts.set(row.series_id, row.count);
    return counts;
  }

  private serialize(row: SeriesRow, instanceCount: number): MonthlyGoalSeries {
    const template = JSON.parse(row.template_json) as { title: string; description: string };
    return {
      id: row.id,
      template,
      frequency: row.frequency,
      interval: row.interval,
      startPeriod: { year: row.start_year, month: row.start_month },
      occurrenceCount: row.occurrence_count,
      untilPeriod: row.until_year != null && row.until_month != null ? { year: row.until_year, month: row.until_month } : null,
      active: row.active === 1,
      version: row.version,
      instanceCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
