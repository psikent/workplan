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
export const userRoles = ["admin", "editor", "viewer"] as const;
export const manageableUserRoles = ["editor", "viewer"] as const;
export const loginModes = ["password", "token"] as const;

export const workPlanStatusSchema = z.enum(workPlanStatuses);
export const workPlanStatusModeSchema = z.enum(workPlanStatusModes);
export const customFieldTypeSchema = z.enum(customFieldTypes);
export const recurrenceFrequencySchema = z.enum(recurrenceFrequencies);
export const userRoleSchema = z.enum(userRoles);
export const manageableUserRoleSchema = z.enum(manageableUserRoles);
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
  monthlyGoalIds: z.array(z.string().uuid()).default([]),
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
  monthlyGoalIds: z.array(z.string().uuid()).optional(),
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

// ---------- 工作计划统一查询与排序契约 ----------

export const workPlanSortDirections = ["asc", "desc"] as const;
export const workPlanSortDirectionSchema = z.enum(workPlanSortDirections);
export type WorkPlanSortDirection = (typeof workPlanSortDirections)[number];

// 静态白名单由服务端查询引擎执行（产生 SORT_FIELD_INVALID 稳定错误码）；
// 这里只做结构与规模约束；custom.<key> 的存在性、归档状态与类型同样由服务端字段目录校验。
export const workPlanSortBuiltinFields = ["title", "status", "startAt", "endAt", "duration", "createdAt", "updatedAt"] as const;
export type WorkPlanSortBuiltinField = (typeof workPlanSortBuiltinFields)[number];

export const workPlanSortItemSchema = z.object({
  field: z.string().min(1).max(130),
  direction: workPlanSortDirectionSchema,
});
export type WorkPlanSortItem = z.infer<typeof workPlanSortItemSchema>;

export const workPlanSortItemsSchema = z.array(workPlanSortItemSchema).max(5);

// 时间范围采用半开相交语义：startAt < to 且 endAt > from；from/to 均可省略。
export const workPlanQueryRangeSchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

// POST /api/v1/work-plans/query 请求：游标与 offset 互斥——本契约只提供游标；
// strict 使未知键（如 offset）在路由校验层即被拒绝。
export const workPlanQueryRequestSchema = z.object({
  q: z.string().max(200).optional(),
  filters: z.array(workPlanFilterSchema).max(30).default([]),
  range: workPlanQueryRangeSchema.default({}),
  sort: workPlanSortItemsSchema.default([]),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().max(4096).optional(),
}).strict();
export type WorkPlanQueryRequest = z.infer<typeof workPlanQueryRequestSchema>;

export const workPlanQueryResponseSchema = z.object({
  items: z.array(workPlanSchema),
  total: z.number().int().min(0),
  evaluatedAt: isoDateTimeSchema,
  nextCursor: z.string().nullable(),
});
export type WorkPlanQueryResponse = z.infer<typeof workPlanQueryResponseSchema>;

// 稳定错误类别：响应外壳沿用 problemDetailsSchema（code 字段取以下值之一）。
export const workPlanQueryErrorCodes = [
  "SORT_FIELD_INVALID",
  "SORT_FIELD_DUPLICATED",
  "SORT_FIELD_UNSUPPORTED",
  "CURSOR_INVALID",
  "CURSOR_MISMATCH",
  "WORK_PLAN_REORDER_RETIRED",
] as const;
export type WorkPlanQueryErrorCode = (typeof workPlanQueryErrorCodes)[number];

// 工作计划页 URL 排序参数：sort=<field>:<direction>,<field>:<direction>；默认排期顺序不写参数。
export function formatWorkPlanSortParam(items: readonly WorkPlanSortItem[]): string {
  return items.map((item) => `${item.field}:${item.direction}`).join(",");
}

