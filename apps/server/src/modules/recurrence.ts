import { Temporal } from "@js-temporal/polyfill";
import type { CreateWorkPlan, RecurrenceRule } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput, notFound, versionConflict } from "../errors.js";
import { nowIso, newId, parseJson } from "../utils.js";
import type { WorkPlanService } from "./work-plans.js";

type SeriesRow = {
  id: string;
  template_json: string;
  frequency: RecurrenceRule["frequency"];
  interval: number;
  weekdays_json: string | null;
  until_at: string | null;
  occurrence_count: number | null;
  time_zone: string;
  generated_through: string | null;
  active: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export class RecurrenceService {
  constructor(
    private readonly database: DatabaseBundle,
    private readonly workPlans: WorkPlanService,
  ) {}

  list() {
    const rows = this.database.sqlite.prepare("SELECT * FROM work_plan_series ORDER BY created_at DESC").all() as SeriesRow[];
    return rows.map((row) => this.serialize(row));
  }

  get(id: string) {
    const row = this.database.sqlite.prepare("SELECT * FROM work_plan_series WHERE id = ?").get(id) as SeriesRow | undefined;
    if (!row) throw notFound("重复规则不存在");
    return this.serialize(row);
  }

  create(workPlan: CreateWorkPlan, recurrence: RecurrenceRule) {
    const id = newId();
    const timestamp = nowIso();
    this.database.sqlite
      .prepare("INSERT INTO work_plan_series(id, template_json, frequency, interval, weekdays_json, until_at, occurrence_count, time_zone, active, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)")
      .run(
        id,
        JSON.stringify(workPlan),
        recurrence.frequency,
        recurrence.interval,
        recurrence.weekdays ? JSON.stringify(recurrence.weekdays) : null,
        recurrence.until ?? null,
        recurrence.count ?? null,
        recurrence.timeZone,
        timestamp,
        timestamp,
      );
    const generated = this.ensureGenerated(id);
    return { series: this.get(id), generated };
  }

  createFromExisting(planId: string, workPlan: CreateWorkPlan, recurrence: RecurrenceRule, version: number) {
    const current = this.workPlans.get(planId);
    if (current.seriesId) throw invalidInput("该工作计划已关联计划周期");
    const id = newId();
    const timestamp = nowIso();
    const attach = this.database.sqlite.transaction(() => {
      const occurrence = this.workPlans.update(planId, { ...workPlan, version });
      this.database.sqlite
        .prepare("INSERT INTO work_plan_series(id, template_json, frequency, interval, weekdays_json, until_at, occurrence_count, time_zone, active, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)")
        .run(
          id,
          JSON.stringify(workPlan),
          recurrence.frequency,
          recurrence.interval,
          recurrence.weekdays ? JSON.stringify(recurrence.weekdays) : null,
          recurrence.until ?? null,
          recurrence.count ?? null,
          recurrence.timeZone,
          timestamp,
          timestamp,
        );
      this.database.sqlite
        .prepare("UPDATE work_plans SET series_id = ?, occurrence_key = ?, updated_at = ? WHERE id = ? AND version = ?")
        .run(id, Temporal.Instant.from(occurrence.startAt).toString(), timestamp, planId, occurrence.version);
    });
    attach();
    const generated = this.ensureGenerated(id);
    return { series: this.get(id), occurrence: this.workPlans.get(planId), generated };
  }

  update(
    id: string,
    input: {
      workPlan?: { [K in keyof CreateWorkPlan]?: CreateWorkPlan[K] | undefined } | undefined;
      recurrence?: { [K in keyof RecurrenceRule]?: RecurrenceRule[K] | undefined } | undefined;
      version: number;
    },
  ) {
    const row = this.database.sqlite.prepare("SELECT * FROM work_plan_series WHERE id = ?").get(id) as SeriesRow | undefined;
    if (!row) throw notFound("重复规则不存在");
    const currentTemplate = parseWorkPlanTemplate(row.template_json);
    const nextTemplate = { ...currentTemplate, ...(input.workPlan ?? {}) };
    const currentWeekdays = parseJson<number[] | undefined>(row.weekdays_json, undefined);
    const next = {
      frequency: input.recurrence?.frequency ?? row.frequency,
      interval: input.recurrence?.interval ?? row.interval,
      weekdays: input.recurrence?.weekdays ?? currentWeekdays,
      until: Object.prototype.hasOwnProperty.call(input.recurrence ?? {}, "until") ? input.recurrence?.until : row.until_at ?? undefined,
      count: Object.prototype.hasOwnProperty.call(input.recurrence ?? {}, "count") ? input.recurrence?.count : row.occurrence_count ?? undefined,
      timeZone: input.recurrence?.timeZone ?? row.time_zone,
    };
    const execute = this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare("UPDATE work_plan_series SET template_json = ?, frequency = ?, interval = ?, weekdays_json = ?, until_at = ?, occurrence_count = ?, time_zone = ?, generated_through = NULL, active = 1, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(
          JSON.stringify(nextTemplate),
          next.frequency,
          next.interval,
          next.weekdays ? JSON.stringify(next.weekdays) : null,
          next.until ?? null,
          next.count ?? null,
          next.timeZone,
          nowIso(),
          id,
          input.version,
        );
      if (result.changes === 0) throw versionConflict();
      this.database.sqlite
        .prepare("DELETE FROM work_plans WHERE series_id = ? AND start_at > ? AND is_exception = 0 AND status_mode = 'automatic'")
        .run(id, nowIso());
    });
    execute();
    const generated = this.ensureGenerated(id);
    return { series: this.get(id), generated };
  }

  stop(id: string, version: number) {
    const result = this.database.sqlite
      .prepare("UPDATE work_plan_series SET active = 0, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(nowIso(), id, version);
    if (result.changes === 0) throw versionConflict();
    this.database.sqlite
      .prepare("DELETE FROM work_plans WHERE series_id = ? AND start_at > ? AND is_exception = 0 AND status_mode = 'automatic'")
      .run(id, nowIso());
    return this.get(id);
  }

  ensureAllGenerated(): number {
    const rows = this.database.sqlite.prepare("SELECT id FROM work_plan_series WHERE active = 1").all() as Array<{ id: string }>;
    let total = 0;
    for (const row of rows) total += this.ensureGenerated(row.id).length;
    return total;
  }

  ensureGenerated(id: string, horizonDays = 90) {
    const row = this.database.sqlite.prepare("SELECT * FROM work_plan_series WHERE id = ?").get(id) as SeriesRow | undefined;
    if (!row) throw notFound("重复规则不存在");
    if (!row.active) return [];
    const template = parseWorkPlanTemplate(row.template_json);
    const start = Temporal.Instant.from(template.startAt).toZonedDateTimeISO(row.time_zone);
    const durationMilliseconds = Temporal.Instant.from(template.startAt).until(Temporal.Instant.from(template.endAt)).total({ unit: "milliseconds" });
    const currentInstant = Temporal.Now.instant();
    const horizon = currentInstant.add({ hours: horizonDays * 24 });
    const until = row.until_at ? Temporal.Instant.from(row.until_at) : null;
    const weekdays = parseJson<number[]>(row.weekdays_json, [start.dayOfWeek]);
    const generated = [];

    let occurrenceIndex = 0;
    let cursor = start;
    let safety = 0;
    while (cursor.toInstant().epochNanoseconds <= horizon.epochNanoseconds && safety < 100_000) {
      safety += 1;
      let isOccurrence = false;
      if (row.frequency === "daily") {
        const days = start.toPlainDate().until(cursor.toPlainDate(), { largestUnit: "day" }).days;
        isOccurrence = days % row.interval === 0;
      } else if (row.frequency === "weekly") {
        const days = start.toPlainDate().until(cursor.toPlainDate(), { largestUnit: "day" }).days;
        const week = Math.floor(days / 7);
        isOccurrence = week % row.interval === 0 && weekdays.includes(cursor.dayOfWeek);
      } else {
        const startMonth = Temporal.PlainYearMonth.from({ year: start.year, month: start.month });
        const cursorMonth = Temporal.PlainYearMonth.from({ year: cursor.year, month: cursor.month });
        const months = startMonth.until(cursorMonth, { largestUnit: "month" }).months;
        const expectedDay = Math.min(start.day, cursor.daysInMonth);
        isOccurrence = months % row.interval === 0 && cursor.day === expectedDay;
      }

      if (isOccurrence) {
        occurrenceIndex += 1;
        const instant = cursor.toInstant();
        if (row.occurrence_count && occurrenceIndex > row.occurrence_count) break;
        if (until && instant.epochNanoseconds > until.epochNanoseconds) break;
        if (instant.epochNanoseconds >= currentInstant.subtract({ minutes: 1 }).epochNanoseconds) {
          const endInstant = instant.add({ milliseconds: durationMilliseconds });
          const occurrenceInput: CreateWorkPlan = {
            ...template,
            startAt: instant.toString(),
            endAt: endInstant.toString(),
          };
          const created = this.workPlans.createOccurrence(occurrenceInput, id, instant.toString());
          if (created) generated.push(created);
        }
      }

      cursor = cursor.add({ days: 1 });
    }
    this.database.sqlite
      .prepare("UPDATE work_plan_series SET generated_through = ?, updated_at = ? WHERE id = ?")
      .run(horizon.toString(), nowIso(), id);
    return generated;
  }

  private serialize(row: SeriesRow) {
    return {
      id: row.id,
      workPlan: parseWorkPlanTemplate(row.template_json),
      recurrence: {
        frequency: row.frequency,
        interval: row.interval,
        weekdays: parseJson<number[] | undefined>(row.weekdays_json, undefined),
        until: row.until_at,
        count: row.occurrence_count,
        timeZone: row.time_zone,
      },
      generatedThrough: row.generated_through,
      active: Boolean(row.active),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function parseWorkPlanTemplate(json: string): CreateWorkPlan {
  const parsed = parseJson<CreateWorkPlan & { priority?: unknown }>(json, {} as CreateWorkPlan);
  const { priority: _legacyPriority, ...workPlan } = parsed;
  if (!workPlan.statusMode) {
    if (workPlan.status === "cancelled") workPlan.statusMode = "manual";
    else {
      delete workPlan.status;
      workPlan.statusMode = "automatic";
    }
  }
  return workPlan;
}
