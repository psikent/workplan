import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions } from "fastify";
import { envConfigSections, type EnvConfigPackage } from "@workplan/contracts";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { EnvConfigService } from "../src/modules/env-config.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
type BuiltApp = Awaited<ReturnType<typeof buildApp>>;
const contexts: TestContext[] = [];
const startupApps: BuiltApp[] = [];
const temporaryDataDirs: string[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: config.dataDir ?? createTemporaryDataDir(),
      appSecret: "test-secret-with-at-least-thirty-two-characters",
      appBaseUrl: "http://localhost:3000",
      isProduction: false,
      ...config,
    },
    startScheduler: false,
  });
  const setup = await built.app.inject({
    method: "POST",
    url: "/api/v1/setup",
    payload: {
      token: built.services.auth.setupToken,
      username: "admin",
      password: "very-secure-test-password",
    },
  });
  expect(setup.statusCode).toBe(200);
  const cookieHeader = setup.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
  const context = {
    ...built,
    request: (options: InjectOptions) => built.app.inject({
      ...options,
      headers: {
        cookie,
        ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
        ...options.headers,
      },
    }),
  };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  vi.useRealTimers();
  while (contexts.length) await contexts.pop()!.app.close();
  while (startupApps.length) await startupApps.pop()!.app.close();
  while (temporaryDataDirs.length) fs.rmSync(temporaryDataDirs.pop()!, { recursive: true, force: true });
});

function createTemporaryDataDir(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workplan-env-config-"));
  temporaryDataDirs.push(dataDir);
  return dataDir;
}

async function buildStartupApp(dataDir: string, config: Partial<AppConfig> = {}): Promise<BuiltApp> {
  const built = await buildApp({
    config: {
      dataDir,
      databasePath: path.join(dataDir, "workplan.db"),
      appSecret: "test-secret-with-at-least-thirty-two-characters",
      appBaseUrl: "http://localhost:3000",
      isProduction: false,
      ...config,
    },
    startScheduler: false,
  });
  startupApps.push(built);
  return built;
}

async function closeStartupApp(built: BuiltApp): Promise<void> {
  const index = startupApps.indexOf(built);
  if (index >= 0) startupApps.splice(index, 1);
  await built.app.close();
}

function envConfigOf(context: TestContext): EnvConfigService {
  return context.services.envConfig;
}

function tableCount(context: TestContext, table: string): number {
  return (context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get() as { count: number }).count;
}

// 迁移种子预置了 9 条负责人映射；同步测试先清空，让计划只反映测试自己构造的数据。
function clearDefaultMappings(context: TestContext): void {
  context.database.sqlite.prepare("DELETE FROM owner_account_mappings").run();
}

const planInput = (overrides: Record<string, unknown> = {}) => ({
  title: "环境配置测试计划",
  description: "",
  startAt: new Date(Date.now() + 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 7_200_000).toISOString(),
  customFields: {},
  ...overrides,
});

const legacyPackage = {
  schemaVersion: 1 as const,
  exportedAt: "2026-08-15T00:00:00.000Z",
  fields: [
    {
      key: "legacy_owner",
      label: "旧版负责人",
      description: "来自 v1 文件",
      type: "short_text" as const,
      required: false,
      defaultValue: null,
      options: [],
    },
  ],
};

const emptyPackage: EnvConfigPackage = {
  schemaVersion: 2,
  exportedAt: "2026-08-15T00:00:00.000Z",
  customFields: [],
  ownerAccountMappings: [],
  exportTemplates: [],
};

const autoRestorePackage: EnvConfigPackage = {
  schemaVersion: 2,
  exportedAt: "2026-08-16T00:00:00.000Z",
  customFields: [
    {
      key: "seed_owner",
      label: "种子负责人",
      description: "从开发种子恢复",
      type: "short_text",
      required: false,
      defaultValue: null,
      options: [],
      sortOrder: 0,
    },
  ],
  ownerAccountMappings: [{ ownerName: "种子负责人", account: "seed.owner@example.com" }],
  exportTemplates: [
    {
      name: "种子模板",
      sheetName: "工作计划",
      columns: [{ source: "title", header: "工作内容" }],
    },
  ],
};

