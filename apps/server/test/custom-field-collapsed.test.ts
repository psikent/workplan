import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions } from "fastify";
import type { EnvConfigPackage } from "@workplan/contracts";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-tests",
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
});

const createFieldPayload = (overrides: Record<string, unknown> = {}) => ({
  key: "remarks",
  label: "备注",
  description: "",
  type: "short_text",
  required: false,
  defaultValue: null,
  options: [],
  ...overrides,
});

describe("custom field collapsed config", () => {
  it("creates fields with collapsed defaulting to false and persists an explicit true", async () => {
    const context = await createContext();

    const plain = await context.request({ method: "POST", url: "/api/v1/custom-fields", payload: createFieldPayload() });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().collapsed).toBe(false);

    const collapsed = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: createFieldPayload({ key: "extra_notes", label: "补充说明", collapsed: true }),
    });
    expect(collapsed.statusCode).toBe(201);
    expect(collapsed.json().collapsed).toBe(true);

    const list = await context.request({ method: "GET", url: "/api/v1/custom-fields?includeArchived=true" });
    const byKey = new Map((list.json() as Array<{ key: string; collapsed: boolean }>).map((field) => [field.key, field.collapsed]));
    expect(byKey.get("remarks")).toBe(false);
    expect(byKey.get("extra_notes")).toBe(true);
  });

  it("toggles collapsed through the update route with optimistic version checks", async () => {
    const context = await createContext();
    const created = await context.request({ method: "POST", url: "/api/v1/custom-fields", payload: createFieldPayload() });
    const field = created.json();

    const stale = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-fields/${field.id}`,
      payload: { collapsed: true, version: 99 },
    });
    expect(stale.statusCode).toBe(409);

    const updated = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-fields/${field.id}`,
      payload: { collapsed: true, version: field.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().collapsed).toBe(true);
    expect(updated.json().version).toBe(field.version + 1);

    // 未携带 collapsed 的更新不改变现状。
    const untouched = await context.request({
      method: "PATCH",
      url: `/api/v1/custom-fields/${field.id}`,
      payload: { description: "新说明", version: updated.json().version },
    });
    expect(untouched.statusCode).toBe(200);
    expect(untouched.json().collapsed).toBe(true);
    expect(untouched.json().description).toBe("新说明");
  });

  it("exports collapsed in the environment package and keeps it through additive import", async () => {
    const source = await createContext();
    await source.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: createFieldPayload({ key: "extra_notes", label: "补充说明", collapsed: true }),
    });

    const exported = source.services.envConfig.exportPackage();
    const packagedField = exported.customFields.find((field) => field.key === "extra_notes");
    expect(packagedField?.collapsed).toBe(true);

    const target = await createContext();
    const result = target.services.envConfig.importAdditive(exported, ["customFields"]);
    expect(result.sections.customFields[0]?.outcome).toBe("created");
    const imported = target.services.customFields.list(true).find((field) => field.key === "extra_notes");
    expect(imported?.collapsed).toBe(true);
  });

  it("does not overwrite local collapsed when additive import skips an existing key", async () => {
    const source = await createContext();
    await source.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: createFieldPayload({ key: "extra_notes", label: "补充说明", collapsed: true }),
    });
    const exported = source.services.envConfig.exportPackage();

    const target = await createContext();
    await target.services.customFields.create({
      key: "extra_notes",
      label: "补充说明",
      description: "",
      type: "short_text",
      required: false,
      collapsed: false,
      defaultValue: null,
      options: [],
    });

    const result = target.services.envConfig.importAdditive(exported, ["customFields"]);
    expect(result.sections.customFields[0]).toMatchObject({ action: "skip", reason: "key_exists" });
    expect(target.services.customFields.list(true).find((field) => field.key === "extra_notes")?.collapsed).toBe(false);
  });

  it("aligns collapsed on sync import as a safe, non-destructive change", async () => {
    const source = await createContext();
    await source.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: createFieldPayload({ key: "extra_notes", label: "补充说明", collapsed: true }),
    });
    const exported: EnvConfigPackage = source.services.envConfig.exportPackage();

    const target = await createContext();
    await target.services.customFields.create({
      key: "extra_notes",
      label: "补充说明",
      description: "",
      type: "short_text",
      required: false,
      collapsed: false,
      defaultValue: null,
      options: [],
    });

    const plan = target.services.envConfig.planSync(exported, ["customFields"]);
    expect(plan.hasDestructiveChanges).toBe(false);
    expect(plan.sections.customFields[0]).toMatchObject({ action: "update", grade: "safe", key: "extra_notes" });

    target.services.envConfig.importSync(JSON.parse(JSON.stringify(exported)), { sections: ["customFields"], confirmDestructive: false });
    const aligned = target.services.customFields.list(true).find((field) => field.key === "extra_notes");
    expect(aligned?.collapsed).toBe(true);

    // 收敛后再导出与包一致。
    expect(target.services.envConfig.exportPackage().customFields[0]?.collapsed).toBe(true);
  });
});