// 解析失败（非法字段、方向、超限、重复）返回 null，调用方整体回退到排期顺序并提示。
export function parseWorkPlanSortParam(value: string | null | undefined): WorkPlanSortItem[] | null {
  if (value == null || value === "") return null;
  const parts = value.split(",");
  if (parts.length > 5) return null;
  const seen = new Set<string>();
  const items: WorkPlanSortItem[] = [];
  for (const part of parts) {
    const separator = part.lastIndexOf(":");
    if (separator <= 0) return null;
    const field = part.slice(0, separator);
    const direction = part.slice(separator + 1);
    const sortable = (workPlanSortBuiltinFields as readonly string[]).includes(field) || field.startsWith("custom.");
    if (!sortable) return null;
    const parsed = workPlanSortItemSchema.safeParse({ field, direction });
    if (!parsed.success) return null;
    if (seen.has(field)) return null;
    seen.add(field);
    items.push(parsed.data);
  }
  return items;
}

export const reminderTypes = ["work-order", "plan-submission"] as const;
export const reminderTypeSchema = z.enum(reminderTypes);

export const reminderPlanSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startAt: isoDateTimeSchema,
  // 排期顺序比较所需：结束时间与创建时间（附加字段，向后兼容）
  endAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  risk: z.string().nullable(),
});

export const reminderSchema = z.object({
  type: reminderTypeSchema,
  date: isoDateSchema,
  originalDate: isoDateSchema.nullable(),
  plans: z.array(reminderPlanSchema),
});

export const reminderDaySchema = z.object({
  date: isoDateSchema,
  reminders: z.array(reminderSchema),
});

export const listRemindersQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((value) => value.from <= value.to, {
    message: "结束日期不能早于开始日期",
    path: ["to"],
  });

export const listRemindersResponseSchema = z.object({
  days: z.array(reminderDaySchema),
});

// Bark 推送配置（R1）。serverUrl 只允许 http(s)；deviceKey 允许空字符串（由写入方归一化为 null = 推送关闭）。
export const barkServerUrlSchema = z.url({ protocol: /^https?$/ }).max(2000);
export const barkDeviceKeySchema = z.string().trim().max(200);

export const barkConfigSchema = z.object({
  serverUrl: barkServerUrlSchema,
  deviceKey: barkDeviceKeySchema.nullable(),
});

export const updateBarkConfigSchema = z
  .object({
    serverUrl: barkServerUrlSchema,
    deviceKey: barkDeviceKeySchema.nullable().default(null),
  })
  .strict();

export const barkTestPushResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const monthlyGoalSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  archivedAt: isoDateTimeSchema.nullable(),
  version: z.number().int(),
  status: workPlanStatusSchema.nullable(),
  linkedWorkPlan: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  seriesId: z.string().uuid().nullable(),
  occurrenceKey: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

const monthlyGoalTitleSchema = z.string().trim().min(1).max(200);
const monthlyGoalDescriptionSchema = z.string().max(2_000);
const monthlyGoalYearSchema = z.number().int().min(2000).max(2100);
const monthlyGoalMonthSchema = z.number().int().min(1).max(12);
const monthlyGoalWorkPlanIdSchema = z.string().uuid().nullable();

export const createMonthlyGoalSchema = z
  .object({
    title: monthlyGoalTitleSchema,
    description: monthlyGoalDescriptionSchema.default(""),
    year: monthlyGoalYearSchema,
    month: monthlyGoalMonthSchema,
    workPlanId: monthlyGoalWorkPlanIdSchema.default(null),
  })
  .strict();

