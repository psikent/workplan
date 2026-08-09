import { z } from "zod";

export const workPlanStatuses = ["pending", "in_progress", "completed", "cancelled"] as const;
export const workPlanStatusModes = ["automatic", "manual"] as const;
export const customFieldTypes = [
  "short_text",
  "long_text",
  "number",
  "boolean",
  "date",
  "datetime",
  "single_select",
  "multi_select",
  "url",
] as const;
export const recurrenceFrequencies = ["daily", "weekly", "monthly"] as const;
export const userRoles = ["admin", "editor"] as const;
export const loginModes = ["password", "token"] as const;

export const workPlanStatusSchema = z.enum(workPlanStatuses);
export const workPlanStatusModeSchema = z.enum(workPlanStatusModes);
export const customFieldTypeSchema = z.enum(customFieldTypes);
export const recurrenceFrequencySchema = z.enum(recurrenceFrequencies);
export const userRoleSchema = z.enum(userRoles);
export const loginModeSchema = z.enum(loginModes);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();

export const workPlanSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: workPlanStatusSchema,
  statusMode: workPlanStatusModeSchema,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  sortOrder: z.number().int(),
  version: z.number().int().positive(),
  seriesId: z.string().uuid().nullable(),
  occurrenceKey: z.string().nullable(),
  isException: z.boolean(),
  customFields: z.record(z.string(), z.unknown()),
  ownerAccount: z.string().email().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

const workPlanValuesSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4_000).default(""),
  status: workPlanStatusSchema.optional(),
  statusMode: workPlanStatusModeSchema.optional(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  customFields: z.record(z.string(), z.unknown()).default({}),
}).strict();

const validateTimeRange = (
  value: { startAt?: string | undefined; endAt?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (value.startAt && value.endAt && Date.parse(value.startAt) >= Date.parse(value.endAt)) {
    context.addIssue({
      code: "custom",
      path: ["endAt"],
      message: "结束时间必须晚于开始时间",
    });
  }
};

const validateManualStatus = (
  value: { status?: string | undefined; statusMode?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (value.statusMode === "manual" && !value.status) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "手动状态必须指定状态值",
    });
  }
};

export const createWorkPlanSchema = workPlanValuesSchema.superRefine((value, context) => {
  validateTimeRange(value, context);
  validateManualStatus(value, context);
});

export const updateWorkPlanSchema = workPlanValuesSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .superRefine((value, context) => {
    validateTimeRange(value, context);
    validateManualStatus(value, context);
  });

export const updateScheduleSchema = z
  .object({
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .superRefine(validateTimeRange);

export const reorderWorkPlansSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export const listWorkPlansQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: workPlanStatusSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const workPlanQueryFieldSchema = z.string().min(1).max(120).refine((field) => field !== "ownerAccount", {
  message: "工作负责人账号不可用于筛选或排序",
});

export const workPlanFilterSchema = z.object({
  field: workPlanQueryFieldSchema,
  op: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte", "between", "any", "all"]),
  value: z.unknown(),
});

export const searchWorkPlansSchema = z.object({
  q: z.string().max(200).optional(),
  filters: z.array(workPlanFilterSchema).max(30).default([]),
  sort: z
    .array(
      z.object({
        field: workPlanQueryFieldSchema,
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .max(5)
    .default([]),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const customFieldOptionSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  archivedAt: isoDateTimeSchema.nullable(),
  version: z.number().int(),
});

export const customFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  description: z.string(),
  type: customFieldTypeSchema,
  required: z.boolean(),
  defaultValue: z.unknown().nullable(),
  sortOrder: z.number().int(),
  archivedAt: isoDateTimeSchema.nullable(),
  version: z.number().int(),
  options: z.array(customFieldOptionSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createCustomFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  label: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  type: customFieldTypeSchema,
  required: z.boolean().default(false),
  defaultValue: z.unknown().nullable().default(null),
  options: z
    .array(z.object({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(80) }))
    .max(100)
    .default([]),
});

export const updateCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().nullable().optional(),
  archived: z.boolean().optional(),
  version: z.number().int().positive(),
});

export const createCustomFieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
});

export const updateCustomFieldOptionSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  archived: z.boolean().optional(),
  version: z.number().int().positive(),
});

export const recurrenceRuleSchema = z.object({
  frequency: recurrenceFrequencySchema,
  interval: z.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  until: isoDateTimeSchema.optional(),
  count: z.number().int().min(1).max(10_000).optional(),
  timeZone: z.string().min(1).default("Asia/Shanghai"),
});

export const createWorkPlanSeriesSchema = z.object({
  workPlan: createWorkPlanSchema,
  recurrence: recurrenceRuleSchema,
});

export const updateWorkPlanSeriesSchema = z.object({
  workPlan: workPlanValuesSchema.partial().optional(),
  recurrence: recurrenceRuleSchema.partial().optional(),
  version: z.number().int().positive(),
});

export const attachRecurringRuleSchema = z.object({
  workPlan: createWorkPlanSchema,
  recurrence: recurrenceRuleSchema,
  version: z.number().int().positive(),
});

