import type { DatabaseBundle } from "../db/index.js";
import { recomputeWorkPlanSortKeys } from "../db/sort-keys.js";
import { invalidInput } from "../errors.js";
import { nowIso } from "../utils.js";

const version1BusinessTables = [
  "work_plan_series",
  "work_plans",
  "custom_field_definitions",
  "custom_field_options",
  "custom_field_values",
  "custom_field_multi_values",
] as const;

const version2BusinessTables = [
  ...version1BusinessTables,
  "owner_account_mappings",
] as const;

const version3BusinessTables = [
  ...version2BusinessTables,
  "monthly_goals",
] as const;

const version4BusinessTables = [
  ...version2BusinessTables,
  "monthly_goal_series",
  "monthly_goals",
] as const;

const deleteOrder = [
  "monthly_goals",
  "monthly_goal_series",
  "custom_field_multi_values",
  "custom_field_values",
  "work_plans",
  "custom_field_options",
  "custom_field_definitions",
  "work_plan_series",
] as const;

export type ExportPayload = {
  schemaVersion: 4;
  exportedAt: string;
  data: Record<(typeof version4BusinessTables)[number], Array<Record<string, unknown>>>;
};

type ImportPayload = {
  schemaVersion: 1 | 2 | 3 | 4;
  exportedAt: string;
  data: Record<string, Array<Record<string, unknown>>>;
};

export class TransferService {
  constructor(private readonly database: DatabaseBundle) {}

  export(): ExportPayload {
    const data = {} as ExportPayload["data"];
    for (const table of version4BusinessTables) {
      data[table] = this.database.sqlite.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    }
    return { schemaVersion: 4, exportedAt: nowIso(), data };
  }

  validate(payload: unknown): { valid: true; counts: Record<string, number> } {
    const parsed = this.assertShape(payload);
    this.database.sqlite.exec("SAVEPOINT validate_import");
    try {
      this.replace(parsed);
      const counts = this.importCounts(parsed);
      this.database.sqlite.exec("ROLLBACK TO validate_import");
      this.database.sqlite.exec("RELEASE validate_import");
      return { valid: true, counts };
    } catch (error) {
      this.database.sqlite.exec("ROLLBACK TO validate_import");
      this.database.sqlite.exec("RELEASE validate_import");
      throw invalidInput(`导入文件校验失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  import(payload: unknown): { imported: true; counts: Record<string, number> } {
    const parsed = this.assertShape(payload);
    const execute = this.database.sqlite.transaction(() => this.replace(parsed));
    execute();
    return {
      imported: true,
      counts: this.importCounts(parsed),
    };
  }

  private assertShape(payload: unknown): ImportPayload {
    if (!payload || typeof payload !== "object") throw invalidInput("导入文件必须是 JSON 对象");
    const value = payload as Record<string, unknown>;
    if (![1, 2, 3, 4].includes(value.schemaVersion as number) || !value.data || typeof value.data !== "object") {
      throw invalidInput("不支持的导入文件版本");
    }
    const data = value.data as Record<string, unknown>;
    const tables = value.schemaVersion === 4 ? version4BusinessTables : value.schemaVersion === 3 ? version3BusinessTables : value.schemaVersion === 2 ? version2BusinessTables : version1BusinessTables;
    for (const table of tables) {
      if (!Array.isArray(data[table])) throw invalidInput(`导入文件缺少 ${table} 数据`);
      if ((data[table] as unknown[]).some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
        throw invalidInput(`${table} 中包含无效记录`);
      }
    }
    return value as unknown as ImportPayload;
  }

  private replace(payload: ImportPayload): void {
    if (payload.schemaVersion >= 2) this.database.sqlite.prepare("DELETE FROM owner_account_mappings").run();
    for (const table of deleteOrder) this.database.sqlite.prepare(`DELETE FROM ${table}`).run();
    const tables = payload.schemaVersion === 4 ? version4BusinessTables : payload.schemaVersion === 3 ? version3BusinessTables : payload.schemaVersion === 2 ? version2BusinessTables : version1BusinessTables;
    for (const table of tables) {
      const allowedColumns = new Set(
        (this.database.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
      );
      for (const rawRow of payload.data[table]!) {
        const normalizedRow = table === "work_plans" && !Object.hasOwn(rawRow, "status_mode")
          ? { ...rawRow, status_mode: rawRow.status === "cancelled" ? "manual" : "automatic" }
          : table === "monthly_goals" && payload.schemaVersion < 4
            ? Object.fromEntries(Object.entries(rawRow).filter(([key]) => key !== "series_id" && key !== "occurrence_key"))
            : rawRow;
        const entries = Object.entries(normalizedRow).filter(([key]) => allowedColumns.has(key));
        if (entries.length === 0) throw new Error(`${table} 包含空记录`);
        const columns = entries.map(([key]) => `"${key}"`).join(", ");
        const placeholders = entries.map(() => "?").join(", ");
        this.database.sqlite
          .prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`)
          .run(...entries.map(([, value]) => value));
      }
    }
    // 旧备份不含排序键列（允许列为过滤），恢复后全量重算（票据 08 方案 A）。
    recomputeWorkPlanSortKeys(this.database.sqlite);
  }

  private importCounts(payload: ImportPayload): Record<string, number> {
    const tables = payload.schemaVersion === 4 ? version4BusinessTables : payload.schemaVersion === 3 ? version3BusinessTables : payload.schemaVersion === 2 ? version2BusinessTables : version1BusinessTables;
    return Object.fromEntries(tables.map((table) => [table, payload.data[table]!.length]));
  }
}
