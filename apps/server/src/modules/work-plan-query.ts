import { createHash } from "node:crypto";
import type {
  CustomFieldDefinition,
  OwnerConflict,
  WorkPlan,
  WorkPlanFilter,
  WorkPlanQueryErrorCode,
  WorkPlanQueryRequest,
  WorkPlanSortBuiltinField,
  WorkPlanSortItem,
  WorkPlanStatus,
  WorkPlanStatusMode,
} from "@workplan/contracts";
import {
  deriveWorkPlanStatus,
  naturalSortKey,
  normalizeDateTimeForSort,
  workPlanSortBuiltinFields,
} from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { cursorInvalid, cursorMismatch, invalidInput, sortFieldError } from "../errors.js";
import { nowIso } from "../utils.js";
import type { MonthlyGoalService } from "./monthly-goals.js";
import type { OwnerAccountService } from "./owner-accounts.js";
import type { CustomFieldService } from "./custom-fields.js";

export type WorkPlanRow = {
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

export type WorkPlanQueryResult = {
  items: WorkPlan[];
  total: number;
  evaluatedAt: string;
  nextCursor: string | null;
};

// 排序级别：expr 为 wp./别名限定的 SQL 表达式；identity 用于链去重；numeric 决定游标位 JSON 类型。
type SortLevel = {
  identity: string;
  expr: string;
  dir: "asc" | "desc";
  nullable: boolean;
  numeric: boolean;
};

type CustomRef = { alias: string; optionsAlias: string | null };

// 状态排序与展示一致：自动状态按求值时刻派生，手动状态用存量；统一映射为整数序（待开始→进行中→已完成→已取消）。
const STATUS_CASE =
  "CASE WHEN wp.status_mode = 'manual' THEN CASE wp.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END WHEN julianday(wp.start_at) > julianday(@now) THEN 0 WHEN julianday(wp.end_at) <= julianday(@now) THEN 2 ELSE 1 END";
const DURATION_EXPR = "(julianday(wp.end_at) - julianday(wp.start_at))";

const CURSOR_VERSION = 1;
const SORT_UNSUPPORTED_TYPES = new Set(["long_text", "multi_select"]);

// 排期兜底链：开始升、结束降、创建升、ID 升；方向固定，不随显式排序反转。
const SCHEDULE_CHAIN: Array<{ field: WorkPlanSortBuiltinField | "id"; dir: "asc" | "desc" }> = [
  { field: "startAt", dir: "asc" },
  { field: "endAt", dir: "desc" },
  { field: "createdAt", dir: "asc" },
  { field: "id", dir: "asc" },
];

function builtinLevelExpr(field: WorkPlanSortBuiltinField | "id"): { identity: string; expr: string; nullable: boolean; numeric: boolean } {
  switch (field) {
    case "title":
      return { identity: "wp.title_sort_key", expr: "wp.title_sort_key", nullable: false, numeric: false };
    case "status":
      return { identity: "wp.status#order", expr: STATUS_CASE, nullable: false, numeric: true };
    case "startAt":
      return { identity: "wp.start_at", expr: "wp.start_at", nullable: false, numeric: false };
    case "endAt":
      return { identity: "wp.end_at", expr: "wp.end_at", nullable: false, numeric: false };
    case "duration":
      return { identity: "wp.duration", expr: DURATION_EXPR, nullable: false, numeric: true };
    case "createdAt":
      return { identity: "wp.created_at", expr: "wp.created_at", nullable: false, numeric: false };
    case "updatedAt":
      return { identity: "wp.updated_at", expr: "wp.updated_at", nullable: false, numeric: false };
    case "id":
      return { identity: "wp.id", expr: "wp.id", nullable: false, numeric: false };
  }
}

// 稳定 JSON 序列化（键排序），用于查询指纹。
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function queryFingerprint(request: WorkPlanQueryRequest): string {
  const canonical = {
    v: CURSOR_VERSION,
    q: request.q ?? null,
    filters: request.filters,
    range: { from: request.range.from ?? null, to: request.range.to ?? null },
    sort: request.sort,
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex").slice(0, 16);
}

function encodeCursor(fingerprint: string, positions: unknown[], lastId: string): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, fp: fingerprint, pos: positions, id: lastId }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { v: number; fp: string; pos: unknown[]; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw cursorInvalid();
  }
  const payload = parsed as { v?: unknown; fp?: unknown; pos?: unknown; id?: unknown };
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.v !== CURSOR_VERSION ||
    typeof payload.fp !== "string" ||
    !Array.isArray(payload.pos) ||
    typeof payload.id !== "string" ||
    payload.pos.some((item) => !(item === null || typeof item === "string" || typeof item === "number"))
  ) {
    throw cursorInvalid();
  }
  return payload as { v: number; fp: string; pos: unknown[]; id: string };
}