export const updateMonthlyGoalSchema = z
  .object({
    title: monthlyGoalTitleSchema.optional(),
    description: monthlyGoalDescriptionSchema.optional(),
    year: monthlyGoalYearSchema.optional(),
    month: monthlyGoalMonthSchema.optional(),
    workPlanId: monthlyGoalWorkPlanIdSchema.optional(),
    archived: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const monthlyGoalQuickEditBaselineSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

const monthlyGoalQuickEditActiveMonthsSchema = z.array(monthlyGoalMonthSchema).superRefine((months, context) => {
  if (new Set(months).size !== months.length) {
    context.addIssue({ code: "custom", message: "月份不能重复" });
  }
});

export const monthlyGoalQuickEditRowSchema = z
  .object({
    originalTitle: monthlyGoalTitleSchema.nullable(),
    title: monthlyGoalTitleSchema,
    activeMonths: monthlyGoalQuickEditActiveMonthsSchema,
  })
  .strict()
  .superRefine((row, context) => {
    if (row.originalTitle === null && row.activeMonths.length === 0) {
      context.addIssue({ code: "custom", path: ["activeMonths"], message: "新行至少需要一个月份" });
    }
  });

export const monthlyGoalQuickEditSchema = z
  .object({
    year: monthlyGoalYearSchema,
    baseline: z.array(monthlyGoalQuickEditBaselineSchema),
    rows: z.array(monthlyGoalQuickEditRowSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.baseline.map((item) => item.id)).size !== value.baseline.length) {
      context.addIssue({ code: "custom", path: ["baseline"], message: "baseline 中的月目标 ID 不能重复" });
    }
    const originalTitles = value.rows.map((row) => row.originalTitle).filter((title): title is string => title !== null);
    if (new Set(originalTitles).size !== originalTitles.length) {
      context.addIssue({ code: "custom", path: ["rows"], message: "已有目标名称不能重复" });
    }
    const titles = value.rows.map((row) => row.title);
    if (new Set(titles).size !== titles.length) {
      context.addIssue({ code: "custom", path: ["rows"], message: "最终目标名称不能重复" });
    }
  });

export const monthlyGoalQuickEditResultSchema = z.object({
  createdCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0),
  goals: z.array(monthlyGoalSchema),
});

export const monthlyGoalSeriesFrequencies = ["monthly", "quarterly", "yearly"] as const;
export const monthlyGoalSeriesFrequencySchema = z.enum(monthlyGoalSeriesFrequencies);

export const monthlyGoalPeriodSchema = z.object({
  year: monthlyGoalYearSchema,
  month: monthlyGoalMonthSchema,
});

const monthlyGoalSeriesTemplateSchema = z.object({
  title: monthlyGoalTitleSchema,
  description: monthlyGoalDescriptionSchema.default(""),
});

export const createMonthlyGoalSeriesSchema = z
  .object({
    template: monthlyGoalSeriesTemplateSchema,
    frequency: monthlyGoalSeriesFrequencySchema,
    interval: z.number().int().min(1).max(12).default(1),
    startPeriod: monthlyGoalPeriodSchema,
    occurrenceCount: z.number().int().min(1).max(600).nullable().optional(),
    untilPeriod: monthlyGoalPeriodSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.occurrenceCount == null && value.untilPeriod == null) {
      context.addIssue({ code: "custom", path: ["occurrenceCount"], message: "必须指定期数或结束月份之一" });
    }
    if (value.untilPeriod && periodKey(value.untilPeriod) < periodKey(value.startPeriod)) {
      context.addIssue({ code: "custom", path: ["untilPeriod"], message: "结束月份不能早于起始月份" });
    }
  });

export const updateMonthlyGoalSeriesSchema = z
  .object({
    template: monthlyGoalSeriesTemplateSchema.partial().optional(),
    frequency: monthlyGoalSeriesFrequencySchema.optional(),
    interval: z.number().int().min(1).max(12).optional(),
    startPeriod: monthlyGoalPeriodSchema.optional(),
    occurrenceCount: z.number().int().min(1).max(600).nullable().optional(),
    untilPeriod: monthlyGoalPeriodSchema.nullable().optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startPeriod && value.untilPeriod && periodKey(value.untilPeriod) < periodKey(value.startPeriod)) {
      context.addIssue({ code: "custom", path: ["untilPeriod"], message: "结束月份不能早于起始月份" });
    }
  });

export const monthlyGoalSeriesSchema = z.object({
  id: z.string().uuid(),
  template: z.object({ title: z.string(), description: z.string() }),
  frequency: monthlyGoalSeriesFrequencySchema,
  interval: z.number().int().min(1).max(12),
  startPeriod: monthlyGoalPeriodSchema,
  occurrenceCount: z.number().int().min(1).max(600).nullable(),
  untilPeriod: monthlyGoalPeriodSchema.nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
  instanceCount: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const monthlyGoalSeriesInstanceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  archivedAt: isoDateTimeSchema.nullable(),
});