describe("development Environment Configuration Package auto-restore", () => {
  it("restores all three empty sections from the development seed file on startup", async () => {
    const dataDir = createTemporaryDataDir();
    const preparation = await buildStartupApp(dataDir);
    for (const mapping of preparation.services.ownerAccounts.list()) {
      preparation.services.ownerAccounts.delete(mapping.ownerName);
    }
    await closeStartupApp(preparation);
    fs.writeFileSync(path.join(dataDir, "env-config.seed.json"), JSON.stringify(autoRestorePackage), "utf8");

    const restored = await buildStartupApp(dataDir);
    const exported = restored.services.envConfig.exportPackage();

    expect(exported.customFields).toEqual(autoRestorePackage.customFields);
    expect(exported.ownerAccountMappings).toEqual(autoRestorePackage.ownerAccountMappings);
    expect(exported.exportTemplates).toEqual(autoRestorePackage.exportTemplates);
  });

  it("leaves a non-empty section untouched while restoring the empty sections", async () => {
    const dataDir = createTemporaryDataDir();
    const preparation = await buildStartupApp(dataDir);
    preparation.services.customFields.create({
      key: "local_field",
      label: "本地字段",
      description: "不得被种子区段补充",
      type: "short_text",
      required: false,
      defaultValue: null,
      options: [],
    });
    for (const mapping of preparation.services.ownerAccounts.list()) {
      preparation.services.ownerAccounts.delete(mapping.ownerName);
    }
    await closeStartupApp(preparation);
    fs.writeFileSync(path.join(dataDir, "env-config.seed.json"), JSON.stringify(autoRestorePackage), "utf8");

    const restored = await buildStartupApp(dataDir);
    const exported = restored.services.envConfig.exportPackage();

    expect(exported.customFields.map((field) => field.key)).toEqual(["local_field"]);
    expect(exported.ownerAccountMappings).toEqual(autoRestorePackage.ownerAccountMappings);
    expect(exported.exportTemplates).toEqual(autoRestorePackage.exportTemplates);
  });

  it("never restores the seed file in production", async () => {
    const dataDir = createTemporaryDataDir();
    const preparation = await buildStartupApp(dataDir);
    for (const mapping of preparation.services.ownerAccounts.list()) {
      preparation.services.ownerAccounts.delete(mapping.ownerName);
    }
    await closeStartupApp(preparation);
    fs.writeFileSync(path.join(dataDir, "env-config.seed.json"), JSON.stringify(autoRestorePackage), "utf8");

    const production = await buildStartupApp(dataDir, { isProduction: true });
    const exported = production.services.envConfig.exportPackage();

    expect(exported.customFields).toEqual([]);
    expect(exported.ownerAccountMappings).toEqual([]);
    expect(exported.exportTemplates).toEqual([]);
  });

  it("starts without importing anything when the seed file is malformed", async () => {
    const dataDir = createTemporaryDataDir();
    fs.writeFileSync(path.join(dataDir, "env-config.seed.json"), "{not-json", "utf8");

    const started = await buildStartupApp(dataDir, { databasePath: ":memory:" });
    const exported = started.services.envConfig.exportPackage();

    expect(exported.customFields).toEqual([]);
    expect(exported.ownerAccountMappings).not.toContainEqual(autoRestorePackage.ownerAccountMappings[0]);
    expect(exported.exportTemplates).toEqual([]);
  });

  it("does nothing when the development seed file is missing", async () => {
    const dataDir = createTemporaryDataDir();

    const started = await buildStartupApp(dataDir, { databasePath: ":memory:" });
    const exported = started.services.envConfig.exportPackage();

    expect(exported.customFields).toEqual([]);
    expect(exported.ownerAccountMappings).not.toContainEqual(autoRestorePackage.ownerAccountMappings[0]);
    expect(exported.exportTemplates).toEqual([]);
  });

  it("is idempotent across repeated development startups", async () => {
    const dataDir = createTemporaryDataDir();
    const preparation = await buildStartupApp(dataDir);
    for (const mapping of preparation.services.ownerAccounts.list()) {
      preparation.services.ownerAccounts.delete(mapping.ownerName);
    }
    await closeStartupApp(preparation);
    fs.writeFileSync(path.join(dataDir, "env-config.seed.json"), JSON.stringify(autoRestorePackage), "utf8");

    const firstStartup = await buildStartupApp(dataDir);
    const afterFirstStartup = firstStartup.services.envConfig.exportPackage();
    await closeStartupApp(firstStartup);
    const secondStartup = await buildStartupApp(dataDir);
    const afterSecondStartup = secondStartup.services.envConfig.exportPackage();

    expect(afterSecondStartup.customFields).toEqual(afterFirstStartup.customFields);
    expect(afterSecondStartup.ownerAccountMappings).toEqual(afterFirstStartup.ownerAccountMappings);
    expect(afterSecondStartup.exportTemplates).toEqual(afterFirstStartup.exportTemplates);
  });
});

// 在源环境中建立三个区段各一个可导出的定义。
async function seedDefinitions(context: TestContext) {
  const field = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key: "owner",
      label: "工作负责人",
      description: "",
      type: "single_select",
      required: false,
      defaultValue: null,
      options: [
        { value: "fengmingqian", label: "冯铭倩" },
        { value: "linyaqian", label: "林雅茜" },
      ],
    },
  });
  expect(field.statusCode).toBe(201);
  const mapping = await context.request({
    method: "POST",
    url: "/api/v1/owner-account-mappings",
    payload: { ownerName: "测试负责人", account: "test.owner@example.com" },
  });
  expect(mapping.statusCode).toBe(201);
  const template = await context.request({
    method: "POST",
    url: "/api/v1/export-templates",
    payload: {
      name: "排程模板",
      sheetName: "排程",
      columns: [
        { source: "title", header: "工作内容" },
        { source: "custom:owner", header: "工作负责人" },
        { source: "startAt", header: "开始时间" },
      ],
    },
  });
  expect(template.statusCode).toBe(201);
}

