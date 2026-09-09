import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { customFieldOptionColorPalette, type EnvConfigPackage } from "@workplan/contracts";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-option-color-tests",
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
    payload: { token: built.services.auth.setupToken, username: "admin", password: "very-secure-test-password" },
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
  while (contexts.length) await contexts.pop()!.app.close();
});

type OptionView = { id: string; value: string; label: string; color: string | null; sortOrder: number; archivedAt: string | null; version: number };
type FieldView = { id: string; key: string; options: OptionView[] };

async function createRemarksField(context: TestContext, options: Array<{ value: string; label: string; color?: string | null }>) {
  const response = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: { key: "remarks", label: "备注", description: "", type: "single_select", required: false, defaultValue: null, options },
  });
  expect(response.statusCode).toBe(201);
  return response.json<FieldView>();
}

async function getField(context: TestContext, fieldId: string): Promise<FieldView> {
  const response = await context.request({ method: "GET", url: "/api/v1/custom-fields?includeArchived=true" });
  expect(response.statusCode).toBe(200);
  return response.json<FieldView[]>().find((field) => field.id === fieldId)!;
}

describe("custom field option color", () => {
  it("creates a field with option colors and echoes them in serialized output", async () => {
    const context = await createContext();
    const field = await createRemarksField(context, [
      { value: "duty", label: "1.值班", color: "#3b82f6" },
      { value: "automation", label: "4.自动化", color: null },
      { value: "network", label: "5.网络安全" },
    ]);
    expect(field.options.map((option) => option.color)).toEqual(["#3b82f6", null, null]);

    const persisted = await getField(context, field.id);
    expect(persisted.options.map((option) => [option.value, option.color])).toEqual([
      ["duty", "#3b82f6"],
      ["automation", null],
      ["network", null],
    ]);
  });

  it("sets and clears color through the option update endpoint, keeping optimistic locking", async () => {
    const context = await createContext();
    const field = await createRemarksField(context, [{ value: "duty", label: "1.值班" }]);
    const option = field.options[0]!;

    const set = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-field-options/${option.id}`,
      payload: { color: "#8b5cf6", version: option.version },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json<OptionView>()).toMatchObject({ color: "#8b5cf6", version: option.version + 1 });

    // 未传 color 的更新（仅重命名）不得丢已有颜色。
    const rename = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-field-options/${option.id}`,
      payload: { label: "1.节假日值班", version: option.version + 1 },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json<OptionView>()).toMatchObject({ label: "1.节假日值班", color: "#8b5cf6" });

    // 传 null 清除颜色。
    const clear = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-field-options/${option.id}`,
      payload: { color: null, version: option.version + 2 },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json<OptionView>().color).toBeNull();

    // 过期 version → 乐观锁冲突不变。
    const stale = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-field-options/${option.id}`,
      payload: { color: "#f43f5e", version: option.version },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("adds an option carrying color via the option create endpoint", async () => {
    const context = await createContext();
    const field = await createRemarksField(context, [{ value: "duty", label: "1.值班" }]);
    const response = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options`,
      payload: { value: "network", label: "5.网络安全", color: "#10b981" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<OptionView>().color).toBe("#10b981");
  });

  it("rejects colors outside the palette on all three write paths", async () => {
    const context = await createContext();
    const field = await createRemarksField(context, [{ value: "duty", label: "1.值班" }]);
    const option = field.options[0]!;

    const create = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: {
        key: "remarks_bad", label: "备注", description: "", type: "single_select", required: false, defaultValue: null,
        options: [{ value: "duty", label: "1.值班", color: "#ff0000" }],
      },
    });
    expect(create.statusCode).toBe(422);

    const add = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options`,
      payload: { value: "other", label: "其他", color: "#ff0000" },
    });
    expect(add.statusCode).toBe(422);

    const update = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-field-options/${option.id}`,
      payload: { color: "red", version: option.version },
    });
    expect(update.statusCode).toBe(422);
  });

  it("exports option colors and converges them via sync import as a safe update_option", async () => {
    const source = await createContext();
    await createRemarksField(source, [
      { value: "duty", label: "1.值班", color: "#3b82f6" },
      { value: "automation", label: "4.自动化" },
    ]);
    const pkg: EnvConfigPackage = source.services.envConfig.exportPackage();
    expect(pkg.customFields[0]!.options).toEqual([
      { value: "duty", label: "1.值班", color: "#3b82f6" },
      { value: "automation", label: "4.自动化", color: null },
    ]);

    const target = await createContext();
    // 本地先行存在同键字段，颜色与包不一致 → sync 计划应给出 safe 的 update_option。
    const localTarget = await createRemarksField(target, [{ value: "duty", label: "1.值班", color: "#f43f5e" }]);
    const plan = target.services.envConfig.validate(pkg, "sync");
    const fieldPlan = plan.sections.customFields.find((item) => item.key === "remarks")!;
    expect(fieldPlan.options?.find((item) => item.value === "duty")).toEqual({
      action: "update_option",
      grade: "safe",
      reason: null,
      value: "duty",
      label: "1.值班",
      color: "#3b82f6",
    });

    const result = target.services.envConfig.importSync(pkg, { sections: ["customFields"], confirmDestructive: false });
    const syncedField = result.sections.customFields.find((item) => item.key === "remarks")!;
    expect(syncedField.outcome).toBe("updated");
    const persisted = await getField(target, localTarget.id);
    expect(persisted.options.find((option) => option.value === "duty")!.color).toBe("#3b82f6");
  });

  it("additive import skips existing keys without overwriting local colors", async () => {
    const source = await createContext();
    await createRemarksField(source, [{ value: "duty", label: "1.值班", color: "#3b82f6" }]);
    const pkg: EnvConfigPackage = source.services.envConfig.exportPackage();

    const target = await createContext();
    const local = await createRemarksField(target, [{ value: "duty", label: "1.值班", color: "#8b5cf6" }]);
    const result = target.services.envConfig.importAdditive(pkg, ["customFields"]);
    expect(result.sections.customFields[0]!.action).toBe("skip");
    const after = await getField(target, local.id);
    expect(after.options[0]!.color).toBe("#8b5cf6");
  });

  it("keeps every palette color accepted by the contract schema", async () => {
    const context = await createContext();
    const options = customFieldOptionColorPalette.map((color, index) => ({ value: `opt_${index}`, label: `选项${index}`, color }));
    const field = await createRemarksField(context, options);
    expect(field.options.map((option) => option.color)).toEqual([...customFieldOptionColorPalette]);
  });
});

