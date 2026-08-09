import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { CustomFieldType, LoginMode, UserRole, WorkPlanStatus, WorkPlanStatusMode } from "@workplan/contracts";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("admin"),
  loginMode: text("login_mode").$type<LoginMode>().notNull().default("password"),
  disabledAt: text("disabled_at"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_uq").on(table.tokenHash), index("sessions_expires_idx").on(table.expiresAt)],
);

export const accessTokens = sqliteTable(
  "access_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [uniqueIndex("access_tokens_hash_uq").on(table.tokenHash)],
);

export const workPlanSeries = sqliteTable("work_plan_series", {
  id: text("id").primaryKey(),
  templateJson: text("template_json").notNull(),
  frequency: text("frequency").notNull(),
  interval: integer("interval").notNull(),
  weekdaysJson: text("weekdays_json"),
  untilAt: text("until_at"),
  occurrenceCount: integer("occurrence_count"),
  timeZone: text("time_zone").notNull(),
  generatedThrough: text("generated_through"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workPlans = sqliteTable(
  "work_plans",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<WorkPlanStatus>().notNull(),
    statusMode: text("status_mode").$type<WorkPlanStatusMode>().notNull().default("automatic"),
    // Kept only for compatibility with version-1 exports. New code always writes
    // the neutral legacy value and never exposes priority as a Work Plan property.
    priority: text("priority").notNull(),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    sortOrder: integer("sort_order").notNull(),
    version: integer("version").notNull().default(1),
    seriesId: text("series_id").references(() => workPlanSeries.id, { onDelete: "set null" }),
    occurrenceKey: text("occurrence_key"),
    isException: integer("is_exception", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("work_plans_schedule_idx").on(table.startAt, table.endAt),
    index("work_plans_status_idx").on(table.status),
    index("work_plans_sort_idx").on(table.sortOrder),
    uniqueIndex("work_plans_occurrence_uq").on(table.seriesId, table.occurrenceKey),
  ],
);

export const customFieldDefinitions = sqliteTable(
  "custom_field_definitions",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    type: text("type").$type<CustomFieldType>().notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    defaultValueJson: text("default_value_json"),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: text("archived_at"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("custom_fields_key_uq").on(table.key), index("custom_fields_sort_idx").on(table.sortOrder)],
);

export const customFieldOptions = sqliteTable(
  "custom_field_options",
  {
    id: text("id").primaryKey(),
    fieldId: text("field_id").notNull().references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: text("archived_at"),
    version: integer("version").notNull().default(1),
  },
  (table) => [uniqueIndex("custom_field_options_value_uq").on(table.fieldId, table.value)],
);

export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    workPlanId: text("work_plan_id").notNull().references(() => workPlans.id, { onDelete: "cascade" }),
    fieldId: text("field_id").notNull().references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    textValue: text("text_value"),
    numberValue: real("number_value"),
    booleanValue: integer("boolean_value", { mode: "boolean" }),
    dateValue: text("date_value"),
    dateTimeValue: text("datetime_value"),
    urlValue: text("url_value"),
  },
  (table) => [
    primaryKey({ columns: [table.workPlanId, table.fieldId] }),
    index("custom_values_text_idx").on(table.fieldId, table.textValue),
    index("custom_values_number_idx").on(table.fieldId, table.numberValue),
    index("custom_values_date_idx").on(table.fieldId, table.dateValue),
    index("custom_values_datetime_idx").on(table.fieldId, table.dateTimeValue),
  ],
);

export const customFieldMultiValues = sqliteTable(
  "custom_field_multi_values",
  {
    workPlanId: text("work_plan_id").notNull().references(() => workPlans.id, { onDelete: "cascade" }),
    fieldId: text("field_id").notNull().references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    optionId: text("option_id").notNull().references(() => customFieldOptions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.workPlanId, table.fieldId, table.optionId] }),
    index("custom_multi_option_idx").on(table.fieldId, table.optionId),
  ],
);

export const exportTemplates = sqliteTable("export_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sheetName: text("sheet_name").notNull(),
  columnsJson: text("columns_json").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ownerAccountMappings = sqliteTable("owner_account_mappings", {
  ownerName: text("owner_name").primaryKey(),
  account: text("account").notNull().unique(),
});