export const monthlyGoalSeriesDetailSchema = monthlyGoalSeriesSchema.extend({
  instances: z.array(monthlyGoalSeriesInstanceSchema),
});

export const monthlyGoalSeriesDissolveReasons = ["selected", "edited", "archived", "linked", "completed"] as const;
export const monthlyGoalSeriesDissolveReasonSchema = z.enum(monthlyGoalSeriesDissolveReasons);
export const monthlyGoalSeriesDissolveActionSchema = z.enum(["retain", "delete"]);

export const monthlyGoalSeriesDissolvePreviewQuerySchema = z.object({
  keepGoalId: z.string().uuid(),
}).strict();

export const monthlyGoalSeriesDissolveInstanceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  year: monthlyGoalYearSchema,
  month: monthlyGoalMonthSchema,
  archivedAt: isoDateTimeSchema.nullable(),
  linkedWorkPlan: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  status: workPlanStatusSchema.nullable(),
  action: monthlyGoalSeriesDissolveActionSchema,
  reasons: z.array(monthlyGoalSeriesDissolveReasonSchema),
});

export const monthlyGoalSeriesDissolvePreviewSchema = z.object({
  seriesId: z.string().uuid(),
  seriesVersion: z.number().int().positive(),
  snapshotToken: z.string().regex(/^[a-f0-9]{64}$/),
  keepGoal: z.object({
    id: z.string().uuid(),
    title: z.string(),
    year: monthlyGoalYearSchema,
    month: monthlyGoalMonthSchema,
  }),
  counts: z.object({
    retained: z.number().int().min(1),
    deleted: z.number().int().min(0),
    linked: z.number().int().min(0),
  }),
  instances: z.array(monthlyGoalSeriesDissolveInstanceSchema),
});

export const dissolveMonthlyGoalSeriesSchema = z.object({
  keepGoalId: z.string().uuid(),
  snapshotToken: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationTitle: z.string().min(1).max(200),
}).strict();

export const monthlyGoalSeriesDissolveResultSchema = z.object({
  retainedCount: z.number().int().min(1),
  deletedCount: z.number().int().min(0),
});

function periodKey(period: { year: number; month: number }): number {
  return period.year * 12 + period.month - 1;
}

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

const managedUserBaseSchema = z.object({
  username: z.string().trim().min(1).max(80),
  role: manageableUserRoleSchema,
});

export const createPasswordManagedUserSchema = managedUserBaseSchema.extend({
  loginMode: z.literal("password"),
  password: z.string().min(12).max(200),
});

export const createTokenOnlyManagedUserSchema = managedUserBaseSchema.extend({
  loginMode: z.literal("token"),
  tokenName: z.string().trim().min(1).max(100),
  tokenExpiresAt: isoDateTimeSchema,
});

export const createManagedUserSchema = z.discriminatedUnion("loginMode", [
  createPasswordManagedUserSchema,
  createTokenOnlyManagedUserSchema,
]);

export const setManagedUserPasswordSchema = z.object({
  password: z.string().min(12).max(200),
  version: z.number().int().positive(),
});

export const updateUserStatusSchema = z.object({
  disabled: z.boolean(),
  version: z.number().int().positive(),
});

export const importPayloadSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
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

export const envConfigImportModes = ["additive", "sync"] as const;
export const envConfigSections = ["customFields", "ownerAccountMappings", "exportTemplates"] as const;
export const envConfigImportModeSchema = z.enum(envConfigImportModes);
export const envConfigSectionSchema = z.enum(envConfigSections);

export const envConfigPackageFieldSchema = createCustomFieldSchema.extend({
  sortOrder: z.number().int().min(0).optional(),
});

export const envConfigPackageSchema = z
  .object({
    schemaVersion: z.literal(2),
    exportedAt: isoDateTimeSchema,
    customFields: z.array(envConfigPackageFieldSchema).max(200),
    ownerAccountMappings: z.array(ownerAccountMappingSchema).max(1000),
    exportTemplates: z.array(createExportTemplateSchema).max(100),
  })
  .superRefine((value, context) => {
    const seenKeys = new Set<string>();
    for (const [index, field] of value.customFields.entries()) {
      if (seenKeys.has(field.key)) {
        context.addIssue({ code: "custom", path: ["customFields", index, "key"], message: "稳定键重复：" + field.key });
      }
      seenKeys.add(field.key);
    }
    const seenNames = new Set<string>();
    for (const [index, template] of value.exportTemplates.entries()) {
      if (seenNames.has(template.name)) {
        context.addIssue({ code: "custom", path: ["exportTemplates", index, "name"], message: "模板名称重复：" + template.name });
      }
      seenNames.add(template.name);
    }
  });

const legacyEnvConfigPackageSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: isoDateTimeSchema,
  fields: z.array(createCustomFieldSchema).max(200),
});

function formatPackageIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>, fallbackLabel: string): string {
  return issues
    .slice(0, 3)
    .map((issue) => (issue.path.length > 0 ? issue.path.join(".") : fallbackLabel) + "：" + issue.message)
    .join("；");
}

export function parseEnvConfigPackage(payload: unknown): EnvConfigPackage {
  if (!payload || typeof payload !== "object") throw new Error("环境配置包格式无效");
  const version = (payload as Record<string, unknown>).schemaVersion;
  if (version === 2) {
    const parsed = envConfigPackageSchema.safeParse(payload);
    if (!parsed.success) throw new Error("配置包校验失败：" + formatPackageIssues(parsed.error.issues, "配置包"));
    return parsed.data;
  }
  if (version === 1) {
    const parsed = legacyEnvConfigPackageSchema.safeParse(payload);
    if (!parsed.success) throw new Error("配置包（v1）校验失败：" + formatPackageIssues(parsed.error.issues, "配置包"));
    return {
      schemaVersion: 2,
      exportedAt: parsed.data.exportedAt,
      customFields: parsed.data.fields,
      ownerAccountMappings: [],
      exportTemplates: [],
    };
  }
  throw new Error("环境配置包版本不受支持");
}

export const envConfigActions = ["create", "update", "retire", "delete", "skip", "set_required"] as const;
export const envConfigOptionActions = ["add_option", "retire_option", "update_option"] as const;
export const envConfigGrades = ["safe", "destructive"] as const;
export const envConfigSkipReasons = [
  "key_exists",
  "owner_exists",
  "template_name_exists",
  "select_without_options",
  "required_without_default",
  "missing_field_ref",
  "type_conflict",
] as const;
export const envConfigActionSchema = z.enum(envConfigActions);
export const envConfigOptionActionSchema = z.enum(envConfigOptionActions);
export const envConfigGradeSchema = z.enum(envConfigGrades);
export const envConfigSkipReasonSchema = z.enum(envConfigSkipReasons);

const envConfigPlanItemSchema = z.object({
  action: envConfigActionSchema,
  grade: envConfigGradeSchema,
  reason: envConfigSkipReasonSchema.nullable(),
});

export const envConfigOptionPlanItemSchema = z.object({
  action: envConfigOptionActionSchema,
  grade: envConfigGradeSchema,
  reason: envConfigSkipReasonSchema.nullable(),
  value: z.string(),
  label: z.string(),
});

export const envConfigFieldPlanItemSchema = envConfigPlanItemSchema.extend({
  key: z.string(),
  label: z.string(),
  options: z.array(envConfigOptionPlanItemSchema).optional(),
});

export const envConfigMappingPlanItemSchema = envConfigPlanItemSchema.extend({
  ownerName: z.string(),
  account: z.string(),
});

export const envConfigTemplatePlanItemSchema = envConfigPlanItemSchema.extend({
  name: z.string(),
  sheetName: z.string(),
});

export const envConfigPlanSchema = z.object({
  mode: envConfigImportModeSchema,
  hasDestructiveChanges: z.boolean(),
  sections: z.object({
    customFields: z.array(envConfigFieldPlanItemSchema),
    ownerAccountMappings: z.array(envConfigMappingPlanItemSchema),
    exportTemplates: z.array(envConfigTemplatePlanItemSchema),
  }),
});

export const envConfigImportOutcomes = ["created", "updated", "retired", "deleted", "skipped", "not_selected"] as const;
export const envConfigImportOutcomeSchema = z.enum(envConfigImportOutcomes);