describe("EnvConfigService", () => {
  it("exports all three sections and additively imports them into an empty environment", async () => {
    const source = await createContext();
    await seedDefinitions(source);
    const exported = envConfigOf(source).exportPackage();
    expect(exported.schemaVersion).toBe(2);
    expect(exported.customFields).toEqual([
      expect.objectContaining({
        key: "owner",
        label: "工作负责人",
        type: "single_select",
        required: false,
        options: [
          { value: "fengmingqian", label: "冯铭倩" },
          { value: "linyaqian", label: "林雅茜" },
        ],
        sortOrder: 0,
      }),
    ]);
    expect(exported.ownerAccountMappings).toContainEqual({ ownerName: "测试负责人", account: "test.owner@example.com" });
    expect(exported.exportTemplates).toEqual([
      {
        name: "排程模板",
        sheetName: "排程",
        columns: [
          { source: "title", header: "工作内容" },
          { source: "custom:owner", header: "工作负责人" },
          { source: "startAt", header: "开始时间" },
        ],
      },
    ]);

    const target = await createContext();
    const plan = envConfigOf(target).validate(exported, "additive");
    expect(plan.mode).toBe("additive");
    expect(plan.hasDestructiveChanges).toBe(false);
    expect(plan.sections.customFields).toEqual([expect.objectContaining({ key: "owner", action: "create", grade: "safe", reason: null })]);
    expect(plan.sections.ownerAccountMappings.find((item) => item.ownerName === "测试负责人")).toMatchObject({
      action: "create",
      grade: "safe",
      reason: null,
    });
    expect(plan.sections.ownerAccountMappings.filter((item) => item.action === "skip")).toHaveLength(9);
    expect(plan.sections.exportTemplates).toEqual([expect.objectContaining({ name: "排程模板", action: "create", grade: "safe", reason: null })]);

    const result = envConfigOf(target).importAdditive(exported, [...envConfigSections]);
    expect(result.sections.customFields).toEqual([expect.objectContaining({ key: "owner", outcome: "created" })]);
    expect(result.sections.ownerAccountMappings.find((item) => item.ownerName === "测试负责人")?.outcome).toBe("created");
    expect(result.sections.ownerAccountMappings.filter((item) => item.outcome === "skipped")).toHaveLength(9);
    expect(result.sections.exportTemplates).toEqual([expect.objectContaining({ name: "排程模板", outcome: "created" })]);

    const fields = await target.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json<Array<{ key: string; label: string; options: Array<{ value: string }> }>>()).toMatchObject([
      { key: "owner", label: "工作负责人", options: [{ value: "fengmingqian" }, { value: "linyaqian" }] },
    ]);
    const mappings = await target.request({ method: "GET", url: "/api/v1/owner-account-mappings" });
    expect(mappings.json()).toContainEqual({ ownerName: "测试负责人", account: "test.owner@example.com" });
    const templates = await target.request({ method: "GET", url: "/api/v1/export-templates" });
    expect(templates.json()).toContainEqual(expect.objectContaining({ name: "排程模板", sheetName: "排程" }));
  });

  it("imports the same package twice, importing nothing on the second run with correct skip reasons", async () => {
    const source = await createContext();
    await seedDefinitions(source);
    const exported = envConfigOf(source).exportPackage();

    const target = await createContext();
    const first = envConfigOf(target).importAdditive(exported, [...envConfigSections]);
    expect(first.sections.customFields.every((item) => item.outcome === "created")).toBe(true);
    const fieldsAfterFirst = tableCount(target, "custom_field_definitions");
    const mappingsAfterFirst = tableCount(target, "owner_account_mappings");
    const templatesAfterFirst = tableCount(target, "export_templates");

    const second = envConfigOf(target).importAdditive(exported, [...envConfigSections]);
    expect(second.sections.customFields).toEqual([
      expect.objectContaining({ key: "owner", action: "skip", grade: "safe", reason: "key_exists", outcome: "skipped" }),
    ]);
    expect(second.sections.ownerAccountMappings.length).toBeGreaterThan(0);
    expect(second.sections.ownerAccountMappings.every((item) => item.action === "skip" && item.reason === "owner_exists" && item.outcome === "skipped")).toBe(true);
    expect(second.sections.exportTemplates).toEqual([
      expect.objectContaining({ name: "排程模板", action: "skip", grade: "safe", reason: "template_name_exists", outcome: "skipped" }),
    ]);

    expect(tableCount(target, "custom_field_definitions")).toBe(fieldsAfterFirst);
    expect(tableCount(target, "owner_account_mappings")).toBe(mappingsAfterFirst);
    expect(tableCount(target, "export_templates")).toBe(templatesAfterFirst);
  });

  it("imports a version 1 template file as a fields-only package", async () => {
    const context = await createContext();
    const v1 = {
      schemaVersion: 1,
      exportedAt: "2027-08-08T00:00:00.000Z",
      fields: [
        { key: "priority_old", label: "优先级", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
      ],
    };

    const plan = envConfigOf(context).validate(v1, "additive");
    expect(plan.sections.customFields).toEqual([
      expect.objectContaining({ key: "priority_old", action: "create", grade: "safe", reason: null }),
    ]);
    expect(plan.sections.ownerAccountMappings).toEqual([]);
    expect(plan.sections.exportTemplates).toEqual([]);

    const result = envConfigOf(context).importAdditive(v1, [...envConfigSections]);
    expect(result.sections.customFields).toEqual([expect.objectContaining({ key: "priority_old", outcome: "created" })]);
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toMatchObject([{ key: "priority_old", label: "优先级" }]);
  });

  it("skips a template referencing a package-only custom field when the field section is not imported", async () => {
    const source = await createContext();
    await seedDefinitions(source);
    const exported = envConfigOf(source).exportPackage();

    const target = await createContext();
    const plan = envConfigOf(target).validate(exported, "additive");
    expect(plan.sections.exportTemplates[0]).toMatchObject({ action: "create", grade: "safe", reason: null });

    const partial = envConfigOf(target).importAdditive(exported, ["ownerAccountMappings", "exportTemplates"]);
    expect(partial.sections.customFields).toEqual([expect.objectContaining({ key: "owner", action: "create", outcome: "not_selected" })]);
    expect(partial.sections.exportTemplates).toEqual([
      expect.objectContaining({ name: "排程模板", action: "skip", grade: "safe", reason: "missing_field_ref", outcome: "skipped" }),
    ]);
    expect(tableCount(target, "custom_field_definitions")).toBe(0);
    expect(tableCount(target, "export_templates")).toBe(0);

    const complete = envConfigOf(target).importAdditive(exported, [...envConfigSections]);
    expect(complete.sections.exportTemplates).toEqual([expect.objectContaining({ name: "排程模板", outcome: "created" })]);
    expect(tableCount(target, "custom_field_definitions")).toBe(1);
    expect(tableCount(target, "export_templates")).toBe(1);
  });

  it("imports package fields without sortOrder at their array position", async () => {
    const context = await createContext();
    const pkg: EnvConfigPackage = {
      schemaVersion: 2,
      exportedAt: "2027-08-08T00:00:00.000Z",
      customFields: [
        { key: "first_field", label: "第一个字段", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
        { key: "second_field", label: "第二个字段", description: "", type: "short_text", required: false, defaultValue: null, options: [], sortOrder: 3 },
      ],
      ownerAccountMappings: [],
      exportTemplates: [],
    };
    const result = envConfigOf(context).importAdditive(pkg, [...envConfigSections]);
    expect(result.sections.customFields.every((item) => item.outcome === "created")).toBe(true);
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toMatchObject([
      { key: "first_field", sortOrder: 0 },
      { key: "second_field", sortOrder: 3 },
    ]);
  });

  it("skips fields without options or a required default with the correct reasons", async () => {
    const context = await createContext();
    const plan = await context.request({ method: "POST", url: "/api/v1/work-plans", payload: planInput() });
    expect(plan.statusCode).toBe(201);
    const pkg: EnvConfigPackage = {
      schemaVersion: 2,
      exportedAt: "2027-08-08T00:00:00.000Z",
      customFields: [
        { key: "bad_select", label: "空选项单选", description: "", type: "single_select", required: false, defaultValue: null, options: [] },
        { key: "bad_required", label: "无默认值必填", description: "", type: "short_text", required: true, defaultValue: null, options: [] },
      ],
      ownerAccountMappings: [],
      exportTemplates: [],
    };

    const validation = envConfigOf(context).validate(pkg, "additive");
    expect(validation.sections.customFields).toMatchObject([
      { key: "bad_select", action: "skip", reason: "select_without_options" },
      { key: "bad_required", action: "skip", reason: "required_without_default" },
    ]);

    const result = envConfigOf(context).importAdditive(pkg, [...envConfigSections]);
    expect(result.sections.customFields).toMatchObject([
      { outcome: "skipped", reason: "select_without_options" },
      { outcome: "skipped", reason: "required_without_default" },
    ]);
    expect(tableCount(context, "custom_field_definitions")).toBe(0);
  });

  it("exports only active fields and options", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "owner",
        label: "工作负责人",
        description: "",
        type: "single_select",
        required: false,
        defaultValue: null,
        options: [
          { value: "fengmingqian", label: "冯铭倩" },
          { value: "linyaqian", label: "林雅茜" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const field = created.json<{ id: string; options: Array<{ id: string; version: number }> }>();
    const archivedOption = await context.request({
      method: "PATCH",
      url: "/api/v1/custom-field-options/" + field.options[1]!.id,
      payload: { archived: true, version: field.options[1]!.version },
    });
    expect(archivedOption.statusCode).toBe(200);
    const extra = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "archived_soon", label: "即将归档", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
    });
    expect(extra.statusCode).toBe(201);
    const extraId = extra.json<{ id: string; version: number }>().id;
    const archivedField = await context.request({
      method: "PATCH",
      url: "/api/v1/custom-fields/" + extraId,
      payload: { archived: true, version: extra.json<{ id: string; version: number }>().version },
    });
    expect(archivedField.statusCode).toBe(200);

    const exported = envConfigOf(context).exportPackage();
    expect(exported.customFields).toEqual([
      expect.objectContaining({
        key: "owner",
        options: [{ value: "fengmingqian", label: "冯铭倩" }],
      }),
    ]);
    expect(exported.customFields.some((item) => item.key === "archived_soon")).toBe(false);
  });

  it("rejects invalid packages with problem-detail style errors", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const service = envConfigOf(context);

    for (const payload of [null, {}, { schemaVersion: 3, exportedAt: "2027-08-08T00:00:00.000Z" }, { schemaVersion: 2, exportedAt: "2027-08-08T00:00:00.000Z" }]) {
      expect(() => service.validate(payload, "additive")).toThrowError(AppError);
      expect(() => service.importAdditive(payload, [...envConfigSections])).toThrowError(AppError);
    }

    try {
      service.validate({}, "additive");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    }

    const validPackage: EnvConfigPackage = {
      schemaVersion: 2,
      exportedAt: "2027-08-08T00:00:00.000Z",
      customFields: [],
      ownerAccountMappings: [],
      exportTemplates: [],
    };
    const syncPlan = service.validate(validPackage, "sync");
    expect(syncPlan.mode).toBe("sync");
    expect(syncPlan.hasDestructiveChanges).toBe(false);
    expect(syncPlan.sections.customFields).toEqual([]);
    expect(syncPlan.sections.ownerAccountMappings).toEqual([]);
    expect(syncPlan.sections.exportTemplates).toEqual([]);
  });
});

