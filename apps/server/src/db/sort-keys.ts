import { naturalSortKey, normalizeDateTimeForSort } from "@workplan/contracts";
import type Database from "better-sqlite3";

// 重算全部排序键：标题键 + 自定义字段文本/日期时间键。
// 供排序键迁移的回填与 JSON 备份恢复后使用；调用方负责事务包裹。
export function recomputeWorkPlanSortKeys(database: Database.Database): { plans: number; values: number } {
  const updatePlan = database.prepare("UPDATE work_plans SET title_sort_key = ? WHERE id = ?");
  let plans = 0;
  for (const row of database.prepare("SELECT id, title FROM work_plans").all() as Array<{ id: string; title: string }>) {
    updatePlan.run(naturalSortKey(row.title), row.id);
    plans += 1;
  }

  const updateValue = database
    .prepare("UPDATE custom_field_values SET text_sort_key = ?, datetime_sort_key = ? WHERE work_plan_id = ? AND field_id = ?")
    ;
  let values = 0;
  const rows = database
    .prepare(
      "SELECT v.work_plan_id AS workPlanId, v.field_id AS fieldId, v.text_value AS textValue, v.url_value AS urlValue, v.datetime_value AS datetimeValue, d.type AS type FROM custom_field_values v JOIN custom_field_definitions d ON d.id = v.field_id",
    )
    .all() as Array<{ workPlanId: string; fieldId: string; textValue: string | null; urlValue: string | null; datetimeValue: string | null; type: string }>;
  for (const row of rows) {
    let textKey: string | null = null;
    let datetimeKey: string | null = null;
    if (row.type === "short_text" && row.textValue != null) textKey = naturalSortKey(row.textValue);
    if (row.type === "url" && row.urlValue != null) textKey = naturalSortKey(row.urlValue);
    if (row.type === "datetime" && row.datetimeValue != null) datetimeKey = normalizeDateTimeForSort(row.datetimeValue);
    updateValue.run(textKey, datetimeKey, row.workPlanId, row.fieldId);
    values += 1;
  }
  return { plans, values };
}