export const envConfigOptionResultItemSchema = envConfigOptionPlanItemSchema.extend({
  outcome: envConfigImportOutcomeSchema,
});

export const envConfigFieldResultItemSchema = envConfigFieldPlanItemSchema.extend({
  outcome: envConfigImportOutcomeSchema,
  options: z.array(envConfigOptionResultItemSchema).optional(),
});

export const envConfigMappingResultItemSchema = envConfigMappingPlanItemSchema.extend({
  outcome: envConfigImportOutcomeSchema,
});

export const envConfigTemplateResultItemSchema = envConfigTemplatePlanItemSchema.extend({
  outcome: envConfigImportOutcomeSchema,
});

export const envConfigImportResultSchema = z.object({
  sections: z.object({
    customFields: z.array(envConfigFieldResultItemSchema),
    ownerAccountMappings: z.array(envConfigMappingResultItemSchema),
    exportTemplates: z.array(envConfigTemplateResultItemSchema),
  }),
});

// 导出查询描述：与统一查询同构，但不接受 limit/cursor——导出从头读取全部命中项。
export const exportWorkPlansQuerySchema = workPlanQueryRequestSchema.omit({ limit: true, cursor: true });
export type ExportWorkPlansQuery = z.infer<typeof exportWorkPlansQuerySchema>;

export const exportWorkPlansXlsSchema = z.object({
  columns: z.array(exportTemplateColumnSchema).min(1).max(100),
  sheetName: z.string().trim().min(1).max(31).regex(/^[^\\/?*\[\]:]+$/).default("工作计划"),
  name: z.string().trim().min(1).max(80).optional(),
  // 旧扁平字段（兼容期保留）；query 存在时以 query 为准。
  q: z.string().max(200).optional(),
  status: workPlanStatusSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  query: exportWorkPlansQuerySchema.optional(),
});

export const importWorkPlansXlsSchema = z.object({
  templateId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255).refine((value) => value.toLocaleLowerCase().endsWith(".xls"), "只支持 .xls 文件"),
  dataBase64: z.string().min(1).max(8_000_000),
});

// ---------- 工作台（Overview）响应契约：成员/计数/顺序由服务端统一产生 ----------

export const workbenchBlockSchema = z.object({
  items: z.array(workPlanSchema),
  total: z.number().int().min(0),
});

export const workbenchOverviewSchema = z.object({
  evaluatedAt: isoDateTimeSchema,
  timeZone: z.string(),
  today: isoDateSchema,
  windowEnd: isoDateSchema,
  startingToday: workbenchBlockSchema,
  continuingToday: workbenchBlockSchema,
  upcoming: workbenchBlockSchema,
  summary: z.object({
    all: z.number().int().min(0),
    pending: z.number().int().min(0),
    inProgress: z.number().int().min(0),
    completed: z.number().int().min(0),
  }),
});