function syncPackage(overrides: Partial<EnvConfigPackage> = {}): EnvConfigPackage {
  return {
    schemaVersion: 2,
    exportedAt: "2027-08-08T00:00:00.000Z",
    customFields: [],
    ownerAccountMappings: [],
    exportTemplates: [],
    ...overrides,
  };
}

describe("EnvConfigService sync import", () => {
  it("converges a drifted database to match the package; re-export equals the package", async () => {
    const pkg = syncPackage({
      customFields: [
        {
          key: "owner",
          label: "工作负责人",
          description: "",
          type: "single_select",
          required: false,
          defaultValue: null,
          options: [
            { value: "fengmingqian", label: "冯铭倩" },
            { value: "linyaqian", label: "林雅茜" },
            { value: "wangmeng", label: "王萌" },
          ],
          sortOrder: 0,
        },
        {
          key: "notes",
          label: "备注",
          description: "补充说明",
          type: "short_text",
          required: false,
          defaultValue: null,
          options: [],
          sortOrder: 1,
        },
      ],
      ownerAccountMappings: [{ ownerName: "测试负责人", account: "test.owner@example.com" }],
      exportTemplates: [
        {
          name: "排程模板",
          sheetName: "排程",
          columns: [
            { source: "title", header: "工作内容" },
            { source: "custom:owner", header: "工作负责人" },
            { source: "startAt", header: "开始时间" },
          ],
        },
      ],
    });
    const drifted: EnvConfigPackage = JSON.parse(JSON.stringify(pkg)) as EnvConfigPackage;
    drifted.customFields[0]!.label = "工作负责人旧";
    drifted.customFields[0]!.description = "旧描述";
    drifted.customFields[0]!.sortOrder = 7;
    drifted.customFields[0]!.defaultValue = "fengmingqian";
    drifted.customFields[0]!.options = [
      { value: "fengmingqian", label: "冯铭倩" },
      { value: "linyaqian", label: "林雅茜旧" },
      { value: "zhouyi", label: "周怡" },
    ];
    drifted.customFields = drifted.customFields.filter((field) => field.key !== "notes");
    drifted.customFields.push({ key: "priority", label: "优先级", description: "", type: "short_text", required: false, defaultValue: null, options: [] });
    drifted.ownerAccountMappings[0]!.account = "drifted.owner@example.com";
    drifted.ownerAccountMappings.push({ ownerName: "多余负责人", account: "extra.owner@example.com" });
    drifted.exportTemplates[0]!.sheetName = "旧排程";
    drifted.exportTemplates[0]!.columns = [{ source: "title", header: "旧工作内容" }];
    drifted.exportTemplates.push({ name: "多余模板", sheetName: "多余", columns: [{ source: "title", header: "工作内容" }] });

    const target = await createContext();
    clearDefaultMappings(target);
    const seeded = envConfigOf(target).importAdditive(drifted, [...envConfigSections]);
    expect(seeded.sections.customFields.every((item) => item.outcome === "created")).toBe(true);
    expect(tableCount(target, "custom_field_definitions")).toBe(2);

    const plan = envConfigOf(target).validate(pkg, "sync");
    expect(plan.mode).toBe("sync");
    expect(plan.hasDestructiveChanges).toBe(true);
    expect(plan.sections.customFields.map((item) => [item.key, item.action])).toEqual([
      ["owner", "update"],
      ["notes", "create"],
      ["priority", "retire"],
    ]);
    expect(plan.sections.customFields[0]!.options).toEqual([
      { action: "update_option", grade: "safe", reason: null, value: "linyaqian", label: "林雅茜" },
      { action: "add_option", grade: "safe", reason: null, value: "wangmeng", label: "王萌" },
      { action: "retire_option", grade: "destructive", reason: null, value: "zhouyi", label: "周怡" },
    ]);
    expect(plan.sections.ownerAccountMappings.map((item) => [item.ownerName, item.action])).toEqual([
      ["测试负责人", "update"],
      ["多余负责人", "delete"],
    ]);
    expect(plan.sections.exportTemplates.map((item) => [item.name, item.action])).toEqual([
      ["排程模板", "update"],
      ["多余模板", "delete"],
    ]);

    const result = envConfigOf(target).importSync(pkg, { sections: [...envConfigSections], confirmDestructive: true });
    expect(result.sections.customFields.map((item) => [item.key, item.outcome])).toEqual([
      ["owner", "updated"],
      ["notes", "created"],
      ["priority", "retired"],
    ]);
    expect(result.sections.customFields[0]!.options).toEqual([
      { action: "update_option", grade: "safe", reason: null, value: "linyaqian", label: "林雅茜", outcome: "updated" },
      { action: "add_option", grade: "safe", reason: null, value: "wangmeng", label: "王萌", outcome: "created" },
      { action: "retire_option", grade: "destructive", reason: null, value: "zhouyi", label: "周怡", outcome: "retired" },
    ]);
    expect(result.sections.ownerAccountMappings.map((item) => [item.ownerName, item.outcome])).toEqual([
      ["测试负责人", "updated"],
      ["多余负责人", "deleted"],
    ]);
    expect(result.sections.exportTemplates.map((item) => [item.name, item.outcome])).toEqual([
      ["排程模板", "updated"],
      ["多余模板", "deleted"],
    ]);

    const reExported = envConfigOf(target).exportPackage();
    expect(reExported.customFields).toEqual(pkg.customFields);
    expect(reExported.ownerAccountMappings).toEqual(pkg.ownerAccountMappings);
    expect(reExported.exportTemplates).toEqual(pkg.exportTemplates);

    const retiredRow = target.database.sqlite.prepare("SELECT archived_at AS archivedAt FROM custom_field_definitions WHERE key = 'priority'").get() as { archivedAt: string | null };
    expect(retiredRow.archivedAt).not.toBeNull();
  });

  it("archives a local field absent from the package and preserves its stored values", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const field = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "legacy_note", label: "旧备注", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
    });
    expect(field.statusCode).toBe(201);
    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: { ...planInput(), customFields: { legacy_note: "保留我" } },
    });
    expect(created.statusCode).toBe(201);

    const pkg = syncPackage();
    const service = envConfigOf(context);
    const preview = service.validate(pkg, "sync");
    expect(preview.sections.customFields).toEqual([
      { action: "retire", grade: "destructive", reason: null, key: "legacy_note", label: "旧备注" },
    ]);
    expect(preview.hasDestructiveChanges).toBe(true);

    const result = service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: true });
    expect(result.sections.customFields).toEqual([
      { action: "retire", grade: "destructive", reason: null, key: "legacy_note", label: "旧备注", outcome: "retired" },
    ]);

    const row = context.database.sqlite.prepare("SELECT archived_at AS archivedAt FROM custom_field_definitions WHERE key = 'legacy_note'").get() as { archivedAt: string | null };
    expect(row.archivedAt).not.toBeNull();
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toEqual([]);
    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans" });
    expect(plans.json<Array<{ customFields: Record<string, unknown> }>>()[0]!.customFields.legacy_note).toBe("保留我");
  });

  it("retires an option absent from the package without deleting values that reference it", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const field = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "status_cf",
        label: "自定义状态",
        description: "",
        type: "single_select",
        required: false,
        defaultValue: null,
        options: [
          { value: "doing", label: "进行中" },
          { value: "done", label: "完成" },
        ],
      },
    });
    expect(field.statusCode).toBe(201);
    const created = await context.request({
      method: "POST",
      url: "/api/v1/work-plans",
      payload: { ...planInput(), customFields: { status_cf: "doing" } },
    });
    expect(created.statusCode).toBe(201);

    const pkg = syncPackage({
      customFields: [
        {
          key: "status_cf",
          label: "自定义状态",
          description: "",
          type: "single_select",
          required: false,
          defaultValue: null,
          options: [{ value: "done", label: "完成" }],
          sortOrder: 0,
        },
      ],
    });
    const service = envConfigOf(context);
    const preview = service.validate(pkg, "sync");
    expect(preview.sections.customFields[0]).toMatchObject({ key: "status_cf", action: "update", grade: "safe", reason: null });
    expect(preview.sections.customFields[0]!.options).toEqual([
      { action: "retire_option", grade: "destructive", reason: null, value: "doing", label: "进行中" },
    ]);
    expect(preview.hasDestructiveChanges).toBe(true);

    const result = service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: true });
    expect(result.sections.customFields[0]!.options).toEqual([
      { action: "retire_option", grade: "destructive", reason: null, value: "doing", label: "进行中", outcome: "retired" },
    ]);

    const optionRow = context.database.sqlite.prepare("SELECT archived_at AS archivedAt FROM custom_field_options WHERE value = 'doing'").get() as { archivedAt: string | null };
    expect(optionRow.archivedAt).not.toBeNull();
    const plans = await context.request({ method: "GET", url: "/api/v1/work-plans" });
    expect(plans.json<Array<{ customFields: Record<string, unknown> }>>()[0]!.customFields.status_cf).toBe("doing");
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json<Array<{ options: Array<{ value: string; archivedAt: string | null }> }>>()[0]!.options.filter((option) => !option.archivedAt).map((option) => option.value)).toEqual(["done"]);
  });

  it("reports type conflicts as destructive skips and leaves the field unchanged", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const field = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "memo", label: "备忘录", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
    });
    expect(field.statusCode).toBe(201);

    const pkg = syncPackage({
      customFields: [
        { key: "memo", label: "备忘录新", description: "", type: "long_text", required: false, defaultValue: null, options: [], sortOrder: 0 },
      ],
    });
    const service = envConfigOf(context);
    const preview = service.validate(pkg, "sync");
    expect(preview.sections.customFields).toEqual([
      { action: "skip", grade: "destructive", reason: "type_conflict", key: "memo", label: "备忘录新" },
    ]);
    expect(preview.hasDestructiveChanges).toBe(true);

    expect(() => service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: false })).toThrowError(/破坏性/);

    const result = service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: true });
    expect(result.sections.customFields).toEqual([
      { action: "skip", grade: "destructive", reason: "type_conflict", key: "memo", label: "备忘录新", outcome: "skipped" },
    ]);

    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toMatchObject([{ key: "memo", label: "备忘录", type: "short_text" }]);
  });

  it("rejects sync with destructive changes unless confirmDestructive is set", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const mapping = await context.request({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      payload: { ownerName: "遗留负责人", account: "legacy.owner@example.com" },
    });
    expect(mapping.statusCode).toBe(201);

    const pkg = syncPackage();
    const service = envConfigOf(context);
    expect(() => service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: false })).toThrowError(AppError);
    const result = service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: true });
    expect(result.sections.ownerAccountMappings).toEqual([
      { action: "delete", grade: "destructive", reason: null, ownerName: "遗留负责人", account: "legacy.owner@example.com", outcome: "deleted" },
    ]);
    expect(tableCount(context, "owner_account_mappings")).toBe(0);
  });

  it("deletes mappings and templates absent from the package", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const mapping = await context.request({
      method: "POST",
      url: "/api/v1/owner-account-mappings",
      payload: { ownerName: "遗留负责人", account: "legacy.owner@example.com" },
    });
    expect(mapping.statusCode).toBe(201);
    const template = await context.request({
      method: "POST",
      url: "/api/v1/export-templates",
      payload: { name: "遗留模板", sheetName: "遗留", columns: [{ source: "title", header: "工作内容" }] },
    });
    expect(template.statusCode).toBe(201);

    const pkg = syncPackage({
      ownerAccountMappings: [{ ownerName: "新负责人", account: "new.owner@example.com" }],
    });
    const service = envConfigOf(context);
    const preview = service.validate(pkg, "sync");
    expect(preview.sections.ownerAccountMappings.map((item) => [item.ownerName, item.action])).toEqual([
      ["新负责人", "create"],
      ["遗留负责人", "delete"],
    ]);
    expect(preview.sections.exportTemplates).toEqual([
      { action: "delete", grade: "destructive", reason: null, name: "遗留模板", sheetName: "遗留" },
    ]);

    const result = service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: true });
    expect(result.sections.ownerAccountMappings.map((item) => [item.ownerName, item.outcome])).toEqual([
      ["新负责人", "created"],
      ["遗留负责人", "deleted"],
    ]);
    expect(tableCount(context, "owner_account_mappings")).toBe(1);
    expect(tableCount(context, "export_templates")).toBe(0);
  });

  it("honours section selection in sync mode", async () => {
    const source = await createContext();
    clearDefaultMappings(source);
    await seedDefinitions(source);
    const exported = envConfigOf(source).exportPackage();

    const target = await createContext();
    clearDefaultMappings(target);
    const drifted: EnvConfigPackage = JSON.parse(JSON.stringify(exported)) as EnvConfigPackage;
    drifted.customFields[0]!.label = "工作负责人旧";
    drifted.customFields.push({ key: "extra_field", label: "多余字段", description: "", type: "short_text", required: false, defaultValue: null, options: [] });
    drifted.ownerAccountMappings.push({ ownerName: "多余负责人", account: "extra.owner@example.com" });
    drifted.exportTemplates.push({ name: "多余模板", sheetName: "多余", columns: [{ source: "title", header: "工作内容" }] });
    const seeded = envConfigOf(target).importAdditive(drifted, [...envConfigSections]);
    expect(seeded.sections.customFields.every((item) => item.outcome === "created")).toBe(true);

    const result = envConfigOf(target).importSync(exported, { sections: ["customFields"], confirmDestructive: true });
    expect(result.sections.customFields.map((item) => [item.key, item.outcome])).toEqual([
      ["owner", "updated"],
      ["extra_field", "retired"],
    ]);
    expect(result.sections.ownerAccountMappings.map((item) => [item.ownerName, item.outcome])).toEqual([
      ["多余负责人", "not_selected"],
    ]);
    expect(result.sections.exportTemplates.map((item) => [item.name, item.outcome])).toEqual([
      ["多余模板", "not_selected"],
    ]);

    const fields = await target.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toMatchObject([{ key: "owner", label: "工作负责人" }]);
    expect(tableCount(target, "owner_account_mappings")).toBe(2);
    expect(tableCount(target, "export_templates")).toBe(2);
  });

  it("applies a sync plan with only safe changes without confirmation", async () => {
    const context = await createContext();
    clearDefaultMappings(context);
    const field = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "safe_field", label: "旧标签", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
    });
    expect(field.statusCode).toBe(201);

    const pkg = syncPackage({
      customFields: [
        { key: "safe_field", label: "新标签", description: "新描述", type: "short_text", required: false, defaultValue: null, options: [], sortOrder: 0 },
      ],
    });
    const service = envConfigOf(context);
    const preview = service.validate(pkg, "sync");
    expect(preview.hasDestructiveChanges).toBe(false);
    expect(preview.sections.customFields).toEqual([
      { action: "update", grade: "safe", reason: null, key: "safe_field", label: "新标签" },
    ]);

    const result = service.importSync(pkg, { sections: [...envConfigSections], confirmDestructive: false });
    expect(result.sections.customFields).toEqual([
      { action: "update", grade: "safe", reason: null, key: "safe_field", label: "新标签", outcome: "updated" },
    ]);
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toMatchObject([{ key: "safe_field", label: "新标签", description: "新描述" }]);
  });
});

