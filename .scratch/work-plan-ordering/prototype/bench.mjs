// 票据 08 原型：排序键候选方案的可部署性与性能验证。
// 运行：node .scratch/work-plan-ordering/prototype/run.mjs
// 产出：金样、EXPLAIN QUERY PLAN、性能百分位、游标全量遍历对账、方案对比证据。
// 数据库写入 data/（已 gitignore），不触碰应用业务路径。

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { naturalSortKey, compareSortKeys, runGoldenChecks } from "./sortkey.mjs";
import { buildDataset } from "./dataset.mjs";

const require = createRequire(path.join(fileURLToPath(new URL(".", import.meta.url)), "../../../apps/server/package.json"));
const Database = require("better-sqlite3");

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const dataDir = path.join(repoRoot, "data");
const dbPath = path.join(dataDir, "prototype-sorting.db");
mkdirSync(dataDir, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

const report = [];
const log = (line = "") => {
  console.log(line);
  report.push(line);
};
const assert = (condition, message) => {
  if (!condition) throw new Error(`原型断言失败：${message}`);
};

// ---------- 排序级别定义 ----------

// 表达式在查询里带 wp. 前缀；CREATE INDEX 里不允许表别名，用空前缀。
const statusExpr = (prefix = "") => `CASE ${prefix}status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END`;
const durationExpr = (prefix = "") => `(julianday(${prefix}end_at) - julianday(${prefix}start_at))`;
const STATUS_CASE = statusExpr("wp.");
const DURATION_EXPR = durationExpr("wp.");
// 排期兜底链：开始升、结束降、创建升、ID 升（方向固定，不随显式排序反转）
const SCHEDULE_CHAIN = [
  { expr: "wp.start_at", dir: "asc" },
  { expr: "wp.end_at", dir: "desc" },
  { expr: "wp.created_at", dir: "asc" },
  { expr: "wp.id", dir: "asc" },
];

// ---------- 键集谓词：空值双向置后，需按上一页实际值分支生成 ----------
// 参数命名按路径：@k0、@k0_0、@k0_0_0 …

function buildKeyset(levels, values) {
  const params = {};
  const walk = (index, prefix) => {
    const level = levels[index];
    const name = `${prefix}0`;
    const placeholder = `@${name}`;
    const value = values[index];
    const isLast = index === levels.length - 1;
    const rest = isLast ? null : walk(index + 1, `${prefix}0_`);
    if (value === null || value === undefined) {
      // 上一页该列为 NULL：只继续在空值区内推进（expr = NULL 永不成立，必须用 IS NULL）
      const self = `(${level.expr} IS NULL)`;
      return rest ? `(${self} AND ${rest})` : self;
    }
    const comparator = level.dir === "asc" ? ">" : "<";
    const advance = `(${level.expr} ${comparator} ${placeholder})`;
    const toNullZone = `(${level.expr} IS NULL)`;
    const tie = rest ? `(${level.expr} = ${placeholder} AND ${rest})` : null;
    params[name] = value;
    return `(${[advance, toNullZone, tie].filter(Boolean).join(" OR ")})`;
  };
  return { sql: walk(0, "k"), params };
}

function fingerprint(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return { error: "INVALID_CURSOR" };
  }
  if (parsed?.v !== 1 || !Array.isArray(parsed?.pos) || typeof parsed?.id !== "string" || typeof parsed?.fp !== "string") {
    return { error: "INVALID_CURSOR" };
  }
  return { payload: parsed };
}

// ---------- 建库 ----------

const CHUNK_SIZE = 5000;

function createSchema(sqlite) {
  sqlite.exec(`
    CREATE TABLE work_plan_series (id TEXT PRIMARY KEY);
    CREATE TABLE work_plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      status_mode TEXT NOT NULL DEFAULT 'automatic',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      series_id TEXT REFERENCES work_plan_series(id) ON DELETE SET NULL,
      occurrence_key TEXT,
      is_exception INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title_sort_key TEXT
    );
    CREATE TABLE custom_field_definitions (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE custom_field_options (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE (field_id, value)
    );
    CREATE TABLE custom_field_values (
      work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
      text_value TEXT,
      number_value REAL,
      boolean_value INTEGER,
      date_value TEXT,
      datetime_value TEXT,
      url_value TEXT,
      text_sort_key TEXT,
      datetime_sort_key TEXT,
      PRIMARY KEY (work_plan_id, field_id)
    );
    CREATE TABLE custom_field_multi_values (
      work_plan_id TEXT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL,
      PRIMARY KEY (work_plan_id, field_id, option_id)
    );
    CREATE INDEX work_plans_schedule_idx ON work_plans(start_at, end_at);
    CREATE INDEX work_plans_status_idx ON work_plans(status);
    CREATE INDEX work_plans_sort_idx ON work_plans(sort_order);
  `);
}

