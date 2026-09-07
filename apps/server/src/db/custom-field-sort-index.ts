import type Database from "better-sqlite3";

// 自定义字段排序物化索引（票据 20）。
//
// 背景：自定义字段排序需要 JOIN custom_field_values 后 ORDER BY，排序键与排期兜底链
// （start_at/end_at/created_at/id）分属两张表，任何单表索引都无法满足完整排序，
// SQLite 只能对全量 JOIN 结果建 TEMP B-TREE（十万行 p95 562-901ms）。
//
// 方案：把每个（字段, 计划）的最终排序键 + 排期链尾列物化到一张表，并建两条与
// 排序方向一一对应的覆盖索引，排序查询退化为索引顺序扫描 + 提前终止。
//
// 稀疏语义（与 WorkPlanQueryEngine.customSortLevel 严格一致，改动必须两侧同步）：
// - 仅存储"键非空"的行；short_text/url → NULLIF(text_sort_key, '')，number →
//   number_value，boolean → boolean_value，date → date_value，datetime →
//   datetime_sort_key，single_select → 选项 sort_order（ADR-0009，含归档选项）；
// - 键为 NULL（缺失/空白/失效选项）的计划不入表，由查询侧以"无索引行的计划"
//   反连接补齐空值区，按排期链排序置后——存稠密空行会让行数膨胀到 计划×字段 级；
// - 链尾方向固定：start_at ASC、end_at DESC、created_at ASC、work_plan_id ASC，
//   已固化进两条索引，不随显式排序方向改变。
//
// 一致性由触发器维护，覆盖全部写入路径（应用层、导入恢复、SQL 回填、级联删除）：
// 值行 INSERT/UPDATE/DELETE、计划改期、选项增删与重排。

const SKEY_EXPR = `(CASE d.type
  WHEN 'short_text' THEN NULLIF(v.text_sort_key, '')
  WHEN 'url' THEN NULLIF(v.text_sort_key, '')
  WHEN 'number' THEN v.number_value
  WHEN 'boolean' THEN v.boolean_value
  WHEN 'date' THEN v.date_value
  WHEN 'datetime' THEN v.datetime_sort_key
  WHEN 'single_select' THEN (SELECT o.sort_order FROM custom_field_options o WHERE o.field_id = v.field_id AND o.value = v.text_value)
END)`;

const SORTABLE_TYPES = `d.type IN ('short_text', 'url', 'number', 'boolean', 'date', 'datetime', 'single_select')`;

const INDEX_ROW_SELECT = `SELECT v.field_id, v.work_plan_id, ${SKEY_EXPR}, wp.start_at, wp.end_at, wp.created_at
FROM custom_field_values v
JOIN custom_field_definitions d ON d.id = v.field_id
JOIN work_plans wp ON wp.id = v.work_plan_id`;

const INSERT_INDEX_ROWS = (scope: string) => `INSERT INTO custom_field_sort_index(field_id, work_plan_id, skey, start_at, end_at, created_at)
${INDEX_ROW_SELECT}
WHERE ${scope}`;

export const SORT_INDEX_TRIGGERS = [
  "custom_field_sort_index_values_ai",
  "custom_field_sort_index_values_au",
  "custom_field_sort_index_values_ad",
  "custom_field_sort_index_plans_au",
  "custom_field_sort_index_options_ai",
  "custom_field_sort_index_options_au",
  "custom_field_sort_index_options_ad",
] as const;

export const SORT_INDEX_TABLE_DDL = `
  CREATE TABLE custom_field_sort_index (
    field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
    work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
    skey,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (field_id, work_plan_id)
  );
  CREATE INDEX idx_custom_sort_index_asc ON custom_field_sort_index(field_id, skey, start_at, end_at DESC, created_at, work_plan_id);
  CREATE INDEX idx_custom_sort_index_desc ON custom_field_sort_index(field_id, skey DESC, start_at, end_at DESC, created_at, work_plan_id);
`;

export const SORT_INDEX_TRIGGER_DDL = `
  CREATE TRIGGER custom_field_sort_index_values_ai AFTER INSERT ON custom_field_values
  BEGIN
    ${INSERT_INDEX_ROWS(`(${SKEY_EXPR}) IS NOT NULL AND v.work_plan_id = NEW.work_plan_id AND v.field_id = NEW.field_id AND ${SORTABLE_TYPES}`)};
  END;
  CREATE TRIGGER custom_field_sort_index_values_au AFTER UPDATE ON custom_field_values
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = OLD.field_id AND work_plan_id = OLD.work_plan_id;
    ${INSERT_INDEX_ROWS(`(${SKEY_EXPR}) IS NOT NULL AND v.work_plan_id = NEW.work_plan_id AND v.field_id = NEW.field_id AND ${SORTABLE_TYPES}`)};
  END;
  CREATE TRIGGER custom_field_sort_index_values_ad AFTER DELETE ON custom_field_values
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = OLD.field_id AND work_plan_id = OLD.work_plan_id;
  END;
  CREATE TRIGGER custom_field_sort_index_plans_au AFTER UPDATE OF start_at, end_at, created_at ON work_plans
  BEGIN
    UPDATE custom_field_sort_index SET start_at = NEW.start_at, end_at = NEW.end_at, created_at = NEW.created_at WHERE work_plan_id = NEW.id;
  END;
  CREATE TRIGGER custom_field_sort_index_options_ai AFTER INSERT ON custom_field_options
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = NEW.field_id;
    ${INSERT_INDEX_ROWS(`(${SKEY_EXPR}) IS NOT NULL AND v.field_id = NEW.field_id AND ${SORTABLE_TYPES}`)};
  END;
  CREATE TRIGGER custom_field_sort_index_options_au AFTER UPDATE OF sort_order ON custom_field_options
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = NEW.field_id;
    ${INSERT_INDEX_ROWS(`(${SKEY_EXPR}) IS NOT NULL AND v.field_id = NEW.field_id AND ${SORTABLE_TYPES}`)};
  END;
  CREATE TRIGGER custom_field_sort_index_options_ad AFTER DELETE ON custom_field_options
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = OLD.field_id;
    ${INSERT_INDEX_ROWS(`(${SKEY_EXPR}) IS NOT NULL AND v.field_id = OLD.field_id AND ${SORTABLE_TYPES}`)};
  END;
`;

export const SORT_INDEX_DDL = SORT_INDEX_TABLE_DDL + SORT_INDEX_TRIGGER_DDL;

// 全量重建（集合式）：迁移回填、触发器挂起的批量装载（JSON 恢复/基准建库）后调用。
// 调用方负责事务包裹。
export function rebuildCustomFieldSortIndex(sqlite: Database.Database): void {
  sqlite.exec("DELETE FROM custom_field_sort_index");
  sqlite.exec(`${INSERT_INDEX_ROWS(`(${SKEY_EXPR}) IS NOT NULL AND ${SORTABLE_TYPES}`)};`);
}

// 批量装载辅助：逐行触发器在十万行级写入下是常数级放大，挂起后集合重建一次完成。
// 必须在调用方事务内使用（SQLite 的 DDL 可回滚，异常时触发器随之恢复）。
export function withSortIndexBulkLoad<T>(sqlite: Database.Database, load: () => T): T {
  for (const trigger of SORT_INDEX_TRIGGERS) sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  try {
    return load();
  } finally {
    sqlite.exec(SORT_INDEX_TRIGGER_DDL);
    rebuildCustomFieldSortIndex(sqlite);
  }
}