describe("Environment Configuration Package HTTP API", () => {
  it("allows only an Administrator to export the package", async () => {
    const context = await createContext();
    const createdEditor = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "env-config-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "环境配置权限测试",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createdEditor.statusCode).toBe(201);
    const editorToken = createdEditor.json<{ accessToken: { token: string } }>().accessToken.token;

    const unauthenticated = await context.app.inject({ method: "GET", url: "/api/v1/env-config" });
    const editor = await context.app.inject({
      method: "GET",
      url: "/api/v1/env-config",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    const administrator = await context.request({ method: "GET", url: "/api/v1/env-config" });

    expect(unauthenticated.statusCode).toBe(401);
    expect(editor.statusCode).toBe(403);
    expect(editor.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
    expect(administrator.statusCode).toBe(200);
    expect(administrator.json()).toMatchObject({
      schemaVersion: 2,
      customFields: [],
      exportTemplates: [],
    });
  });

  it("protects download, validation and import as Administrator-only endpoints", async () => {
    const context = await createContext();
    const createdEditor = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        username: "env-config-route-editor",
        role: "editor",
        loginMode: "token",
        tokenName: "环境配置路由权限测试",
        tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createdEditor.statusCode).toBe(201);
    const editorToken = createdEditor.json<{ accessToken: { token: string } }>().accessToken.token;
    const requests: InjectOptions[] = [
      { method: "GET", url: "/api/v1/env-config/file" },
      { method: "POST", url: "/api/v1/env-config/validate", payload: { package: emptyPackage } },
      {
        method: "POST",
        url: "/api/v1/env-config/import",
        payload: { package: emptyPackage, mode: "additive", sections: [], confirmDestructive: false },
      },
    ];

    for (const request of requests) {
      const unauthenticated = await context.app.inject(request);
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json<{ code: string }>().code).toBe("AUTHENTICATION_REQUIRED");

      const editor = await context.app.inject({
        ...request,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(editor.statusCode).toBe(403);
      expect(editor.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");

      const administrator = await context.request(request);
      expect(administrator.statusCode).toBe(200);
    }
  });

  it("returns stable problem details for an invalid package", async () => {
    const context = await createContext();
    const invalidPackage = { schemaVersion: 99 };
    const requests: InjectOptions[] = [
      {
        method: "POST",
        url: "/api/v1/env-config/validate",
        payload: { package: invalidPackage, mode: "additive", sections: [...envConfigSections] },
      },
      {
        method: "POST",
        url: "/api/v1/env-config/import",
        payload: {
          package: invalidPackage,
          mode: "additive",
          sections: [...envConfigSections],
          confirmDestructive: false,
        },
      },
    ];

    for (const request of requests) {
      const response = await context.request(request);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        type: "https://workplan.local/problems/validation_error",
        title: "VALIDATION_ERROR",
        status: 422,
        code: "VALIDATION_ERROR",
        detail: "环境配置包版本不受支持",
      });
    }
  });

  it("forwards Sync Import section selection and destructive confirmation", async () => {
    const context = await createContext();
    const created = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "local_only",
        label: "仅本地字段",
        description: "",
        type: "short_text",
        required: false,
        defaultValue: null,
        options: [],
      },
    });
    expect(created.statusCode).toBe(201);
    const payload = {
      package: emptyPackage,
      mode: "sync",
      sections: ["customFields"],
      confirmDestructive: false,
    };

    const unconfirmed = await context.request({
      method: "POST",
      url: "/api/v1/env-config/import",
      payload,
    });
    expect(unconfirmed.statusCode).toBe(422);
    expect(unconfirmed.json<{ code: string }>().code).toBe("VALIDATION_ERROR");

    const confirmed = await context.request({
      method: "POST",
      url: "/api/v1/env-config/import",
      payload: { ...payload, confirmDestructive: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      sections: {
        customFields: [{ key: "local_only", action: "retire", grade: "destructive", outcome: "retired" }],
        ownerAccountMappings: expect.arrayContaining([
          expect.objectContaining({ outcome: "not_selected" }),
        ]),
        exportTemplates: [],
      },
    });
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toEqual([]);
    const mappings = await context.request({ method: "GET", url: "/api/v1/owner-account-mappings" });
    expect(mappings.json<unknown[]>()).toHaveLength(9);
  });

  it("downloads the exported package as a dated JSON attachment", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-15T02:03:04.000Z"));
    const context = await createContext();
    await seedDefinitions(context);

    const response = await context.request({ method: "GET", url: "/api/v1/env-config/file" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="env-config-2026-08-15.json"');
    expect(response.json()).toMatchObject({
      schemaVersion: 2,
      exportedAt: "2026-08-15T02:03:04.000Z",
      customFields: [{ key: "owner" }],
      ownerAccountMappings: expect.arrayContaining([{ ownerName: "测试负责人", account: "test.owner@example.com" }]),
      exportTemplates: [{ name: "排程模板" }],
    });
  });

  it("validates a v1 package as an Additive Import without executing it", async () => {
    const context = await createContext();

    const response = await context.request({
      method: "POST",
      url: "/api/v1/env-config/validate",
      payload: { package: legacyPackage },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "additive",
      hasDestructiveChanges: false,
      sections: {
        customFields: [
          { key: "legacy_owner", label: "旧版负责人", action: "create", grade: "safe", reason: null },
        ],
        ownerAccountMappings: [],
        exportTemplates: [],
      },
    });
    const fields = await context.request({ method: "GET", url: "/api/v1/custom-fields" });
    expect(fields.json()).toEqual([]);
  });

  it("imports a v1 package through the Additive Import route", async () => {
    const context = await createContext();

    const response = await context.request({
      method: "POST",
      url: "/api/v1/env-config/import",
      payload: {
        package: legacyPackage,
        mode: "additive",
        sections: ["customFields"],
        confirmDestructive: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sections: {
        customFields: [
          { key: "legacy_owner", action: "create", grade: "safe", reason: null, outcome: "created" },
        ],
        ownerAccountMappings: [],
        exportTemplates: [],
      },
    });
    const exported = await context.request({ method: "GET", url: "/api/v1/env-config" });
    expect(exported.json<{ customFields: Array<{ key: string }> }>().customFields).toEqual([
      expect.objectContaining({ key: "legacy_owner" }),
    ]);
  });
});
