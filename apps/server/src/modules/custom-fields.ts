import type { CustomFieldDefinition, CustomFieldType } from "@workplan/contracts";
import type { DatabaseBundle } from "../db/index.js";
import { naturalSortKey, normalizeDateTimeForSort } from "@workplan/contracts";
import { AppError, invalidInput, notFound, versionConflict } from "../errors.js";
import { newId, nowIso, parseJson } from "../utils.js";

type FieldRow = {
  id: string;
  key: string;
  label: string;
  description: string;
  type: CustomFieldType;
  required: number;
  default_value_json: string | null;
  sort_order: number;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type OptionRow = {
  id: string;
  field_id: string;
  value: string;
  label: string;
  sort_order: number;
  archived_at: string | null;
  version: number;
};

export type CreateFieldInput = {
  key: string;
  label: string;
  description: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: unknown | null;
  options: Array<{ value: string; label: string }>;
};

const scalarColumnByType: Partial<Record<CustomFieldType, string>> = {
  short_text: "text_value",
  long_text: "text_value",
  number: "number_value",
  boolean: "boolean_value",
  date: "date_value",
  datetime: "datetime_value",
  single_select: "text_value",
  url: "url_value",
};

export class CustomFieldService {
  constructor(private readonly database: DatabaseBundle) {}

  list(includeArchived = false): CustomFieldDefinition[] {
    const rows = this.database.sqlite
      .prepare(`SELECT * FROM custom_field_definitions ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY sort_order, created_at`)
      .all() as FieldRow[];
    const allOptions = this.database.sqlite
      .prepare("SELECT * FROM custom_field_options ORDER BY sort_order")
      .all() as OptionRow[];
    const optionsByField = new Map<string, OptionRow[]>();
    for (const option of allOptions) {
      const list = optionsByField.get(option.field_id) ?? [];
      list.push(option);
      optionsByField.set(option.field_id, list);
    }
    return rows.map((row) => this.serializeDefinition(row, optionsByField.get(row.id) ?? []));
  }

  private serializeDefinition(row: FieldRow, options: OptionRow[]): CustomFieldDefinition {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      description: row.description,
      type: row.type,
      required: Boolean(row.required),
      defaultValue: parseJson<unknown | null>(row.default_value_json, null),
      sortOrder: row.sort_order,
      archivedAt: row.archived_at,
      version: row.version,
      options: options.map((option) => ({
        id: option.id,
        value: option.value,
        label: option.label,
        sortOrder: option.sort_order,
        archivedAt: option.archived_at,
        version: option.version,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getByKey(key: string, includeArchived = false): CustomFieldDefinition | undefined {
    return this.list(includeArchived).find((field) => field.key === key);
  }

  create(input: CreateFieldInput): CustomFieldDefinition {
    if (["single_select", "multi_select"].includes(input.type) && input.options.length === 0) {
      throw invalidInput("单选和多选字段必须至少包含一个选项");
    }
    const count = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM work_plans").get() as { count: number };
    if (input.required && count.count > 0 && input.defaultValue == null) {
      throw invalidInput("已有工作计划时，新增必填字段必须设置默认值");
    }

    const existingKeys = this.database.sqlite
      .prepare("SELECT id FROM custom_field_definitions WHERE key = ?")
      .get(input.key);
    if (existingKeys) throw new AppError(409, "CUSTOM_FIELD_KEY_EXISTS", "稳定键已经存在");

    const id = newId();
    const timestamp = nowIso();
    const order = this.database.sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM custom_field_definitions").get() as {
      value: number;
    };

    const execute = this.database.sqlite.transaction(() => {
      this.validateValue(input.type, input.defaultValue, input.options, false);
      this.database.sqlite
        .prepare("INSERT INTO custom_field_definitions(id, key, label, description, type, required, default_value_json, sort_order, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .run(
          id,
          input.key,
          input.label,
          input.description,
          input.type,
          input.required ? 1 : 0,
          input.defaultValue == null ? null : JSON.stringify(input.defaultValue),
          order.value,
          timestamp,
          timestamp,
        );
      input.options.forEach((option, index) => {
        this.database.sqlite
          .prepare("INSERT INTO custom_field_options(id, field_id, value, label, sort_order, version) VALUES (?, ?, ?, ?, ?, 1)")
          .run(newId(), id, option.value, option.label, index);
      });
      if (input.defaultValue != null) {
        const plans = this.database.sqlite.prepare("SELECT id FROM work_plans").all() as Array<{ id: string }>;
        for (const plan of plans) this.setValues(plan.id, { [input.key]: input.defaultValue }, false);
      }
    });
    execute();
    return this.list(true).find((field) => field.id === id)!;
  }

  update(
    id: string,
    input: {
      label?: string | undefined;
      description?: string | undefined;
      required?: boolean | undefined;
      defaultValue?: unknown | null | undefined;
      archived?: boolean | undefined;
      version: number;
    },
  ): CustomFieldDefinition {
    const current = this.list(true).find((field) => field.id === id);
    if (!current) throw notFound("自定义字段不存在");
    const required = input.required ?? current.required;
    const defaultValue = Object.prototype.hasOwnProperty.call(input, "defaultValue") ? input.defaultValue : current.defaultValue;
    const count = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM work_plans").get() as { count: number };
    if (required && !current.required && count.count > 0 && defaultValue == null) {
      throw invalidInput("将已有字段设为必填时必须提供默认值");
    }
    this.validateValue(
      current.type,
      defaultValue,
      current.options.filter((option) => !option.archivedAt).map(({ value, label }) => ({ value, label })),
      false,
    );
    const archivedAt = input.archived === undefined ? current.archivedAt : input.archived ? nowIso() : null;
    const result = this.database.sqlite
      .prepare("UPDATE custom_field_definitions SET label = ?, description = ?, required = ?, default_value_json = ?, archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(
        input.label ?? current.label,
        input.description ?? current.description,
        required ? 1 : 0,
        defaultValue == null ? null : JSON.stringify(defaultValue),
        archivedAt,
        nowIso(),
        id,
        input.version,
      );
    if (result.changes === 0) throw versionConflict();
    if (required && !current.required && defaultValue != null) {
      const plans = this.database.sqlite.prepare("SELECT id FROM work_plans").all() as Array<{ id: string }>;
      for (const plan of plans) {
        const values = this.getValues(plan.id);
        if (values[current.key] == null) this.setValues(plan.id, { [current.key]: defaultValue }, false);
      }
    }
    return this.list(true).find((field) => field.id === id)!;
  }

  reorder(orderedIds: string[]): void {
    const execute = this.database.sqlite.transaction(() => {
      orderedIds.forEach((id, index) => this.database.sqlite.prepare("UPDATE custom_field_definitions SET sort_order = ?, updated_at = ? WHERE id = ?").run(index, nowIso(), id));
    });
    execute();
  }

  addOption(fieldId: string, input: { value: string; label: string }) {
    const field = this.list(true).find((item) => item.id === fieldId);
    if (!field) throw notFound("自定义字段不存在");
    if (!["single_select", "multi_select"].includes(field.type)) throw invalidInput("只有单选或多选字段可以添加选项");
    const sortOrder = field.options.length;
    const id = newId();
    try {
      this.database.sqlite
        .prepare("INSERT INTO custom_field_options(id, field_id, value, label, sort_order, version) VALUES (?, ?, ?, ?, ?, 1)")
        .run(id, fieldId, input.value, input.label, sortOrder);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new AppError(409, "OPTION_VALUE_EXISTS", "选项值已经存在");
      throw error;
    }
    return this.list(true).find((item) => item.id === fieldId)!.options.find((option) => option.id === id)!;
  }

  updateOption(optionId: string, input: { label?: string | undefined; archived?: boolean | undefined; version: number }) {
    const option = this.database.sqlite.prepare("SELECT * FROM custom_field_options WHERE id = ?").get(optionId) as OptionRow | undefined;
    if (!option) throw notFound("字段选项不存在");
    const archivedAt = input.archived === undefined ? option.archived_at : input.archived ? nowIso() : null;
    const result = this.database.sqlite
      .prepare("UPDATE custom_field_options SET label = ?, archived_at = ?, version = version + 1 WHERE id = ? AND version = ?")
      .run(input.label ?? option.label, archivedAt, optionId, input.version);
    if (result.changes === 0) throw versionConflict();
    const field = this.list(true).find((item) => item.id === option.field_id)!;
    return field.options.find((item) => item.id === optionId)!;
  }

  getValues(workPlanId: string): Record<string, unknown> {
    const fields = this.list(true);
    const scalarRows = this.database.sqlite
      .prepare("SELECT * FROM custom_field_values WHERE work_plan_id = ?")
      .all(workPlanId) as Array<Record<string, unknown> & { field_id: string }>;
    const multiRows = this.database.sqlite
      .prepare("SELECT m.field_id, o.value FROM custom_field_multi_values m JOIN custom_field_options o ON o.id = m.option_id WHERE m.work_plan_id = ? ORDER BY o.sort_order")
      .all(workPlanId) as Array<{ field_id: string; value: string }>;
    const output: Record<string, unknown> = {};
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    for (const row of scalarRows) {
      const field = fieldById.get(row.field_id);
      if (!field) continue;
      const column = scalarColumnByType[field.type];
      const rawValue = column ? row[column] : undefined;
      if (rawValue !== null && rawValue !== undefined) {
        output[field.key] = field.type === "boolean" ? Boolean(rawValue) : rawValue;
      }
    }
    for (const row of multiRows) {
      const field = fieldById.get(row.field_id);
      if (!field) continue;
      const values = (output[field.key] as string[] | undefined) ?? [];
      values.push(row.value);
      output[field.key] = values;
    }
    return output;
  }

  setValues(workPlanId: string, incoming: Record<string, unknown>, creating: boolean): Record<string, unknown> {
    const fields = this.list(true);
    const activeFields = fields.filter((field) => !field.archivedAt);
    const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
    for (const key of Object.keys(incoming)) {
      const field = fieldsByKey.get(key);
      if (!field || field.archivedAt) throw invalidInput(`未知或已归档的自定义字段：${key}`);
    }

    const existing = creating ? {} : this.getValues(workPlanId);
    const finalValues: Record<string, unknown> = { ...existing };
    if (creating) {
      for (const field of activeFields) if (field.defaultValue != null) finalValues[field.key] = field.defaultValue;
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) delete finalValues[key];
      else finalValues[key] = value;
    }

    for (const field of activeFields) {
      const value = finalValues[field.key];
      if (field.required && value == null) throw invalidInput(`自定义字段“${field.label}”为必填项`);
      const optionsForValidation = creating || Object.prototype.hasOwnProperty.call(incoming, field.key)
        ? field.options.filter((option) => !option.archivedAt)
        : field.options;
      this.validateValue(
        field.type,
        value,
        optionsForValidation.map(({ value: optionValue, label }) => ({ value: optionValue, label })),
        true,
      );
    }

    this.database.sqlite.prepare("DELETE FROM custom_field_values WHERE work_plan_id = ?").run(workPlanId);
    this.database.sqlite.prepare("DELETE FROM custom_field_multi_values WHERE work_plan_id = ?").run(workPlanId);

    for (const [key, value] of Object.entries(finalValues)) {
      const field = fieldsByKey.get(key);
      if (!field || value == null) continue;
      if (field.type === "multi_select") {
        const values = value as string[];
        for (const optionValue of values) {
          const option = field.options.find((item) => item.value === optionValue);
          if (!option) continue;
          this.database.sqlite
            .prepare("INSERT INTO custom_field_multi_values(work_plan_id, field_id, option_id) VALUES (?, ?, ?)")
            .run(workPlanId, field.id, option.id);
        }
      } else {
        const columns = { text: null as string | null, number: null as number | null, boolean: null as number | null, date: null as string | null, datetime: null as string | null, url: null as string | null };
        if (["short_text", "long_text", "single_select"].includes(field.type)) columns.text = String(value);
        if (field.type === "number") columns.number = Number(value);
        if (field.type === "boolean") columns.boolean = value ? 1 : 0;
        if (field.type === "date") columns.date = String(value);
        if (field.type === "datetime") columns.datetime = String(value);
        if (field.type === "url") columns.url = String(value);
        // 统一排序键与值在同一事务内维护（票据 08 方案 A）
        let textSortKey: string | null = null;
        if ((field.type === "short_text" || field.type === "url") && String(value).trim() !== "") textSortKey = naturalSortKey(String(value));
        let datetimeSortKey: string | null = null;
        if (field.type === "datetime") datetimeSortKey = normalizeDateTimeForSort(String(value));
        this.database.sqlite
          .prepare("INSERT INTO custom_field_values(work_plan_id, field_id, text_value, number_value, boolean_value, date_value, datetime_value, url_value, text_sort_key, datetime_sort_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(workPlanId, field.id, columns.text, columns.number, columns.boolean, columns.date, columns.datetime, columns.url, textSortKey, datetimeSortKey);
      }
    }
    return finalValues;
  }

  private validateValue(
    type: CustomFieldType,
    value: unknown,
    options: Array<{ value: string; label: string }>,
    allowArchivedValues: boolean,
  ): void {
    if (value == null) return;
    const fail = (message: string): never => {
      throw invalidInput(message);
    };
    switch (type) {
      case "short_text":
        if (typeof value !== "string" || value.length > 255) fail("短文本必须是不超过 255 个字符的字符串");
        return;
      case "long_text":
        if (typeof value !== "string" || value.length > 10_000) fail("长文本必须是不超过 10000 个字符的字符串");
        return;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) fail("数字字段必须是有限数值");
        return;
      case "boolean":
        if (typeof value !== "boolean") fail("布尔字段必须为 true 或 false");
        return;
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("日期字段必须使用 YYYY-MM-DD 格式");
        return;
      case "datetime":
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail("日期时间字段格式无效");
        return;
      case "url":
        if (typeof value !== "string") return fail("URL 字段必须是字符串");
        try {
          new URL(value);
        } catch {
          fail("URL 字段格式无效");
        }
        return;
      case "single_select": {
        if (typeof value !== "string") fail("单选字段必须是字符串");
        if (!allowArchivedValues && !options.some((option) => option.value === value)) fail("单选字段包含未知选项");
        if (allowArchivedValues && options.length > 0 && !options.some((option) => option.value === value)) fail("单选字段包含未知选项");
        return;
      }
      case "multi_select": {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail("多选字段必须是字符串数组");
        if ((value as string[]).some((item) => !options.some((option) => option.value === item))) fail("多选字段包含未知选项");
        return;
      }
    }
  }
}