// 键集谓词：空值双向置后。上一页该列为 NULL 时，`expr = @p` 永不成立，
// 必须改用 `expr IS NULL` 在空值区内推进；非空位置可经 `expr IS NULL` 直接跳入空值区。
function buildKeyset(levels: SortLevel[], values: unknown[], params: Record<string, unknown>): string {
  const walk = (index: number, prefix: string): string => {
    const level = levels[index];
    if (!level) throw new Error("键集谓词级别越界");
    const name = `${prefix}0`;
    const placeholder = `@${name}`;
    const value = values[index];
    const isLast = index === levels.length - 1;
    const rest = isLast ? null : walk(index + 1, `${prefix}0_`);
    if (value === null || value === undefined) {
      const self = `(${level.expr} IS NULL)`;
      return rest ? `(${self} AND ${rest})` : self;
    }
    params[name] = value;
    const comparator = level.dir === "asc" ? ">" : "<";
    const advance = `(${level.expr} ${comparator} ${placeholder})`;
    const toNullZone = `(${level.expr} IS NULL)`;
    const tie = rest ? `(${level.expr} = ${placeholder} AND ${rest})` : null;
    return `(${[advance, toNullZone, tie].filter(Boolean).join(" OR ")})`;
  };
  return walk(0, "c");
}

export class WorkPlanQueryEngine {
  constructor(
    readonly database: DatabaseBundle,
    readonly customFields: CustomFieldService,
    readonly ownerAccounts: OwnerAccountService,
    readonly monthlyGoals: MonthlyGoalService,
  ) {}

  // 统一查询入口：/query、旧 list/search 适配器、导出与工作台共用。
  // options.offset 仅限旧兼容适配器使用；/query 路由不传，保持纯游标语义。
  query(request: WorkPlanQueryRequest, options: { offset?: number } = {}): WorkPlanQueryResult {
    return this.queryAt(request, nowIso(), options);
  }

