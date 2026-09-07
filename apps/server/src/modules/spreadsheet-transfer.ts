import * as XLSX from "xlsx";
import type { CreateWorkPlan, CustomFieldDefinition, ExportTemplate, ExportTemplateColumn, ExportWorkPlansQuery, WorkPlan, WorkPlanQueryRequest, WorkPlanStatus } from "@workplan/contracts";
import type { WorkPlanQueryEngine } from "./work-plan-query.js";
import type { DatabaseBundle } from "../db/index.js";
import { invalidInput, notFound, versionConflict } from "../errors.js";
import { newId, nowIso, parseJson } from "../utils.js";
import type { CustomFieldService } from "./custom-fields.js";
import type { WorkPlanService } from "./work-plans.js";
import { ZipWriter, columnLetters, escapeXmlAttribute, escapeXmlText } from "./xlsx-stream.js";

type TemplateRow = {
  id: string;
  name: string;
  sheet_name: string;
  columns_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};

const defaultColumns: ExportTemplateColumn[] = [
  { source: "title", header: "工作内容" },
  { source: "status", header: "状态" },
  { source: "startAt", header: "开始时间" },
  { source: "endAt", header: "结束时间" },
];
const statusLabels: Record<WorkPlanStatus, string> = {
  pending: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
const statusesByLabel = new Map<string, WorkPlanStatus>(Object.entries(statusLabels).map(([value, label]) => [label, value as WorkPlanStatus]));

/** 导出文件名时间戳：本地时间的 YYYYMMDD-HHmmss，避免同一天多次导出时文件名冲突。 */
function formatFileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizeExportDateTime(value: string): number {
  const date = new Date(value);
  date.setSeconds(0, 0);
  const excelEpoch = Date.UTC(1899, 11, 31);
  const calendarDays = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - excelEpoch) / 86_400_000);
  const excelLeapYearBugOffset = calendarDays >= 60 ? 1 : 0;
  const dayFraction = (date.getHours() * 3_600 + date.getMinutes() * 60) / 86_400;
  return calendarDays + excelLeapYearBugOffset + dayFraction;
}

export class SpreadsheetTransferService {
  constructor(
    private readonly database: DatabaseBundle,
    private readonly customFields: CustomFieldService,
    private readonly workPlans: WorkPlanService,
    private readonly queryEngine: WorkPlanQueryEngine,
  ) {}

  // 旧扁平查询参数 → 统一查询描述（兼容 GET 模板导出与旧调用方）。
  private toEngineQuery(query: { q?: string; status?: WorkPlanStatus; from?: string; to?: string; sort?: ExportWorkPlansQuery["sort"] }): ExportWorkPlansQuery {
    const filters: ExportWorkPlansQuery["filters"] = [];
    if (query.status) filters.push({ field: "status", op: "eq", value: query.status });
    const request: ExportWorkPlansQuery = {
      filters,
      range: { from: query.from, to: query.to },
      sort: query.sort ?? [],
    };
    if (query.q) request.q = query.q;
    return request;
  }

  listTemplates(ensureDefault = true): ExportTemplate[] {
    if (ensureDefault) this.ensureDefaultTemplate();
    return (this.database.sqlite.prepare("SELECT * FROM export_templates ORDER BY created_at").all() as TemplateRow[]).map((row) => this.serializeTemplate(row));
  }

  getTemplate(id: string): ExportTemplate {
    this.ensureDefaultTemplate();
    const row = this.database.sqlite.prepare("SELECT * FROM export_templates WHERE id = ?").get(id) as TemplateRow | undefined;
    if (!row) throw notFound("导出模板不存在");
    return this.serializeTemplate(row);
  }