export type WorkbenchBlock = z.infer<typeof workbenchBlockSchema>;
export type WorkbenchOverview = z.infer<typeof workbenchOverviewSchema>;

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
export type MonthlyGoal = z.infer<typeof monthlyGoalSchema>;
export type CreateMonthlyGoal = z.infer<typeof createMonthlyGoalSchema>;
export type UpdateMonthlyGoal = z.infer<typeof updateMonthlyGoalSchema>;
export type MonthlyGoalQuickEdit = z.infer<typeof monthlyGoalQuickEditSchema>;
export type MonthlyGoalQuickEditResult = z.infer<typeof monthlyGoalQuickEditResultSchema>;
export type MonthlyGoalPeriod = z.infer<typeof monthlyGoalPeriodSchema>;
export type MonthlyGoalSeriesFrequency = z.infer<typeof monthlyGoalSeriesFrequencySchema>;
export type MonthlyGoalSeries = z.infer<typeof monthlyGoalSeriesSchema>;
export type MonthlyGoalSeriesInstance = z.infer<typeof monthlyGoalSeriesInstanceSchema>;
export type MonthlyGoalSeriesDetail = z.infer<typeof monthlyGoalSeriesDetailSchema>;
export type CreateMonthlyGoalSeries = z.infer<typeof createMonthlyGoalSeriesSchema>;
export type UpdateMonthlyGoalSeries = z.infer<typeof updateMonthlyGoalSeriesSchema>;
export type MonthlyGoalSeriesDissolveReason = z.infer<typeof monthlyGoalSeriesDissolveReasonSchema>;
export type MonthlyGoalSeriesDissolveInstance = z.infer<typeof monthlyGoalSeriesDissolveInstanceSchema>;
export type MonthlyGoalSeriesDissolvePreview = z.infer<typeof monthlyGoalSeriesDissolvePreviewSchema>;
export type DissolveMonthlyGoalSeries = z.infer<typeof dissolveMonthlyGoalSeriesSchema>;
export type MonthlyGoalSeriesDissolveResult = z.infer<typeof monthlyGoalSeriesDissolveResultSchema>;
export type WorkPlanStatus = z.infer<typeof workPlanStatusSchema>;
export type WorkPlanStatusMode = z.infer<typeof workPlanStatusModeSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type ManageableUserRole = z.infer<typeof manageableUserRoleSchema>;
export type CreateManagedUser = z.infer<typeof createManagedUserSchema>;
export type LoginMode = z.infer<typeof loginModeSchema>;
export type OwnerAccountMapping = z.infer<typeof ownerAccountMappingSchema>;
export type CreateOwnerAccountMapping = z.infer<typeof createOwnerAccountMappingSchema>;
export type UpdateOwnerAccountMapping = z.infer<typeof updateOwnerAccountMappingSchema>;
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;
export type WorkPlanSearch = z.infer<typeof searchWorkPlansSchema>;
export type WorkPlanFilter = z.infer<typeof workPlanFilterSchema>;
export type ReminderType = z.infer<typeof reminderTypeSchema>;
export type ReminderPlan = z.infer<typeof reminderPlanSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type ReminderDay = z.infer<typeof reminderDaySchema>;
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
export type ListRemindersResponse = z.infer<typeof listRemindersResponseSchema>;
export type BarkConfig = z.infer<typeof barkConfigSchema>;
export type UpdateBarkConfig = z.infer<typeof updateBarkConfigSchema>;
export type BarkTestPushResponse = z.infer<typeof barkTestPushResponseSchema>;
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
export type WorkPlanSeries = z.infer<typeof workPlanSeriesSchema>;
export type ExportTemplate = z.infer<typeof exportTemplateSchema>;
export type ExportTemplateColumn = z.infer<typeof exportTemplateColumnSchema>;
export type EnvConfigPackage = z.infer<typeof envConfigPackageSchema>;
export type EnvConfigPackageField = z.infer<typeof envConfigPackageFieldSchema>;
export type EnvConfigImportMode = z.infer<typeof envConfigImportModeSchema>;
export type EnvConfigSection = z.infer<typeof envConfigSectionSchema>;
export type EnvConfigAction = z.infer<typeof envConfigActionSchema>;
export type EnvConfigOptionAction = z.infer<typeof envConfigOptionActionSchema>;
export type EnvConfigOptionPlanItem = z.infer<typeof envConfigOptionPlanItemSchema>;
export type EnvConfigOptionResultItem = z.infer<typeof envConfigOptionResultItemSchema>;
export type EnvConfigGrade = z.infer<typeof envConfigGradeSchema>;
export type EnvConfigSkipReason = z.infer<typeof envConfigSkipReasonSchema>;
export type EnvConfigPlan = z.infer<typeof envConfigPlanSchema>;
export type EnvConfigFieldPlanItem = z.infer<typeof envConfigFieldPlanItemSchema>;
export type EnvConfigMappingPlanItem = z.infer<typeof envConfigMappingPlanItemSchema>;
export type EnvConfigTemplatePlanItem = z.infer<typeof envConfigTemplatePlanItemSchema>;
export type EnvConfigImportOutcome = z.infer<typeof envConfigImportOutcomeSchema>;
export type EnvConfigImportResult = z.infer<typeof envConfigImportResultSchema>;