  // 显式求值时刻版本：工作台三区块等场景要求多个查询共享同一求值时刻。
  queryAt(request: WorkPlanQueryRequest, evaluatedAt: string, options: { offset?: number } = {}): WorkPlanQueryResult {
    const now = Date.parse(evaluatedAt);
    const catalog = new Map(this.customFields.list(true).map((field) => [field.key, field]));

    const joins: string[] = [];
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    params.now = evaluatedAt;
    const customRefs = new Map<string, CustomRef>();

    if (request.q) {
      const pattern = `%${request.q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(wp.title LIKE @q ESCAPE '\\' OR wp.description LIKE @q ESCAPE '\\')");
      params.q = pattern;
    }

    for (const [index, filter] of request.filters.entries()) {
      const compiled = this.compileFilter(filter, catalog, customRefs, joins, params, index);
      if (compiled) where.push(compiled);
    }

    if (request.range.from) {
      where.push("wp.end_at > @rangeFrom");
      params.rangeFrom = request.range.from;
    }
    if (request.range.to) {
      where.push("wp.start_at < @rangeTo");
      params.rangeTo = request.range.to;
    }

    const levels = this.resolveSortLevels(request.sort, catalog, customRefs, joins, params);

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const joinSql = joins.length > 0 ? joins.join(" ") : "";
    // 无筛选引用 JOIN 别名时，纯 1:1 LEFT JOIN 不改变行数——计数省去 JOIN 与排序输入。
    const joinsReferencedByWhere = joins.length > 0 && /\b(cfv\d|cfo\d)\b/.test(whereSql);
    const countJoinSql = joinsReferencedByWhere ? joinSql : "";
    const keysetPredicate = this.buildCursorPredicate(request, levels, params, options.offset === undefined);
    // 总数按完整过滤集合计数（不含游标）；分页在过滤之上追加键集谓词。
    const pageConditions = keysetPredicate ? [...where, keysetPredicate] : where;
    const countWhereSql = whereSql;
    const pageWhereSql = pageConditions.length > 0 ? `WHERE ${pageConditions.join(" AND ")}` : "";
    const orderSql = levels
      .map((level) => (level.nullable ? `(${level.expr} IS NULL) ASC, ${level.expr} ${level.dir.toUpperCase()}` : `${level.expr} ${level.dir.toUpperCase()}`))
      .join(", ");
    const positionSelect = levels.map((level, index) => `${level.expr} AS k${index}`).join(", ");

    const runInReadTransaction = this.database.sqlite.transaction(() => {
      const total = this.database.sqlite
        .prepare(`SELECT COUNT(*) AS total FROM work_plans wp ${countJoinSql} ${countWhereSql}`)
        .get(params) as { total: number };

      const limitClause = "LIMIT @limit";
      const offsetClause = options.offset !== undefined ? " OFFSET @offset" : "";
      const pageParams: Record<string, unknown> = { ...params, limit: request.limit + (options.offset === undefined ? 1 : 0) };
      if (options.offset !== undefined) pageParams.offset = options.offset;
      const rows = this.database.sqlite
        .prepare(`SELECT wp.*, ${positionSelect} FROM work_plans wp ${joinSql} ${pageWhereSql} ORDER BY ${orderSql} ${limitClause}${offsetClause}`)
        .all(pageParams) as Array<WorkPlanRow & Record<string, unknown>>;

      return { total: total.total, rows };
    });

    const { total, rows } = runInReadTransaction();

    // 多取一行判定是否存在下一页，保证末页 nextCursor 恰为 null。
    const hasNext = options.offset === undefined ? rows.length > request.limit : false;
    const pageRows = hasNext ? rows.slice(0, request.limit) : rows;
    const items = this.serializeRows(pageRows, now);
    const lastRow = pageRows.at(-1);
    const nextCursor =
      hasNext && lastRow
        ? encodeCursor(
            queryFingerprint(request),
            levels.map((level, index) => lastRow[`k${index}`]),
            lastRow.id,
          )
        : null;

    return { items, total, evaluatedAt, nextCursor };
  }

  private buildCursorPredicate(request: WorkPlanQueryRequest, levels: SortLevel[], params: Record<string, unknown>, cursorMode: boolean): string | null {
    if (!cursorMode || !request.cursor) return null;
    const decoded = decodeCursor(request.cursor);
    const fingerprint = queryFingerprint(request);
    if (decoded.fp !== fingerprint) throw cursorMismatch();
    if (decoded.pos.length !== levels.length) throw cursorInvalid();
    return buildKeyset(levels, decoded.pos, params);
  }

  // 解析零至五项显式排序 + 排期兜底链；同一列只保留首次出现（显式方向优先，链内同级为空操作）。
  private resolveSortLevels(
    sort: WorkPlanSortItem[],
    catalog: Map<string, CustomFieldDefinition>,
    customRefs: Map<string, CustomRef>,
    joins: string[],
    params: Record<string, unknown>,
  ): SortLevel[] {
    if (new Set(sort.map((item) => item.field)).size !== sort.length) {
      throw sortFieldError("SORT_FIELD_DUPLICATED" satisfies WorkPlanQueryErrorCode, "排序字段重复");
    }
    const seen = new Set<string>();
    const levels: SortLevel[] = [];
    const push = (level: SortLevel) => {
      if (seen.has(level.identity)) return;
      seen.add(level.identity);
      levels.push(level);
    };

    for (const item of sort) {
      if (item.field.startsWith("custom.")) {
        const key = item.field.slice("custom.".length);
        const definition = catalog.get(key);
        if (!definition) throw sortFieldError("SORT_FIELD_INVALID" satisfies WorkPlanQueryErrorCode, `未知排序字段：${item.field}`);
        if (definition.archivedAt || SORT_UNSUPPORTED_TYPES.has(definition.type)) {
          throw sortFieldError("SORT_FIELD_UNSUPPORTED" satisfies WorkPlanQueryErrorCode, `字段不支持排序：${item.field}`);
        }
        push(this.customSortLevel(definition, item.direction, customRefs, joins, params));
      } else if ((workPlanSortBuiltinFields as readonly string[]).includes(item.field)) {
        const base = builtinLevelExpr(item.field as WorkPlanSortBuiltinField);
        push({ ...base, dir: item.direction });
      } else {
        throw sortFieldError("SORT_FIELD_INVALID" satisfies WorkPlanQueryErrorCode, `非法排序字段：${item.field}`);
      }
    }

    for (const entry of SCHEDULE_CHAIN) {
      const base = builtinLevelExpr(entry.field);
      push({ ...base, dir: entry.dir });
    }
    return levels;
  }

  private customRefFor(definition: CustomFieldDefinition, customRefs: Map<string, CustomRef>, joins: string[], params: Record<string, unknown>): CustomRef {
    const existing = customRefs.get(definition.id);
    if (existing) return existing;
    const alias = `cfv${customRefs.size}`;
    params[`cf${customRefs.size}`] = definition.id;
    joins.push(`LEFT JOIN custom_field_values ${alias} ON ${alias}.work_plan_id = wp.id AND ${alias}.field_id = @cf${customRefs.size}`);
    const ref: CustomRef = { alias, optionsAlias: null };
    if (definition.type === "single_select") {
      const optionsAlias = `cfo${customRefs.size}`;
      ref.optionsAlias = optionsAlias;
      joins.push(
        `LEFT JOIN custom_field_options ${optionsAlias} ON ${optionsAlias}.field_id = ${alias}.field_id AND ${optionsAlias}.value = ${alias}.text_value`,
      );
    }
    customRefs.set(definition.id, ref);
    return ref;
  }

  private customSortLevel(
    definition: CustomFieldDefinition,
    dir: "asc" | "desc",
    customRefs: Map<string, CustomRef>,
    joins: string[],
    params: Record<string, unknown>,
  ): SortLevel {
    const ref = this.customRefFor(definition, customRefs, joins, params);
    switch (definition.type) {
      case "short_text":
      case "url":
        // 空白文本视为缺失值：NULLIF 让空串进入空值区（写入侧同时归一化为 NULL）
        return { identity: `custom:${definition.id}:text_key`, expr: `NULLIF(${ref.alias}.text_sort_key, '')`, dir, nullable: true, numeric: false };
      case "number":
        return { identity: `custom:${definition.id}:number`, expr: `${ref.alias}.number_value`, dir, nullable: true, numeric: true };
      case "boolean":
        return { identity: `custom:${definition.id}:boolean`, expr: `${ref.alias}.boolean_value`, dir, nullable: true, numeric: true };
      case "date":
        return { identity: `custom:${definition.id}:date`, expr: `${ref.alias}.date_value`, dir, nullable: true, numeric: false };
      case "datetime":
        return { identity: `custom:${definition.id}:datetime_key`, expr: `${ref.alias}.datetime_sort_key`, dir, nullable: true, numeric: false };
      case "single_select":
        return {
          identity: `custom:${definition.id}:option_order`,
          expr: `${ref.optionsAlias}.sort_order`,
          dir,
          nullable: true,
          numeric: true,
        };
      default:
        throw sortFieldError("SORT_FIELD_UNSUPPORTED" satisfies WorkPlanQueryErrorCode, `字段不支持排序：custom.${definition.key}`);
    }
  }

  // 筛选编译：沿用既有业务能力（相等/区间/包含/多选），内置字段与自定义字段统一到 SQL。
  private compileFilter(
    filter: WorkPlanFilter,
    catalog: Map<string, CustomFieldDefinition>,
    customRefs: Map<string, CustomRef>,
    joins: string[],
    params: Record<string, unknown>,
    index: number,
  ): string | null {
    const name = (suffix: string) => `f${index}_${suffix}`;
    const bind = (value: unknown) => {
      const key = name(String(Object.keys(params).length));
      params[key] = value;
      return `@${key}`;
    };
    if (filter.field.startsWith("custom.")) {
      const key = filter.field.slice("custom.".length);
      const definition = catalog.get(key);
      if (!definition) throw invalidInput(`未知筛选字段：${filter.field}`);
      if (definition.type === "multi_select") {
        // 多选值存于 custom_field_multi_values，与 custom_field_values 行无关，直接按字段 ID 绑定
        if (filter.op !== "any" && filter.op !== "all") throw invalidInput(`多选字段仅支持 any/all 筛选：${filter.field}`);
        const expected = Array.isArray(filter.value) ? filter.value : [filter.value];
        const fieldParam = `fm${index}`;
        params[fieldParam] = definition.id;
        const clauses = expected.map((value, valueIndex) => {
          const option = definition.options.find((item) => item.value === value);
          if (!option) throw invalidInput(`多选字段包含未知选项：${filter.field}`);
          const optionParam = `fmv${index}_${valueIndex}`;
          params[optionParam] = option.id;
          return `EXISTS (SELECT 1 FROM custom_field_multi_values mv WHERE mv.work_plan_id = wp.id AND mv.field_id = @${fieldParam} AND mv.option_id = @${optionParam})`;
        });
        // any = 命中任一选项（OR）；all = 每个选项都命中（AND）
        return clauses.join(filter.op === "any" ? " OR " : " AND ");
      }
      const ref = this.customRefFor(definition, customRefs, joins, params);
      return this.compileValueFilter(definition, ref, filter, bind);
    }

    const builtin = this.builtinFilterColumn(filter.field);
    if (builtin.kind === "enum" && filter.op !== "eq" && filter.op !== "neq") {
      throw invalidInput(`筛选字段不支持 ${filter.op}：${filter.field}`);
    }
    const column = builtin.column;
    const placeholder = bind(this.coerceFilterValue(builtin.kind, filter.value, filter.op));
    switch (filter.op) {
      case "eq":
        return `${column} = ${placeholder}`;
      case "neq":
        return `(${column} <> ${placeholder} OR ${column} IS NULL)`;
      case "contains":
        return `${column} LIKE ${placeholder} ESCAPE '\\'`;
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return `${column} ${OPERATOR_SQL[filter.op]} ${placeholder}`;
      case "between": {
        if (!Array.isArray(filter.value) || filter.value.length !== 2) throw invalidInput(`between 筛选需要二元数组：${filter.field}`);
        const lower = bind(this.coerceFilterValue(builtin.kind, filter.value[0], filter.op));
        const upper = bind(this.coerceFilterValue(builtin.kind, filter.value[1], filter.op));
        return `(${column} >= ${lower} AND ${column} <= ${upper})`;
      }
      case "any": {
        if (!Array.isArray(filter.value)) throw invalidInput(`any 筛选需要数组：${filter.field}`);
        const placeholders = filter.value.map((item) => bind(item)).join(", ");
        return `${column} IN (${placeholders})`;
      }
      default:
        throw invalidInput(`筛选字段不支持 ${filter.op}：${filter.field}`);
    }
  }

  private builtinFilterColumn(field: string): { column: string; kind: "text" | "enum" | "datetime" | "boolean" | "number" } {
    switch (field) {
      case "title":
        return { column: "wp.title", kind: "text" };
      case "description":
        return { column: "wp.description", kind: "text" };
      case "status":
        return { column: STATUS_CASE_WITH_NOW, kind: "enum" };
      case "statusMode":
        return { column: "wp.status_mode", kind: "enum" };
      case "startAt":
        return { column: "wp.start_at", kind: "datetime" };
      case "endAt":
        return { column: "wp.end_at", kind: "datetime" };
      case "createdAt":
        return { column: "wp.created_at", kind: "datetime" };
      case "updatedAt":
        return { column: "wp.updated_at", kind: "datetime" };
      case "seriesId":
        return { column: "wp.series_id", kind: "text" };
      case "occurrenceKey":
        return { column: "wp.occurrence_key", kind: "text" };
      case "isException":
        return { column: "wp.is_exception", kind: "boolean" };
      default:
        throw invalidInput(`未知筛选字段：${field}`);
    }
  }

  private compileValueFilter(
    definition: CustomFieldDefinition,
    ref: CustomRef,
    filter: WorkPlanFilter,
    bind: (value: unknown) => string,
  ): string | null {
    const columnFor = (kind: "text" | "number" | "boolean" | "date" | "datetimeKey" | "optionOrder"): string => {
      switch (kind) {
        case "text":
          return definition.type === "url" ? `${ref.alias}.url_value` : `${ref.alias}.text_value`;
        case "number":
          return `${ref.alias}.number_value`;
        case "boolean":
          return `${ref.alias}.boolean_value`;
        case "date":
          return `${ref.alias}.date_value`;
        case "datetimeKey":
          return `${ref.alias}.datetime_sort_key`;
        case "optionOrder":
          return `${ref.optionsAlias}.sort_order`;
      }
    };

    const kind =
      definition.type === "number"
        ? "number"
        : definition.type === "boolean"
          ? "boolean"
          : definition.type === "date"
            ? "date"
            : definition.type === "datetime"
              ? "datetimeKey"
              : "text"; // short_text / long_text / url / single_select 都比较 text_value（url 实际列为 url_value）
    const column = columnFor(kind);
    const coerce = (value: unknown) => {
      if (kind === "datetimeKey") {
        const normalized = typeof value === "string" ? normalizeDateTimeForSort(value) : null;
        if (normalized === null) throw invalidInput(`日期时间筛选值无效：custom.${definition.key}`);
        return normalized;
      }
      if (kind === "number") {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) throw invalidInput(`数字筛选值无效：custom.${definition.key}`);
        return numeric;
      }
      if (kind === "boolean") return value ? 1 : 0;
      return value;
    };

    switch (filter.op) {
      case "eq":
        return `${column} = ${bind(coerce(filter.value))}`;
      case "neq":
        return `(${column} <> ${bind(coerce(filter.value))} OR ${column} IS NULL)`;
      case "contains":
        return `${column} LIKE ${bind(`%${String(filter.value ?? "").replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\'`;
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return `${column} ${OPERATOR_SQL[filter.op]} ${bind(coerce(filter.value))}`;
      case "between": {
        if (!Array.isArray(filter.value) || filter.value.length !== 2) throw invalidInput(`between 筛选需要二元数组：custom.${definition.key}`);
        const lower = bind(coerce(filter.value[0]));
        const upper = bind(coerce(filter.value[1]));
        return `(${column} >= ${lower} AND ${column} <= ${upper})`;
      }
      default:
        throw invalidInput(`筛选字段不支持 ${filter.op}：custom.${definition.key}`);
    }
  }

  private coerceFilterValue(kind: "text" | "enum" | "datetime" | "boolean" | "number", value: unknown, op: string): unknown {
    if (kind === "datetime") {
      if (op === "contains") return value;
      if (typeof value !== "string" || normalizeDateTimeForSort(value) === null) throw invalidInput("时间筛选值必须是可解析的 ISO 时间");
      return normalizeDateTimeForSort(value as string);
    }
    if (kind === "boolean") return value ? 1 : 0;
    if (kind === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw invalidInput("数字筛选值无效");
      return numeric;
    }
    return value;
  }

  serializeRows(
    rows: Array<WorkPlanRow & Record<string, unknown>>,
    now: number,
    conflictsById: ReadonlyMap<string, OwnerConflict> = new Map(),
  ): WorkPlan[] {
    const ownerAccountByValue = this.ownerAccounts.indexByOwnerValue();
    const goalIdsByWorkPlan = this.monthlyGoals.indexGoalIdsByWorkPlan(rows.map((row) => row.id));
    return rows.map((row) => this.serializeRow(row, now, ownerAccountByValue, goalIdsByWorkPlan.get(row.id) ?? [], conflictsById));
  }

  private serializeRow(
    row: WorkPlanRow,
    now: number,
    ownerAccountByValue: ReadonlyMap<string, string>,
    monthlyGoalIds: string[],
    conflictsById: ReadonlyMap<string, OwnerConflict>,
  ): WorkPlan {
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
      version: row.version,
      seriesId: row.series_id,
      occurrenceKey: row.occurrence_key,
      isException: Boolean(row.is_exception),
      customFields,
      monthlyGoalIds,
      ownerAccount: ownerValue ? ownerAccountByValue.get(ownerValue) ?? null : null,
      ownerConflict: conflictsById.get(row.id) ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

const OPERATOR_SQL = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
const STATUS_CASE_WITH_NOW =
  "CASE WHEN wp.status_mode = 'manual' THEN wp.status WHEN julianday(wp.start_at) > julianday(@now) THEN 'pending' WHEN julianday(wp.end_at) <= julianday(@now) THEN 'completed' ELSE 'in_progress' END";