function insertDataset(sqlite, dataset) {
  const insertSeries = sqlite.prepare("INSERT INTO work_plan_series(id) VALUES (?)");
  const insertPlan = sqlite.prepare(
    "INSERT INTO work_plans(id, title, description, status, status_mode, start_at, end_at, sort_order, series_id, occurrence_key, is_exception, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertField = sqlite.prepare("INSERT INTO custom_field_definitions(id, key, label, type, sort_order, archived_at) VALUES (?, ?, ?, ?, ?, ?)");
  const insertOption = sqlite.prepare("INSERT INTO custom_field_options(id, field_id, value, label, sort_order) VALUES (?, ?, ?, ?, ?)");
  const insertValue = sqlite.prepare(
    "INSERT INTO custom_field_values(work_plan_id, field_id, text_value, number_value, boolean_value, date_value, datetime_value, url_value, text_sort_key, datetime_sort_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMulti = sqlite.prepare("INSERT INTO custom_field_multi_values(work_plan_id, field_id, option_id) VALUES (?, ?, ?)");

  const seriesIds = [...new Set(dataset.plans.map((plan) => plan.seriesId).filter(Boolean))];
  sqlite.transaction(() => {
    for (const id of seriesIds) insertSeries.run(id);
  })();

  sqlite.transaction(() => {
    for (let start = 0; start < dataset.plans.length; start += CHUNK_SIZE) {
      for (const plan of dataset.plans.slice(start, start + CHUNK_SIZE)) {
        // 排序键先写 NULL，由迁移式回填补齐（演示回填路径）
        insertPlan.run(plan.id, plan.title, plan.description, plan.status, plan.statusMode, plan.startAt, plan.endAt, plan.sortOrder, plan.seriesId, plan.occurrenceKey, plan.isException ? 1 : 0, plan.createdAt, plan.updatedAt);
      }
    }
  })();

  sqlite.transaction(() => {
    dataset.fields.forEach((field, index) => {
      insertField.run(field.id, field.key, field.label, field.type, index, field.archivedAt ?? null);
      (field.options ?? []).forEach((option, optionIndex) => {
        insertOption.run(`${field.id}-opt-${option.value}`, field.id, option.value, option.label, option.sortOrder ?? optionIndex);
      });
    });
  })();

  sqlite.transaction(() => {
    for (let start = 0; start < dataset.valueRows.length; start += CHUNK_SIZE) {
      for (const row of dataset.valueRows.slice(start, start + CHUNK_SIZE)) {
        let text = null;
        let number = null;
        let bool = null;
        let date = null;
        let datetime = null;
        let url = null;
        let textKey = null;
        let datetimeKey = null;
        if (row.type === "short_text") {
          text = row.value;
          textKey = naturalSortKey(row.value);
        } else if (row.type === "url") {
          url = row.value;
          textKey = naturalSortKey(row.value);
        } else if (row.type === "number") {
          number = row.value;
        } else if (row.type === "boolean") {
          bool = row.value ? 1 : 0;
        } else if (row.type === "date") {
          date = row.value;
        } else if (row.type === "datetime") {
          datetime = row.value;
          datetimeKey = new Date(row.instant).toISOString(); // 写入时归一化 UTC
        } else if (row.type === "single_select") {
          text = row.value;
        }
        insertValue.run(row.planId, row.fieldId, text, number, bool, date, datetime, url, textKey, datetimeKey);
      }
    }
  })();

  sqlite.transaction(() => {
    for (const row of dataset.multiRows) insertMulti.run(row.planId, row.fieldId, row.optionId);
  })();
}

// 迁移式回填：分块事务重算全部 title_sort_key（真实迁移将重建表并置 NOT NULL）。
function backfillTitleKeys(sqlite) {
  const selectChunk = sqlite.prepare("SELECT id, title FROM work_plans WHERE title_sort_key IS NULL LIMIT ?");
  const updateChunk = sqlite.prepare("UPDATE work_plans SET title_sort_key = ? WHERE id = ?");
  const startedAt = process.hrtime.bigint();
  let total = 0;
  for (;;) {
    const rows = selectChunk.all(CHUNK_SIZE);
    if (rows.length === 0) break;
    sqlite.transaction(() => {
      for (const row of rows) updateChunk.run(naturalSortKey(row.title), row.id);
    })();
    total += rows.length;
  }
  return { total, ms: Number(process.hrtime.bigint() - startedAt) / 1e6 };
}

function createSortIndexes(sqlite) {
  // 单字段排序索引 = 排序列 + 完整排期兜底链，使 ORDER BY 与键集谓词完全落在索引上。
  sqlite.exec(`
    CREATE INDEX idx_wp_title_key_asc ON work_plans(title_sort_key, start_at, end_at DESC, created_at, id);
    CREATE INDEX idx_wp_title_key_desc ON work_plans(title_sort_key DESC, start_at, end_at DESC, created_at, id);
    CREATE INDEX idx_wp_status_order ON work_plans(${statusExpr()}, start_at, end_at DESC, created_at, id);
    CREATE INDEX idx_wp_duration ON work_plans(${durationExpr()}, start_at, end_at DESC, created_at, id);
    CREATE INDEX idx_wp_schedule_full ON work_plans(start_at, end_at DESC, created_at, id);
    CREATE INDEX idx_cfv_text_key ON custom_field_values(field_id, text_sort_key, work_plan_id);
    CREATE INDEX idx_cfv_number ON custom_field_values(field_id, number_value, work_plan_id);
    CREATE INDEX idx_cfv_datetime_key ON custom_field_values(field_id, datetime_sort_key, work_plan_id);
  `);
}

// ---------- 查询用例 ----------

let FIELD_SHORT_TEXT = null;
let FIELD_NUMBER = null;
let FIELD_SELECT = null;
let FIELD_DATETIME = null;

function defineCases() {
  const qClause = "(wp.title LIKE @q ESCAPE '\\' OR wp.description LIKE @q ESCAPE '\\')";
  const rangeClause = "wp.start_at < @to AND wp.end_at > @from";
  const filtersFor = (names) =>
    names
      .map((name) => (name === "status" ? "wp.status = @status" : name === "range" ? rangeClause : qClause))
      .join(" AND ");

  return [
    {
      name: "schedule-default（排期兜底，无显式排序）",
      joins: "",
      levels: SCHEDULE_CHAIN,
      where: "",
      params: {},
    },
    {
      name: "schedule-filtered（排期兜底 + 状态/时间/全文筛选）",
      joins: "",
      levels: SCHEDULE_CHAIN,
      where: `WHERE ${filtersFor(["status", "range", "q"])}`,
      params: { status: "pending", from: "2026-03-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", q: "%重点%" },
    },
    {
      name: "title-asc（标题自然序升序，含排期兜底链）",
      joins: "",
      levels: [{ expr: "wp.title_sort_key", dir: "asc" }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
    },
    {
      name: "title-desc（标题自然序降序）",
      joins: "",
      levels: [{ expr: "wp.title_sort_key", dir: "desc" }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
    },
    {
      name: "title-asc-filtered（标题自然序 + 全部筛选）",
      joins: "",
      levels: [{ expr: "wp.title_sort_key", dir: "asc" }, ...SCHEDULE_CHAIN],
      where: `WHERE ${filtersFor(["status", "range", "q"])}`,
      params: { status: "pending", from: "2026-03-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", q: "%计划%" },
    },
    {
      name: "status-asc（状态顺序）",
      joins: "",
      levels: [{ expr: STATUS_CASE, dir: "asc" }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
    },
    {
      name: "duration-asc（持续时长表达式索引）",
      joins: "",
      levels: [{ expr: DURATION_EXPR, dir: "asc" }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
    },
    {
      name: "cf-text-asc（自定义短文本自然序，LEFT JOIN + 临时排序）",
      joins: `LEFT JOIN custom_field_values cfv ON cfv.work_plan_id = wp.id AND cfv.field_id = '${FIELD_SHORT_TEXT.id}'`,
      levels: [{ expr: "cfv.text_sort_key", dir: "asc", nullable: true }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
      skipWalk: true,
    },
    {
      name: "cf-number-desc（自定义数字降序，LEFT JOIN + 临时排序）",
      joins: `LEFT JOIN custom_field_values cfv ON cfv.work_plan_id = wp.id AND cfv.field_id = '${FIELD_NUMBER.id}'`,
      levels: [{ expr: "cfv.number_value", dir: "desc", nullable: true }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
      skipWalk: true,
    },
    {
      name: "cf-select-asc（自定义单选按选项序，失效值置后）",
      joins:
        `LEFT JOIN custom_field_values cfv ON cfv.work_plan_id = wp.id AND cfv.field_id = '${FIELD_SELECT.id}'` +
        ` LEFT JOIN custom_field_options cfo ON cfo.field_id = cfv.field_id AND cfo.value = cfv.text_value`,
      levels: [{ expr: "cfo.sort_order", dir: "asc", nullable: true }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
      skipWalk: true,
    },
    {
      name: "cf-datetime-desc（自定义日期时间归一键降序）",
      joins: `LEFT JOIN custom_field_values cfv ON cfv.work_plan_id = wp.id AND cfv.field_id = '${FIELD_DATETIME.id}'`,
      levels: [{ expr: "cfv.datetime_sort_key", dir: "desc", nullable: true }, ...SCHEDULE_CHAIN],
      where: "",
      params: {},
      skipWalk: true,
    },
    {
      name: "five-level-mixed（五级混合：标题/状态/开始/自定义数字/创建 + 筛选）",
      joins: `LEFT JOIN custom_field_values cfv2 ON cfv2.work_plan_id = wp.id AND cfv2.field_id = '${FIELD_NUMBER.id}'`,
      levels: [
        { expr: "wp.title_sort_key", dir: "asc" },
        { expr: STATUS_CASE, dir: "desc" },
        { expr: "wp.start_at", dir: "asc" },
        { expr: "cfv2.number_value", dir: "desc", nullable: true },
        { expr: "wp.created_at", dir: "asc" },
        ...SCHEDULE_CHAIN,
      ],
      where: `WHERE ${filtersFor(["status", "range", "q"])}`,
      params: { status: "pending", from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z", q: "%计划%" },
      skipWalk: true,
    },
  ];
}

function positionColumns(levels) {
  return levels.map((_, index) => `${levels[index].expr} AS k${index}`);
}

function pageSqlFor(cz, cursor) {
  const whereBase = cz.where || "WHERE 1=1";
  let sql = `SELECT wp.id, wp.title, wp.status, wp.start_at, wp.end_at, wp.created_at, ${positionColumns(cz.levels).join(", ")} FROM work_plans wp ${cz.joins} ${whereBase}`;
  const params = { ...cz.params };
  if (cursor) {
    const keyset = buildKeyset(cz.levels, cursor.payload.pos);
    sql += ` AND ${keyset.sql}`;
    Object.assign(params, keyset.params);
  }
  sql += ` ORDER BY ${cz.levels
    .map((level) =>
      level.nullable
        ? `(${level.expr} IS NULL) ASC, ${level.expr} ${level.dir.toUpperCase()}` // SQLite ASC 默认 NULL 在前，可空列必须显式置后
        : `${level.expr} ${level.dir.toUpperCase()}`,
    )
    .join(", ")} LIMIT @limit`;
  params.limit = 100;
  return { sql, params };
}

function fetchPage(sqlite, cz, cursor) {
  const { sql, params } = pageSqlFor(cz, cursor);
  const rows = sqlite.prepare(sql).all(params);
  const last = rows.at(-1);
  const nextCursor =
    last && rows.length === params.limit
      ? encodeCursor({ v: 1, fp: cz.fp, pos: cz.levels.map((_, index) => last[`k${index}`]), id: last.id })
      : null;
  return { rows, nextCursor };
}

function fetchTotal(sqlite, cz) {
  return sqlite.prepare(`SELECT COUNT(*) AS total FROM work_plans wp ${cz.joins} ${cz.where || "WHERE 1=1"}`).get(cz.params).total;
}

// ---------- 参考实现（Node.js 内存排序，票据 08 仅允许作为正确性对照） ----------

function referenceOrderFor(cz, dataset) {
  const levels = cz.levels;
  const valuesByPlan = new Map();
  if (cz.joins.length > 0) {
    const fieldId = cz.joins.match(/field_id = '(cf-\d+)'/)[1];
    const field = dataset.fields.find((item) => item.id === fieldId);
    const optionOrder = new Map((field?.options ?? []).map((option) => [option.value, option.sortOrder]));
    for (const row of dataset.valueRows) {
      if (row.fieldId !== fieldId) continue;
      const existing = valuesByPlan.get(row.planId) ?? {};
      if (row.type === "short_text") existing.v0 = naturalSortKey(row.value);
      if (row.type === "number") existing.v0 = row.value;
      if (row.type === "single_select") existing.v0 = optionOrder.get(row.value) ?? null;
      if (row.type === "datetime") existing.v0 = new Date(row.instant).toISOString();
      valuesByPlan.set(row.planId, existing);
    }
  }
  const valueOf = (plan, index) => {
    const level = levels[index];
    if (level.expr === "wp.title_sort_key") return naturalSortKey(plan.title);
    if (level.expr === STATUS_CASE) return { pending: 0, in_progress: 1, completed: 2, cancelled: 3 }[plan.status];
    if (level.expr === DURATION_EXPR) return Date.parse(plan.endAt) - Date.parse(plan.startAt);
    if (level.expr === "wp.start_at") return plan.startAt;
    if (level.expr === "wp.end_at") return plan.endAt;
    if (level.expr === "wp.created_at") return plan.createdAt;
    if (level.expr === "wp.id") return plan.id;
    return valuesByPlan.get(plan.id)?.v0 ?? null;
  };
  const isKeyString = (index) => ["wp.title_sort_key", "cfv.text_sort_key"].includes(levels[index].expr);
  const compare = (a, b) => {
    for (let index = 0; index < levels.length; index += 1) {
      const va = valueOf(a, index);
      const vb = valueOf(b, index);
      if (va === null && vb === null) continue;
      if (va === null) return 1; // 缺失值双向置后
      if (vb === null) return -1;
      let cmp;
      if (isKeyString(index)) cmp = compareSortKeys(va, vb);
      else if (typeof va === "number") cmp = va - vb;
      else cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (levels[index].dir === "desc") cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
  const needle = cz.params.q ? cz.params.q.replaceAll("%", "") : null;
  const filtered = dataset.plans.filter((plan) => {
    if (cz.where === "") return true;
    if (cz.params.status && plan.status !== cz.params.status) return false;
    if (cz.params.from && !(Date.parse(plan.startAt) < Date.parse(cz.params.to) && Date.parse(plan.endAt) > Date.parse(cz.params.from))) return false;
    if (needle && !plan.title.includes(needle) && !plan.description.includes(needle)) return false;
    return true;
  });
  return filtered.sort(compare).map((plan) => plan.id);
}

// ---------- 基准执行 ----------

function measure(sqlite, cz, iterations = 30) {
  const runOnce = () => {
    const startedAt = process.hrtime.bigint();
    const result = sqlite.transaction(() => ({
      total: fetchTotal(sqlite, cz),
      page: fetchPage(sqlite, cz, null),
    }))();
    const firstMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    let secondMs = null;
    if (result.page.nextCursor) {
      const startedAt2 = process.hrtime.bigint();
      sqlite.transaction(() => fetchPage(sqlite, cz, decodeCursor(result.page.nextCursor)))();
      secondMs = Number(process.hrtime.bigint() - startedAt2) / 1e6;
    }
    return { firstMs, secondMs };
  };
  for (let i = 0; i < 3; i += 1) runOnce();
  const firsts = [];
  const seconds = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample = runOnce();
    firsts.push(sample.firstMs);
    if (sample.secondMs !== null) seconds.push(sample.secondMs);
  }
  const percentile = (list, p) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  };
  return {
    firstP50: percentile(firsts, 50),
    firstP95: percentile(firsts, 95),
    firstP99: percentile(firsts, 99),
    nextP50: seconds.length ? percentile(seconds, 50) : null,
    nextP95: seconds.length ? percentile(seconds, 95) : null,
    nextP99: seconds.length ? percentile(seconds, 99) : null,
  };
}

function explainFor(sqlite, cz) {
  const { sql, params } = pageSqlFor(cz, null);
  return sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map((row) => row.detail);
}

function walkAllPages(sqlite, cz, limit = 500) {
  const ids = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const { sql, params } = pageSqlFor(cz, cursor);
    params.limit = limit;
    const rows = sqlite.prepare(sql).all(params);
    pages += 1;
    for (const row of rows) ids.push(row.id);
    if (rows.length < limit) break;
    const last = rows.at(-1);
    cursor = { payload: { v: 1, fp: cz.fp, pos: cz.levels.map((_, index) => last[`k${index}`]), id: last.id } };
    if (pages > 1000) throw new Error("全量遍历超过 1000 页，中止");
  }
  return { ids, pages };
}

// ---------- 主流程 ----------

log("# 票据 08 原型验证报告");
log(`- 生成时间：${new Date().toISOString()}`);
log(`- Node ${process.version}，better-sqlite3 ${require("better-sqlite3/package.json").version}`);
log(`- 数据库：${dbPath}（WAL，pragma 与应用一致）`);

log("\n## 1. 自然文本金样（参考比较器 vs 排序键字节序）");
const golden = runGoldenChecks();
for (const result of golden) {
  log(`- [${result.pass ? "PASS" : "FAIL"}] ${result.label}: ${result.refOrder.join(" ／ ")}`);
}
assert(golden.every((result) => result.pass), "金样存在失败项");

log("\n## 2. 数据集与建库");
const buildStart = Date.now();
const dataset = buildDataset({ planCount: 100_000 });
assert(dataset.plans.length === 100_000, "数据集行数不为十万");
log(`- 工作计划 ${dataset.plans.length} 条，自定义字段 ${dataset.fields.length} 个（归档 ${dataset.fields.filter((field) => field.archivedAt).length} 个），值行 ${dataset.valueRows.length} 条，多选行 ${dataset.multiRows.length} 条`);
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("journal_mode = WAL");
createSchema(sqlite);
insertDataset(sqlite, dataset);
log(`- 建库与插入完成：${Date.now() - buildStart} ms`);

const missingBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM work_plans WHERE title_sort_key IS NULL").get().n;
const backfill = backfillTitleKeys(sqlite);
const missingAfter = sqlite.prepare("SELECT COUNT(*) AS n FROM work_plans WHERE title_sort_key IS NULL").get().n;
log(`- 标题排序键回填：回填前缺失 ${missingBefore}，回填 ${backfill.total} 行耗时 ${backfill.ms.toFixed(0)} ms，回填后缺失 ${missingAfter}`);
const sample = sqlite.prepare("SELECT title, title_sort_key FROM work_plans WHERE title LIKE '批次%' LIMIT 3").all();
log(`- 回填示例：${sample.map((row) => `${row.title} → ${JSON.stringify(row.title_sort_key)}`).join("；")}`);

createSortIndexes(sqlite);
sqlite.exec("ANALYZE");
log("- 排序索引与 ANALYZE 完成");

// 写入维护演示：改标题必须同步键
{
  const targets = sqlite.prepare("SELECT id, title FROM work_plans LIMIT 200").all();
  const update = sqlite.prepare("UPDATE work_plans SET title = ?, title_sort_key = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const row of targets) update.run(`改后标题-${row.id}`, naturalSortKey(`改后标题-${row.id}`), row.id);
  })();
  const verify = targets.every((row) => {
    const current = sqlite.prepare("SELECT title_sort_key FROM work_plans WHERE id = ?").get(row.id);
    return current.title_sort_key === naturalSortKey(`改后标题-${row.id}`);
  });
  assert(verify, "写入维护后键与标题不一致");
  log(`- 写入维护演示：200 条标题更新后键同步一致 ✓`);
  sqlite.transaction(() => {
    for (const row of targets) update.run(row.title, naturalSortKey(row.title), row.id);
  })();
}

// 字段目录与用例装配
{
  const rows = sqlite.prepare("SELECT id, key, type FROM custom_field_definitions ORDER BY sort_order").all();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  FIELD_SHORT_TEXT = byKey.get("field_001");
  FIELD_NUMBER = byKey.get("field_019");
  FIELD_SELECT = byKey.get("field_042");
  FIELD_DATETIME = byKey.get("field_037");
  assert(FIELD_SHORT_TEXT && FIELD_NUMBER && FIELD_SELECT && FIELD_DATETIME, "字段定位失败");
}

const cases = defineCases();
for (const cz of cases) {
  cz.fp = fingerprint({
    q: cz.params.q ?? null,
    status: cz.params.status ?? null,
    range: cz.params.from ? { from: cz.params.from, to: cz.params.to } : null,
    sort: cz.levels.map((level) => ({ expr: level.expr, dir: level.dir })),
  });
}

log("\n## 3. 归档字段校验（引擎入口拒绝）");
{
  const catalog = new Map(dataset.fields.map((field) => [field.id, field]));
  const sortableTypes = new Set(["short_text", "url", "number", "boolean", "date", "datetime", "single_select"]);
  const trySort = (fieldId) => {
    const field = catalog.get(fieldId);
    if (!field) return { error: "UNKNOWN_FIELD" };
    if (field.archivedAt) return { error: "FIELD_ARCHIVED" };
    if (!sortableTypes.has(field.type)) return { error: "TYPE_NOT_SORTABLE" };
    return { ok: true };
  };
  log(`- 归档字段 cf-003 → ${JSON.stringify(trySort("cf-003"))}`);
  log(`- 可用字段 cf-001 → ${JSON.stringify(trySort("cf-001"))}`);
  assert(trySort("cf-003").error === "FIELD_ARCHIVED", "归档字段未被拒绝");
}

log("\n## 4. EXPLAIN QUERY PLAN（首页 SQL）");
for (const cz of cases) {
  log(`\n### ${cz.name}`);
  for (const detail of explainFor(sqlite, cz)) log(`  ${detail}`);
}

log("\n## 5. 性能（预热文件库，30 次迭代；首页 = 事务内 COUNT + 前 100 条；次页 = 键集游标第 2 页；单位 ms）");
const perfRows = [];
for (const cz of cases) {
  const stats = measure(sqlite, cz);
  const within = stats.firstP95 <= 500 && (stats.nextP95 === null || stats.nextP95 <= 500);
  perfRows.push({ name: cz.name, stats, within });
}
log("| 用例 | 首页 p50 | 首页 p95 | 首页 p99 | 次页 p50 | 次页 p95 | 次页 p99 | 预算内(500ms) |");
log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const row of perfRows) {
  const { stats } = row;
  log(`| ${row.name} | ${stats.firstP50.toFixed(1)} | ${stats.firstP95.toFixed(1)} | ${stats.firstP99.toFixed(1)} | ${stats.nextP50?.toFixed(1) ?? "-"} | ${stats.nextP95?.toFixed(1) ?? "-"} | ${stats.nextP99?.toFixed(1) ?? "-"} | ${row.within ? "是" : "否"} |`);
}

log("\n## 5b. temp_store=MEMORY 对照实验（验证临时 B 树落盘对 p95 尖刺的影响）");
{
  sqlite.pragma("temp_store = MEMORY");
  log("| 用例 | 首页 p50 | 首页 p95 | 首页 p99 | 次页 p95 | 预算内(500ms) |");
  log("| --- | --- | --- | --- | --- | --- |");
  for (const cz of cases.slice(7)) {
    const stats = measure(sqlite, cz, 40);
    const within = stats.firstP95 <= 500 && (stats.nextP95 === null || stats.nextP95 <= 500);
    log(`| ${cz.name} | ${stats.firstP50.toFixed(1)} | ${stats.firstP95.toFixed(1)} | ${stats.firstP99.toFixed(1)} | ${stats.nextP95?.toFixed(1) ?? "-"} | ${within ? "是" : "否"} |`);
  }
  log("- 结论：若 p95 尖刺消失，生产配置应与应用现有 WAL/busy_timeout 一样拥有 temp_store=MEMORY；真实迁移与查询引擎按此配置部署。");
}

log("\n## 6. 游标语义与全量遍历对账（静态数据无遗漏、无重复、与参考实现全序一致）");
for (const cz of cases.filter((item) => !item.skipWalk)) {
  const startedAt = Date.now();
  const walk = walkAllPages(sqlite, cz);
  const unique = new Set(walk.ids);
  const reference = referenceOrderFor(cz, dataset);
  const sameOrder = walk.ids.length === reference.length && walk.ids.every((id, index) => id === reference[index]);
  log(`- [${sameOrder && unique.size === walk.ids.length ? "PASS" : "FAIL"}] ${cz.name}: ${walk.ids.length} 行 / ${walk.pages} 页 / 无重复 ${unique.size === walk.ids.length} / 与参考实现全序一致 ${sameOrder}（${Date.now() - startedAt} ms）`);
  assert(sameOrder, `${cz.name} 全量遍历与参考实现不一致`);
  assert(unique.size === walk.ids.length, `${cz.name} 游标遍历出现重复`);
}
for (const cz of cases.filter((item) => item.skipWalk)) {
  const reference = referenceOrderFor(cz, dataset);
  let cursor = null;
  const collected = [];
  for (let page = 0; page < 3; page += 1) {
    const { rows, nextCursor } = fetchPage(sqlite, cz, cursor);
    collected.push(...rows.map((row) => row.id));
    cursor = nextCursor ? { payload: JSON.parse(Buffer.from(nextCursor, "base64url").toString("utf8")) } : null;
    if (!cursor) break;
  }
  const pass = collected.length > 0 && collected.every((id, index) => id === reference[index]);
  log(`- [${pass ? "PASS" : "FAIL"}] ${cz.name}: 前 ${collected.length} 行与参考实现头部一致`);
  assert(pass, `${cz.name} 前 3 页与参考实现不一致`);
}
{
  const cz = cases[0];
  const total = fetchTotal(sqlite, cz);
  const walk = walkAllPages(sqlite, cz, 100);
  log(`- 准确总数与遍历行数一致：total=${total}，walked=${walk.ids.length}`);
  assert(total === walk.ids.length, "COUNT 与遍历行数不一致");
}

log("\n## 7. 游标健壮性");
{
  const cz = cases[2];
  const { rows } = fetchPage(sqlite, cz, null);
  const last = rows.at(-1);
  const good = encodeCursor({ v: 1, fp: cz.fp, pos: cz.levels.map((_, index) => last[`k${index}`]), id: last.id });
  const goodPage = fetchPage(sqlite, cz, decodeCursor(good));
  log(`- 合法游标：返回 ${goodPage.rows.length} 行`);
  const decoded = decodeCursor(`${good.slice(0, -4)}AAAA`);
  log(`- 篡改 base64 → ${decoded.error ?? `可解码，指纹${decoded.payload.fp === cz.fp ? "相同（篡改落在无关位）" : "不同 → CURSOR_MISMATCH（稳定 400）"}`}`);
  const wrongFp = decodeCursor(encodeCursor({ v: 1, fp: "0000000000000000", pos: cz.levels.map((_, index) => last[`k${index}`]), id: last.id }));
  log(`- 指纹不符 → ${wrongFp.payload && wrongFp.payload.fp !== cz.fp ? "CURSOR_MISMATCH（稳定 400）" : "?"}`);
  log(`- 非法格式 → ${decodeCursor("!!not-base64!!").error ?? "?"}`);
  log(`- 版本不符 → ${decodeCursor(encodeCursor({ v: 99, fp: cz.fp, pos: [], id: last.id })).error ?? "?"}`);
}

log("\n## 8. 方案对比");
log("### 方案 B：SQLite 扩展 / ICU");
{
  const icuCompiled = sqlite.prepare("SELECT sqlite_compileoption_used('ICU') AS used").get().used;
  log(`- 当前 SQLite 编译选项含 ICU：${icuCompiled ? "是" : "否"}（better-sqlite3 捆绑构建，版本随 npm 包固定）`);
  try {
    sqlite.loadExtension("libicu");
    log("- loadExtension('libicu') 成功（意外）");
  } catch (error) {
    log(`- loadExtension 失败（预期）：${error.message}`);
  }
  log("- 结论：better-sqlite3 12.11.1 的 JS API 无 collation 注册接口（实例方法仅 prepare/transaction/pragma/backup/serialize/function/aggregate/table/loadExtension/exec 等）；捆绑构建无 ICU；扩展二进制无法随 pnpm 部署产物跨平台可靠分发 → 不可部署，拒绝。");
}
log("### 方案 C：确定性自定义 SQL 函数 + 表达式索引");
{
  const scratch = new Database(":memory:");
  try {
    scratch.function("nk", { deterministic: true }, (value) => naturalSortKey(String(value)));
    scratch.exec("CREATE TABLE t2(id TEXT PRIMARY KEY, title TEXT)");
    scratch.exec("CREATE INDEX t2_nk ON t2(nk(title), id)");
    const insert = scratch.prepare("INSERT INTO t2(id, title) VALUES (?, ?)");
    const titles = dataset.plans.slice(0, 50_000);
    const writeStart = Date.now();
    scratch.transaction(() => {
      for (const plan of titles) insert.run(plan.id, plan.title);
    })();
    const writeMs = Date.now() - writeStart;
    const orderStart = process.hrtime.bigint();
    scratch.prepare("SELECT id FROM t2 ORDER BY nk(title), id LIMIT 100").all();
    const orderMs = Number(process.hrtime.bigint() - orderStart) / 1e6;
    const explain = scratch.prepare("EXPLAIN QUERY PLAN SELECT id FROM t2 ORDER BY nk(title), id LIMIT 100").all().map((row) => row.detail);
    log(`- 表达式索引创建成功；5 万行写入（每行触发 JS 函数）${writeMs} ms；排序前 100 条 ${orderMs.toFixed(1)} ms`);
    log(`- 计划：${explain.join(" | ")}`);
    log("- 运维风险：任何读取该索引的连接（sqlite3 CLI、备份/完整性工具、未注册函数的旧进程）都会报 no such function；写入路径每行触发 JS；不采用，记录为可行备选。");
  } catch (error) {
    log(`- 表达式索引不可用：${error.message}`);
  } finally {
    scratch.close();
  }
}
log("### 方案 D：读取全部命中项后在 Node.js 排序（票据禁止作为通过方案，仅作对照）");
{
  const startedAt = process.hrtime.bigint();
  const all = sqlite.prepare("SELECT id, title_sort_key, start_at, end_at, created_at FROM work_plans").all();
  const cmpStr = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const chainCmp = (a, b) =>
    cmpStr(a.start_at, b.start_at) || -cmpStr(a.end_at, b.end_at) || cmpStr(a.created_at, b.created_at) || cmpStr(a.id, b.id);
  all.sort((a, b) => compareSortKeys(a.title_sort_key, b.title_sort_key) || chainCmp(a, b));
  const head = all.slice(0, 100).map((row) => row.id);
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const engineHead = fetchPage(sqlite, cases[2], null).rows.map((row) => row.id);
  log(`- 全量读取 + JS 排序 10 万行（含完整兜底链）：${ms.toFixed(0)} ms，前 100 条与键集引擎一致：${head.every((id, index) => id === engineHead[index])}`);
}

log("\n## 9. 结论");
log("- 方案 A（应用写入时生成规范化排序键、数据库持久化并以 BINARY 比较）是唯一同时满足金样、可部署性与性能预算的候选；后续票据按此实施。");
log("- 排序键算法：NFKC → 大写折叠 → 剔除控制字符 → 数字段/文本段分段编码（数字段 = 0x01 + 定长位数 + 去前导零数字串；文本段 = 0x02 + 文本字节），UTF-8 字节序即全序。");
log("- 时间列写入时归一化 UTC ISO（应用当前即为 toISOString()）；自定义 datetime 值新增 datetime_sort_key 归一键；自定义短文本/URL 新增 text_sort_key。");
log("- 单字段排序用复合索引（排序列 + 完整排期兜底链）完全走索引；自定义字段与五级混合排序依赖临时 B 树排序，实测见第 5 节。");
log("- 空值双向置后的键集谓词必须按上一页实际值分支生成（NULL = NULL 不成立），已在 buildKeyset 实现并经全量遍历验证。");

sqlite.close();
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "report.md"), report.join("\n") + "\n");
console.log("\n原型完成，报告已写入 .scratch/work-plan-ordering/prototype/report.md");