export function deriveWorkPlanStatus(startAt: string, endAt: string, now = Date.now()): WorkPlanStatus {
  if (now < Date.parse(startAt)) return "pending";
  if (now < Date.parse(endAt)) return "in_progress";
  return "completed";
}

// ---------- 排期顺序与自然文本排序键（票据 08 选定方案的共享实现） ----------

function compareCodePointStrings(a: string, b: string): number {
  // 码点序比较，等价于 UTF-8 字节序 / SQLite BINARY；不能用 JS 字符串 `<`（UTF-16 序）。
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < a.length && rightIndex < b.length) {
    const leftPoint = a.codePointAt(leftIndex) ?? 0;
    const rightPoint = b.codePointAt(rightIndex) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftIndex < a.length) return 1;
  if (rightIndex < b.length) return -1;
  return 0;
}

// 排期顺序：开始升序、结束降序、创建升序、ID 升序；不含重复来源或人工序号。
// 返回值归一化为 -1/0/1。
export type WorkPlanScheduleInput = Pick<WorkPlan, "id" | "startAt" | "endAt" | "createdAt">;

export function compareWorkPlansBySchedule(left: WorkPlanScheduleInput, right: WorkPlanScheduleInput): number {
  const byStart = Date.parse(left.startAt) - Date.parse(right.startAt);
  if (byStart !== 0) return byStart < 0 ? -1 : 1;
  const byEnd = Date.parse(right.endAt) - Date.parse(left.endAt);
  if (byEnd !== 0) return byEnd < 0 ? -1 : 1;
  const byCreated = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (byCreated !== 0) return byCreated < 0 ? -1 : 1;
  return compareCodePointStrings(left.id, right.id);
}

const naturalControlChars = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;
const naturalNumberTag = "\u0001";
const naturalTextTag = "\u0002";
const naturalNumberLengthWidth = 6;

// 规范化：NFKC（全角→半角、组合字符合成）→ 大写折叠 → 剔除控制字符。
export function normalizeTextForSort(input: string): string {
  return input.normalize("NFKC").toUpperCase().replace(naturalControlChars, "");
}

function tokenizeNaturalText(normalized: string): Array<{ isDigit: boolean; text: string }> {
  const runs: Array<{ isDigit: boolean; text: string }> = [];
  let current = "";
  let currentIsDigit: boolean | null = null;
  for (const character of normalized) {
    const isDigit = character >= "0" && character <= "9";
    if (currentIsDigit === null || isDigit === currentIsDigit) {
      current += character;
    } else {
      runs.push({ isDigit: currentIsDigit, text: current });
      current = character;
    }
    currentIsDigit = isDigit;
  }
  if (current !== "") runs.push({ isDigit: currentIsDigit as boolean, text: current });
  return runs;
}

function encodeNaturalNumberRun(run: string): string {
  const stripped = run.replace(/^0+/, "") || "0";
  const length = String(stripped.length).padStart(naturalNumberLengthWidth, "0");
  return naturalNumberTag + length + stripped;
}

// 规范化排序键：数字段按数值、文本段按码点；键的码点序 = 稳定全序，同值并列由排期兜底决定。
export function naturalSortKey(input: string): string {
  const normalized = normalizeTextForSort(input);
  if (normalized === "") return "";
  let key = "";
  for (const run of tokenizeNaturalText(normalized)) {
    key += run.isDigit ? encodeNaturalNumberRun(run.text) : naturalTextTag + run.text;
  }
  return key;
}

// 任意可解析时间（含时区偏移）→ UTC ISO 字符串；不可解析返回 null（视为缺失值）。
export function normalizeDateTimeForSort(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function compareNaturalSortKeys(a: string, b: string): number {
  return compareCodePointStrings(a, b);
}

// 自然文本比较（基于排序键）；数据库侧以同键的 BINARY 比较执行，语义一致。
export function compareNaturalText(a: string, b: string): number {
  return compareCodePointStrings(naturalSortKey(a), naturalSortKey(b));
}

// 状态比较基准：升序 待开始 → 进行中 → 已完成 → 已取消。
export const workPlanStatusOrder: Record<WorkPlanStatus, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  cancelled: 3,
};
