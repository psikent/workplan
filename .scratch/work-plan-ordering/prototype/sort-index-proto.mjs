// 票据 20 原型验证：物化自定义字段排序索引 + 覆盖索引 + 触发器维护。
// 验证三件事：触发器语法、快路径 ORDER BY 完全走索引（无 TEMP B-TREE）、键集谓词可用。
import Database from "better-sqlite3";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE work_plans (id TEXT PRIMARY KEY, start_at TEXT NOT NULL, end_at TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE custom_field_definitions (id TEXT PRIMARY KEY, type TEXT NOT NULL);
  CREATE TABLE custom_field_options (id TEXT PRIMARY KEY, field_id TEXT NOT NULL, value TEXT NOT NULL, sort_order INTEGER NOT NULL);
  CREATE TABLE custom_field_values (work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE, field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, text_value TEXT, number_value REAL, boolean_value INTEGER, date_value TEXT, datetime_value TEXT, url_value TEXT, text_sort_key TEXT, datetime_sort_key TEXT, PRIMARY KEY (work_plan_id, field_id));
`);

sqlite.exec(`
  CREATE TABLE custom_field_sort_index (
    field_id TEXT NOT NULL,
    work_plan_id TEXT NOT NULL,
    null_flag INTEGER NOT NULL,
    skey,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (field_id, work_plan_id)
  );
  CREATE INDEX cfsi_asc ON custom_field_sort_index(field_id, null_flag, skey, start_at, end_at DESC, created_at, work_plan_id);
  CREATE INDEX cfsi_desc ON custom_field_sort_index(field_id, null_flag, skey DESC, start_at, end_at DESC, created_at, work_plan_id);
`);

// 排序键表达式：按字段类型挑选键列（与引擎语义一致，短文本 NULLIF 防御空串）
const SKEY_EXPR = `(CASE d.type
  WHEN 'short_text' THEN NULLIF(v.text_sort_key, '')
  WHEN 'url' THEN NULLIF(v.text_sort_key, '')
  WHEN 'number' THEN v.number_value
  WHEN 'boolean' THEN v.boolean_value
  WHEN 'date' THEN v.date_value
  WHEN 'datetime' THEN v.datetime_sort_key
  WHEN 'single_select' THEN (SELECT o.sort_order FROM custom_field_options o WHERE o.field_id = v.field_id AND o.value = v.text_value)
  END)`;
const SORTABLE = `d.type IN ('short_text','url','number','boolean','date','datetime','single_select')`;

sqlite.exec(`
  CREATE TRIGGER custom_field_sort_index_ai AFTER INSERT ON custom_field_values
  BEGIN
    INSERT INTO custom_field_sort_index(field_id, work_plan_id, null_flag, skey, start_at, end_at, created_at)
    SELECT v.field_id, v.work_plan_id, (${SKEY_EXPR}) IS NULL, ${SKEY_EXPR}, wp.start_at, wp.end_at, wp.created_at
    FROM custom_field_values v
    JOIN custom_field_definitions d ON d.id = v.field_id
    JOIN work_plans wp ON wp.id = v.work_plan_id
    WHERE v.work_plan_id = NEW.work_plan_id AND v.field_id = NEW.field_id AND ${SORTABLE};
  END;
  CREATE TRIGGER custom_field_sort_index_au AFTER UPDATE ON custom_field_values
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = OLD.field_id AND work_plan_id = OLD.work_plan_id;
    INSERT INTO custom_field_sort_index(field_id, work_plan_id, null_flag, skey, start_at, end_at, created_at)
    SELECT v.field_id, v.work_plan_id, (${SKEY_EXPR}) IS NULL, ${SKEY_EXPR}, wp.start_at, wp.end_at, wp.created_at
    FROM custom_field_values v
    JOIN custom_field_definitions d ON d.id = v.field_id
    JOIN work_plans wp ON wp.id = v.work_plan_id
    WHERE v.work_plan_id = NEW.work_plan_id AND v.field_id = NEW.field_id AND ${SORTABLE};
  END;
  CREATE TRIGGER custom_field_sort_index_ad AFTER DELETE ON custom_field_values
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = OLD.field_id AND work_plan_id = OLD.work_plan_id;
  END;
  CREATE TRIGGER work_plans_sort_tail_au AFTER UPDATE OF start_at, end_at, created_at ON work_plans
  BEGIN
    UPDATE custom_field_sort_index SET start_at = NEW.start_at, end_at = NEW.end_at, created_at = NEW.created_at WHERE work_plan_id = NEW.id;
  END;
  CREATE TRIGGER custom_field_options_sort_rebuild_ai AFTER INSERT ON custom_field_options
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = NEW.field_id;
    INSERT INTO custom_field_sort_index(field_id, work_plan_id, null_flag, skey, start_at, end_at, created_at)
    SELECT v.field_id, v.work_plan_id, (${SKEY_EXPR}) IS NULL, ${SKEY_EXPR}, wp.start_at, wp.end_at, wp.created_at
    FROM custom_field_values v
    JOIN custom_field_definitions d ON d.id = v.field_id
    JOIN work_plans wp ON wp.id = v.work_plan_id
    WHERE v.field_id = NEW.field_id AND ${SORTABLE};
  END;
  CREATE TRIGGER custom_field_options_sort_rebuild_au AFTER UPDATE OF sort_order ON custom_field_options
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = NEW.field_id;
    INSERT INTO custom_field_sort_index(field_id, work_plan_id, null_flag, skey, start_at, end_at, created_at)
    SELECT v.field_id, v.work_plan_id, (${SKEY_EXPR}) IS NULL, ${SKEY_EXPR}, wp.start_at, wp.end_at, wp.created_at
    FROM custom_field_values v
    JOIN custom_field_definitions d ON d.id = v.field_id
    JOIN work_plans wp ON wp.id = v.work_plan_id
    WHERE v.field_id = NEW.field_id AND ${SORTABLE};
  END;
  CREATE TRIGGER custom_field_options_sort_rebuild_ad AFTER DELETE ON custom_field_options
  BEGIN
    DELETE FROM custom_field_sort_index WHERE field_id = OLD.field_id;
    INSERT INTO custom_field_sort_index(field_id, work_plan_id, null_flag, skey, start_at, end_at, created_at)
    SELECT v.field_id, v.work_plan_id, (${SKEY_EXPR}) IS NULL, ${SKEY_EXPR}, wp.start_at, wp.end_at, wp.created_at
    FROM custom_field_values v
    JOIN custom_field_definitions d ON d.id = v.field_id
    JOIN work_plans wp ON wp.id = v.work_plan_id
    WHERE v.field_id = OLD.field_id AND ${SORTABLE};
  END;
`);

// 小数据冒烟：写入 + 触发器联动
sqlite.prepare("INSERT INTO work_plans(id, start_at, end_at, created_at) VALUES ('p1', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', '2026-01-01T00:00:00Z')").run();
sqlite.prepare("INSERT INTO work_plans(id, start_at, end_at, created_at) VALUES ('p2', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z', '2026-01-01T00:00:00Z')").run();
sqlite.prepare("INSERT INTO custom_field_definitions(id, type) VALUES ('f1', 'short_text')").run();
sqlite.prepare("INSERT INTO custom_field_definitions(id, type) VALUES ('f2', 'number')").run();
sqlite.prepare("INSERT INTO custom_field_definitions(id, type) VALUES ('f3', 'single_select')").run();
sqlite.prepare("INSERT INTO custom_field_options(id, field_id, value, sort_order) VALUES ('o1', 'f3', '低', 0)").run();
const insVal = sqlite.prepare("INSERT INTO custom_field_values(work_plan_id, field_id, text_value, number_value, text_sort_key) VALUES (?, ?, ?, ?, ?)");
insVal.run("p1", "f1", "甲", null, "0000甲");
insVal.run("p2", "f1", null, null, null); // 缺失值 → null_flag=1
insVal.run("p1", "f2", null, 3.5, null);
insVal.run("p2", "f3", "低", null, null);

console.log("=== index rows after inserts ===");
console.table(sqlite.prepare("SELECT * FROM custom_field_sort_index ORDER BY field_id, work_plan_id").all());

// 选项重排联动
sqlite.prepare("UPDATE custom_field_options SET sort_order = 5 WHERE id = 'o1'").run();
console.log("=== f3 rows after option reorder ===");
console.table(sqlite.prepare("SELECT * FROM custom_field_sort_index WHERE field_id = 'f3'").all());

// 计划改期联动
sqlite.prepare("UPDATE work_plans SET start_at = '2026-02-01T00:00:00Z', end_at = '2026-02-02T00:00:00Z' WHERE id = 'p1'").run();
console.log("=== tail sync after plan reschedule ===");
console.table(sqlite.prepare("SELECT work_plan_id, start_at, end_at FROM custom_field_sort_index WHERE field_id = 'f1'").all());

// EXPLAIN：快路径首页（无筛选，纯索引扫描）
const fastSql = `SELECT si.work_plan_id AS id, si.skey AS k0, si.start_at, si.end_at, si.created_at
FROM custom_field_sort_index si
WHERE si.field_id = @cf0
ORDER BY si.null_flag ASC, si.skey ASC, si.start_at ASC, si.end_at DESC, si.created_at ASC, si.work_plan_id ASC
LIMIT 101`;
console.log("=== EXPLAIN fast path (no filters) ===");
for (const row of sqlite.prepare(`EXPLAIN QUERY PLAN ${fastSql}`).all()) console.log(" ", row.detail);

// EXPLAIN：快路径带 wp JOIN 筛选
const fastFilteredSql = `SELECT si.work_plan_id AS id, si.skey AS k0
FROM custom_field_sort_index si
JOIN work_plans wp ON wp.id = si.work_plan_id
WHERE si.field_id = @cf0 AND wp.start_at > @rangeFrom
ORDER BY si.null_flag ASC, si.skey ASC, si.start_at ASC, si.end_at DESC, si.created_at ASC, si.work_plan_id ASC
LIMIT 101`;
console.log("=== EXPLAIN fast path (wp join + filter) ===");
for (const row of sqlite.prepare(`EXPLAIN QUERY PLAN ${fastFilteredSql}`).all()) console.log(" ", row.detail);

// EXPLAIN：DESC
const fastDescSql = fastSql.replace("si.skey ASC", "si.skey DESC").replace("cfsi", "");
console.log("=== EXPLAIN fast path DESC ===");
for (const row of sqlite.prepare(`EXPLAIN QUERY PLAN ${fastDescSql}`).all()) console.log(" ", row.detail);

// 快路径实际执行结果
console.log("=== fast path result (f1 asc) ===");
console.table(sqlite.prepare(fastSql).all({ cf0: "f1" }));

// 键集谓词（次页语义）：上一页末行 k0 = '0000甲' → 谓词 skey > ? OR skey IS NULL OR (= AND tail)
console.log("=== fast path page 2 via keyset ===");
const keyset = `SELECT si.work_plan_id AS id FROM custom_field_sort_index si
WHERE si.field_id = @cf0 AND ((si.skey > @c0) OR (si.skey IS NULL) OR (si.skey = @c0 AND (si.start_at > @c1)))
ORDER BY si.null_flag ASC, si.skey ASC, si.start_at ASC, si.end_at DESC, si.created_at ASC, si.work_plan_id ASC
LIMIT 101`;
console.table(sqlite.prepare(keyset).all({ cf0: "f1", c0: "0000甲", c1: "2026-01-02T00:00:00Z" }));

// 计划删除级联
sqlite.prepare("DELETE FROM work_plans WHERE id = 'p2'").run();
console.log("=== after plan delete (cascade) ===");
console.table(sqlite.prepare("SELECT field_id, work_plan_id FROM custom_field_sort_index").all());

// 原始路径 EXPLAIN（对照：TEMP B-TREE）
const legacySql = `SELECT wp.*, NULLIF(cfv.text_sort_key,'') AS k0 FROM work_plans wp
LEFT JOIN custom_field_values cfv ON cfv.work_plan_id = wp.id AND cfv.field_id = @cf0
ORDER BY (NULLIF(cfv.text_sort_key,'') IS NULL) ASC, NULLIF(cfv.text_sort_key,'') ASC, wp.start_at ASC, wp.end_at DESC, wp.created_at ASC, wp.id ASC
LIMIT 101`;
console.log("=== EXPLAIN legacy path (contrast) ===");
for (const row of sqlite.prepare(`EXPLAIN QUERY PLAN ${legacySql}`).all()) console.log(" ", row.detail);

console.log("\n原型验证完成");
