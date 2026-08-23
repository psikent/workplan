import type {
  CreateMonthlyGoalSeries,
  MonthlyGoal,
  MonthlyGoalPeriod,
  MonthlyGoalSeries,
  MonthlyGoalSeriesFrequency,
  UpdateMonthlyGoalSeries,
} from "@workplan/contracts";
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
    const generated = this.insertMissingPeriods(id, input.template, periods);
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
    const generated = current.active === 1 ? this.insertMissingPeriods(id, template, periods) : [];
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