  createTemplate(input: { name: string; sheetName: string; columns: ExportTemplateColumn[] }): ExportTemplate {
    this.validateColumns(input.columns);
    const id = newId();
    const timestamp = nowIso();
    this.database.sqlite
      .prepare("INSERT INTO export_templates(id, name, sheet_name, columns_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .run(id, input.name, input.sheetName, JSON.stringify(input.columns), timestamp, timestamp);
    return this.getTemplate(id);
  }

  updateTemplate(id: string, input: { name?: string | undefined; sheetName?: string | undefined; columns?: ExportTemplateColumn[] | undefined; version: number }): ExportTemplate {
    const current = this.getTemplate(id);
    const columns = input.columns ?? current.columns;
    this.validateColumns(columns);
    const result = this.database.sqlite
      .prepare("UPDATE export_templates SET name = ?, sheet_name = ?, columns_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(input.name ?? current.name, input.sheetName ?? current.sheetName, JSON.stringify(columns), nowIso(), id, input.version);
    if (result.changes === 0) throw versionConflict();
    return this.getTemplate(id);
  }

  deleteTemplate(id: string, version: number): void {
    const result = this.database.sqlite.prepare("DELETE FROM export_templates WHERE id = ? AND version = ?").run(id, version);
    if (result.changes === 0) {
      const exists = this.database.sqlite.prepare("SELECT id FROM export_templates WHERE id = ?").get(id);
      if (!exists) throw notFound("导出模板不存在");
      throw versionConflict();
    }
  }

  exportXls(templateId: string, query: { q?: string; status?: WorkPlanStatus; from?: string; to?: string; sort?: ExportWorkPlansQuery["sort"] }): Promise<{ fileName: string; data: Buffer }> {
    return this.buildXls(this.getTemplate(templateId), this.toEngineQuery(query));
  }

  // query 为统一查询描述；旧扁平 q/status/from/to 在兼容期由 toEngineQuery 转换。
  exportXlsCustom(
    input: { columns: ExportTemplateColumn[]; sheetName: string; name?: string },
    query: ExportWorkPlansQuery | { q?: string; status?: WorkPlanStatus; from?: string; to?: string },
  ): Promise<{ fileName: string; data: Buffer }> {
    this.validateColumns(input.columns);
    const engineQuery: ExportWorkPlansQuery = "filters" in query && Array.isArray(query.filters)
      ? query
      : this.toEngineQuery(query as { q?: string; status?: WorkPlanStatus; from?: string; to?: string });
    return this.buildXls({ name: input.name ?? "导出", sheetName: input.sheetName, columns: input.columns }, engineQuery);
  }

  // 流式 xlsx 写路径（票据 19）：单读事务内按键集游标分页推进全部命中行，行 XML 增量
  // 送入 deflate 流式压缩的 zip（data descriptor），任一时刻仅持有当前页与压缩输出，
  // 不再以 SheetJS 对象存储整表（十万行 × 25 列曾达峰值 RSS ~750MiB，超 512MiB 预算）。
  // 数据库扫描全程同步、无事件循环让步点（审查 P1）：事务不得横跨 await 持有共享连接，
  // 否则并发写会被并入导出事务、异常时被连带回滚；压缩由 libuv 线程池并发消化。
  // 单元格语义与旧输出一致：日期列为 Excel 序列数 + yyyy-mm-dd hh:mm 数字格式，
  // 文本为内联字符串，空值省略单元格（读回等价于空串）。
  private async buildXls(
    template: { name: string; sheetName: string; columns: ExportTemplateColumn[] },
    query: ExportWorkPlansQuery,
  ): Promise<{ fileName: string; data: Buffer }> {
    const fields = new Map(this.customFields.list(true).map((field) => [field.key, field]));
    const columns = template.columns;
    const columnRefs = columns.map((_, index) => columnLetters(index));
    const isDateColumn = columns.map((column) => column.source === "startAt" || column.source === "endAt");
    const lastColumnRef = columnRefs[Math.max(0, columns.length - 1)]!;
    const columnWidthsXml = columns
      .map((column, index) => {
        const width = Math.min(42, Math.max(12, column.header.length * 2 + 4));
        const ref = index + 1;
        return `<col min="${ref}" max="${ref}" width="${width}" customWidth="1"/>`;
      })
      .join("");

    const serializeCell = (value: unknown, columnIndex: number, rowNumber: number): string => {
      if (value === null || value === undefined || value === "") return "";
      const ref = ` r="${columnRefs[columnIndex]}${rowNumber}"`;
      const style = isDateColumn[columnIndex] ? ' s="1"' : "";
      if (typeof value === "number" && Number.isFinite(value)) return `<c${ref}${style}><v>${value}</v></c>`;
      return `<c${ref} t="inlineStr"><is><t>${escapeXmlText(String(value))}</t></is></c>`;
    };

    const zip = new ZipWriter();
    zip.addStored(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    );
    zip.addStored(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.addStored(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXmlAttribute(template.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.addStored(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    );
    zip.addStored(
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    );

    const sink = zip.beginDeflated("xl/worksheets/sheet1.xml");
    try {
      this.scanIntoSink(template, query, fields, { serializeCell, columnWidthsXml, lastColumnRef, write: (chunk) => sink.write(chunk) });
    } catch (error) {
      sink.abort();
      throw error;
    }
    await sink.finish();
    const data = zip.finish();
    const safeName = template.name.replace(/[\\/:*?"<>|]/g, "-");
    return { fileName: `${safeName}-${formatFileTimestamp(new Date())}.xlsx`, data };
  }

  // 工作表内容扫描：表头 + 分页行 + 收尾（autoFilter 需要总行数，只能在扫描结束后产出）。
  // 整个扫描处于一个读事务（BEGIN…COMMIT；引擎内层事务自动降级为 SAVEPOINT），
  // 且必须保持同步——任何 await 都会让出事件循环，破坏单连接上的事务独占。
  private scanIntoSink(
    template: { columns: ExportTemplateColumn[] },
    query: ExportWorkPlansQuery,
    fields: Map<string, CustomFieldDefinition>,
    layout: {
      serializeCell: (value: unknown, columnIndex: number, rowNumber: number) => string;
      columnWidthsXml: string;
      lastColumnRef: string;
      write: (chunk: Buffer) => void;
    },
  ): void {
    const sqlite = this.database.sqlite;
    sqlite.exec("BEGIN");
    try {
      layout.write(
        Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${layout.columnWidthsXml}</cols><sheetData>`,
          "utf8",
        ),
      );
      const headerCells = template.columns.map((column, index) => layout.serializeCell(column.header, index, 1)).join("");
      layout.write(Buffer.from(`<row r="1">${headerCells}</row>`, "utf8"));

      let rowCount = 0;
      let cursor: string | null = null;
      for (;;) {
        // 统一引擎在单个读事务内从头读取全部命中项：按键集游标分页推进，
        // 不受旧 500/10,000/100,000 条上限约束，也不接受页面 cursor/offset。
        const request: WorkPlanQueryRequest = { ...query, limit: 1_000 };
        if (cursor) request.cursor = cursor;
        const page = this.queryEngine.query(request);
        if (cursor && page.items.length === 0) break; // 传入游标首页为空说明已到末页
        const rowsXml = page.items
          .map((plan, index) => {
            const rowNumber = rowCount + index + 2;
            const cells = template.columns.map((column, columnIndex) => layout.serializeCell(this.exportValue(plan, column, fields), columnIndex, rowNumber)).join("");
            return `<row r="${rowNumber}">${cells}</row>`;
          })
          .join("");
        rowCount += page.items.length;
        if (rowsXml) layout.write(Buffer.from(rowsXml, "utf8"));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      layout.write(Buffer.from(`</sheetData><autoFilter ref="A1:${layout.lastColumnRef}${rowCount + 1}"/></worksheet>`, "utf8"));
      sqlite.exec("COMMIT");
    } catch (error) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // COMMIT 后才发生的异常无事务可回滚，忽略并保留原始错误
      }
      throw error;
    }
  }

  importXls(templateId: string, fileData: Buffer): { imported: number } {
    const template = this.getTemplate(templateId);
    const requiredSources = ["title", "startAt", "endAt"];
    for (const source of requiredSources) {
      if (!template.columns.some((column) => column.source === source)) throw invalidInput(`用于导入的模板必须包含“${defaultColumns.find((column) => column.source === source)!.header}”`);
    }
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(fileData, { type: "buffer", cellDates: true });
    } catch {
      throw invalidInput("无法读取 XLS 文件");
    }
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) throw invalidInput("XLS 文件不包含工作表");
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const headerRow = matrix[0]?.map((value) => String(value ?? "").trim()) ?? [];
    const indexByHeader = new Map(headerRow.map((header, index) => [header, index]));
    for (const column of template.columns) if (!indexByHeader.has(column.header)) throw invalidInput(`XLS 缺少模板列“${column.header}”`);
    const fields = new Map(this.customFields.list(false).map((field) => [field.key, field]));
    const dataRows = matrix.slice(1).filter((row) => row.some((value) => value !== null && String(value).trim() !== ""));
    if (dataRows.length === 0) throw invalidInput("XLS 中没有可导入的数据");
    if (dataRows.length > 5_000) throw invalidInput("单次最多导入 5000 条工作计划");

    const execute = this.database.sqlite.transaction(() => {
      dataRows.forEach((row, index) => {
        try {
          this.workPlans.create(this.importRow(row, template, indexByHeader, fields));
        } catch (error) {
          throw invalidInput(`第 ${index + 2} 行：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    });
    execute();
    return { imported: dataRows.length };
  }

  private importRow(row: unknown[], template: ExportTemplate, indexByHeader: Map<string, number>, fields: Map<string, CustomFieldDefinition>): CreateWorkPlan {
    const values = new Map(template.columns.map((column) => [column.source, row[indexByHeader.get(column.header)!]]));
    const title = String(values.get("title") ?? "").trim();
    if (!title) throw new Error("标题不能为空");
    const statusText = String(values.get("status") ?? "").trim();
    // 状态与日期/选项同样严格：未知文本报错（行级 422），而不是静默落成"待开始"
    let status: WorkPlanStatus | undefined;
    if (statusText) {
      const mapped = statusesByLabel.get(statusText)
        ?? (Object.hasOwn(statusLabels, statusText) ? statusText as WorkPlanStatus : undefined);
      if (!mapped) throw new Error(`未知状态：“${statusText}”`);
      status = mapped;
    }
    const customFields: Record<string, unknown> = {};
    for (const column of template.columns) {
      if (!column.source.startsWith("custom:")) continue;
      const key = column.source.slice("custom:".length);
      const field = fields.get(key);
      const raw = values.get(column.source);
      if (!field || raw == null || String(raw).trim() === "") continue;
      customFields[key] = this.importCustomValue(raw, field);
    }
    return {
      title,
      description: String(values.get("description") ?? "").trim(),
      ...(status ? { status, statusMode: "manual" as const } : { statusMode: "automatic" as const }),
      startAt: this.parseDateTime(values.get("startAt"), "开始时间"),
      endAt: this.parseDateTime(values.get("endAt"), "结束时间"),
      customFields,
    };
  }

  private exportValue(plan: WorkPlan, column: ExportTemplateColumn, fields: Map<string, CustomFieldDefinition>): unknown {
    if (column.source === "title") return plan.title;
    if (column.source === "description") return plan.description;
    if (column.source === "status") return statusLabels[plan.status];
    if (column.source === "startAt" || column.source === "endAt") return normalizeExportDateTime(plan[column.source]);
    if (column.source === "ownerAccount") return plan.ownerAccount ?? "";
    const key = column.source.slice("custom:".length);
    const value = plan.customFields[key];
    const field = fields.get(key);
    if (value == null || !field) return "";
    if (field.type === "boolean") return value ? "是" : "否";
    if (["single_select", "multi_select"].includes(field.type)) {
      const values = Array.isArray(value) ? value : [value];
      return values.map((item) => field.options.find((option) => option.value === item)?.label ?? String(item)).join("、");
    }
    return value;
  }

  private importCustomValue(raw: unknown, field: CustomFieldDefinition): unknown {
    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`“${field.label}”必须是数字`);
      return value;
    }
    if (field.type === "boolean") {
      const value = String(raw).trim().toLocaleLowerCase();
      if (["是", "true", "1", "yes"].includes(value)) return true;
      if (["否", "false", "0", "no"].includes(value)) return false;
      throw new Error(`“${field.label}”必须填写是或否`);
    }
    if (field.type === "date") return this.parseDateTime(raw, field.label).slice(0, 10);
    if (field.type === "datetime") return this.parseDateTime(raw, field.label);
    if (field.type === "single_select") return this.resolveOption(String(raw).trim(), field);
    if (field.type === "multi_select") return String(raw).split(/[、,，;；]/).map((value) => this.resolveOption(value.trim(), field)).filter(Boolean);
    return String(raw).trim();
  }

  private resolveOption(value: string, field: CustomFieldDefinition): string {
    const option = field.options.find((item) => !item.archivedAt && (item.value === value || item.label === value));
    if (!option) throw new Error(`“${field.label}”包含未知选项“${value}”`);
    return option.value;
  }

  private parseDateTime(raw: unknown, label: string): string {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
    if (typeof raw === "number") {
      const parsed = XLSX.SSF.parse_date_code(raw);
      if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))).toISOString();
    }
    const value = String(raw ?? "").trim();
    if (!value) throw new Error(`${label}不能为空`);
    const normalized = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value)
      ? `${value.replaceAll("/", "-").replace(" ", "T")}${value.includes(":") ? "+08:00" : "T00:00:00+08:00"}`
      : value;
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) throw new Error(`${label}格式无效`);
    return new Date(timestamp).toISOString();
  }

  private validateColumns(columns: ExportTemplateColumn[]): void {
    const activeFields = new Set(this.customFields.list(false).map((field) => field.key));
    const headers = new Set<string>();
    for (const column of columns) {
      if (headers.has(column.header)) throw invalidInput(`模板列标题不能重复：“${column.header}”`);
      headers.add(column.header);
      if (column.source.startsWith("custom:") && !activeFields.has(column.source.slice("custom:".length))) {
        throw invalidInput(`模板包含不存在或已归档的自定义字段：${column.source.slice("custom:".length)}`);
      }
    }
  }

  private ensureDefaultTemplate(): void {
    const count = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM export_templates").get() as { count: number };
    if (count.count > 0) return;
    const timestamp = nowIso();
    this.database.sqlite
      .prepare("INSERT INTO export_templates(id, name, sheet_name, columns_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .run(newId(), "标准工作计划", "工作计划", JSON.stringify(defaultColumns), timestamp, timestamp);
  }

  private serializeTemplate(row: TemplateRow): ExportTemplate {
    return {
      id: row.id,
      name: row.name,
      sheetName: row.sheet_name,
      columns: parseJson<ExportTemplateColumn[]>(row.columns_json, []),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