export const workPlanSeriesSchema = z.object({
  id: z.string().uuid(),
  workPlan: createWorkPlanSchema,
  recurrence: z.object({
    frequency: recurrenceFrequencySchema,
    interval: z.number().int().min(1).max(365),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    until: isoDateTimeSchema.nullable(),
    count: z.number().int().min(1).max(10_000).nullable(),
    timeZone: z.string().min(1),
  }),
  generatedThrough: isoDateTimeSchema.nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const setupSchema = z.object({
  token: z.string().min(20),
  username: z.string().trim().min(3).max(80),
  password: z.string().min(12).max(200),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

export const createAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: isoDateTimeSchema.nullable().default(null),
});

const editorUserBaseSchema = z.object({
  username: z.string().trim().min(1).max(80),
  role: z.literal("editor"),
});

export const createPasswordEditorSchema = editorUserBaseSchema.extend({
  loginMode: z.literal("password"),
  password: z.string().min(12).max(200),
});

export const createTokenOnlyUserSchema = editorUserBaseSchema.extend({
  loginMode: z.literal("token"),
  tokenName: z.string().trim().min(1).max(100),
  tokenExpiresAt: isoDateTimeSchema,
});

export const createEditorUserSchema = z.discriminatedUnion("loginMode", [
  createPasswordEditorSchema,
  createTokenOnlyUserSchema,
]);

export const setEditorPasswordSchema = z.object({
  password: z.string().min(12).max(200),
  version: z.number().int().positive(),
});

export const updateUserStatusSchema = z.object({
  disabled: z.boolean(),
  version: z.number().int().positive(),
});

export const importPayloadSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: isoDateTimeSchema,
  data: z.record(z.string(), z.unknown()),
});

export const ownerAccountMappingSchema = z.object({
  ownerName: z.string().trim().min(1).max(80),
  account: z.string().trim().toLowerCase().email().max(254),
});

export const createOwnerAccountMappingSchema = ownerAccountMappingSchema.strict();
export const updateOwnerAccountMappingSchema = ownerAccountMappingSchema.strict();

export const exportTemplateColumnSchema = z.object({
  source: z.string().regex(/^(title|description|status|startAt|endAt|ownerAccount|custom:[a-z][a-z0-9_]{1,63})$/),
  header: z.string().trim().min(1).max(80),
});

export const exportTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sheetName: z.string(),
  columns: z.array(exportTemplateColumnSchema),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createExportTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sheetName: z.string().trim().min(1).max(31).regex(/^[^\\/?*\[\]:]+$/),
  columns: z.array(exportTemplateColumnSchema).min(1).max(100),
});

export const updateExportTemplateSchema = createExportTemplateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const exportWorkPlansXlsSchema = z.object({
  columns: z.array(exportTemplateColumnSchema).min(1).max(100),
  sheetName: z.string().trim().min(1).max(31).regex(/^[^\\/?*\[\]:]+$/).default("工作计划"),
  q: z.string().max(200).optional(),
  status: workPlanStatusSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export const importWorkPlansXlsSchema = z.object({
  templateId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255).refine((value) => value.toLocaleLowerCase().endsWith(".xls"), "只支持 .xls 文件"),
  dataBase64: z.string().min(1).max(8_000_000),
});

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type WorkPlan = z.infer<typeof workPlanSchema>;
export type CreateWorkPlan = z.infer<typeof createWorkPlanSchema>;
export type UpdateWorkPlan = z.infer<typeof updateWorkPlanSchema>;
export type WorkPlanStatus = z.infer<typeof workPlanStatusSchema>;
export type WorkPlanStatusMode = z.infer<typeof workPlanStatusModeSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type LoginMode = z.infer<typeof loginModeSchema>;
export type OwnerAccountMapping = z.infer<typeof ownerAccountMappingSchema>;
export type CreateOwnerAccountMapping = z.infer<typeof createOwnerAccountMappingSchema>;
export type UpdateOwnerAccountMapping = z.infer<typeof updateOwnerAccountMappingSchema>;
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;
export type WorkPlanSearch = z.infer<typeof searchWorkPlansSchema>;
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
export type WorkPlanSeries = z.infer<typeof workPlanSeriesSchema>;
export type ExportTemplate = z.infer<typeof exportTemplateSchema>;
export type ExportTemplateColumn = z.infer<typeof exportTemplateColumnSchema>;

export function deriveWorkPlanStatus(startAt: string, endAt: string, now = Date.now()): WorkPlanStatus {
  if (now < Date.parse(startAt)) return "pending";
  if (now < Date.parse(endAt)) return "in_progress";
  return "completed";
}

export function compareWorkPlansBySchedule(
  left: Pick<WorkPlan, "id" | "startAt" | "endAt" | "sortOrder">,
  right: Pick<WorkPlan, "id" | "startAt" | "endAt" | "sortOrder">,
): number {
  return Date.parse(left.startAt) - Date.parse(right.startAt)
    || Date.parse(right.endAt) - Date.parse(left.endAt)
    || left.sortOrder - right.sortOrder
    || left.id.localeCompare(right.id);
}
