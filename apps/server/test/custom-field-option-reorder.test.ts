import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-option-reorder-tests",
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

type OptionView = { id: string; value: string; label: string; sortOrder: number; archivedAt: string | null; version: number };

async function createRemarksField(context: TestContext, key = "remarks") {
  const response = await context.request({
    method: "POST",
    url: "/api/v1/custom-fields",
    payload: {
      key,
      label: "备注",
      description: "",
      type: "single_select",
      required: false,
      defaultValue: null,
      options: [
        { value: "duty", label: "1.值班" },
        { value: "automation", label: "4.自动化" },
        { value: "network", label: "5.网络安全" },
      ],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; options: OptionView[] }>();
}

async function archiveOption(context: TestContext, fieldId: string, option: OptionView) {
  const response = await context.request({
    method: "PATCH",
    url: `/api/v1/custom-field-options/${option.id}`,
    payload: { archived: true, version: option.version },
  });
  expect(response.statusCode).toBe(200);
}

async function getField(context: TestContext, fieldId: string) {
  const response = await context.request({ method: "GET", url: "/api/v1/custom-fields?includeArchived=true" });
  expect(response.statusCode).toBe(200);
  return response.json<Array<{ id: string; options: OptionView[] }>>().find((field) => field.id === fieldId)!;
}

describe("custom field option reorder", () => {
  it("reorders options by the submitted id order, including archived ones, without touching labels or archived state", async () => {
    const context = await createContext();
    const field = await createRemarksField(context);
    await archiveOption(context, field.id, field.options[2]!);
    const before = await getField(context, field.id);
    const optionIdByLabel = new Map(before.options.map((option) => [option.label, option.id]));

    const response = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: ["5.网络安全", "1.值班", "4.自动化"].map((label) => optionIdByLabel.get(label)!) },
    });
    expect(response.statusCode).toBe(200);
    const labels = response.json<{ options: OptionView[] }>().options.map((option) => option.label);
    expect(labels).toEqual(["5.网络安全", "1.值班", "4.自动化"]);

    const persisted = await getField(context, field.id);
    const beforeByLabel = new Map(before.options.map((option) => [option.label, option]));
    expect(persisted.options.map((option) => option.sortOrder)).toEqual([0, 1, 2]);
    for (const option of persisted.options) {
      const previous = beforeByLabel.get(option.label)!;
      expect(option.version).toBe(previous.version);
      expect(option.archivedAt).toBe(previous.archivedAt);
      expect(option.label).toBe(previous.label);
    }
    expect(persisted.options.find((option) => option.label === "5.网络安全")!.archivedAt).not.toBeNull();
  });

  it("rejects an id list that misses one of the field options", async () => {
    const context = await createContext();
    const field = await createRemarksField(context);
    const response = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: [field.options[0]!.id, field.options[1]!.id] },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects unknown and foreign option ids", async () => {
    const context = await createContext();
    const field = await createRemarksField(context);
    const other = await createRemarksField(context, "remarks_other");

    const unknown = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: [...field.options.map((option) => option.id), "00000000-0000-4000-8000-000000000000"] },
    });
    expect(unknown.statusCode).toBe(422);

    const foreign = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: [...field.options.map((option) => option.id).slice(1), other.options[0]!.id] },
    });
    expect(foreign.statusCode).toBe(422);
  });

  it("rejects duplicate ids", async () => {
    const context = await createContext();
    const field = await createRemarksField(context);
    const response = await context.request({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: [field.options[0]!.id, field.options[0]!.id, field.options[1]!.id] },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 404 for an unknown field", async () => {
    const context = await createContext();
    const response = await context.request({
      method: "POST",
      url: "/api/v1/custom-fields/00000000-0000-4000-8000-000000000001/options/reorder",
      payload: { orderedIds: ["00000000-0000-4000-8000-000000000002"] },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects editor accounts", async () => {
    const context = await createContext();
    const field = await createRemarksField(context);
    const created = await context.request({
      method: "POST",
      url: "/api/v1/users",
      payload: { username: "editor1", password: "very-secure-editor-password", role: "editor", loginMode: "password" },
    });
    expect(created.statusCode).toBe(201);
    const login = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "editor1", password: "very-secure-editor-password" } });
    expect(login.statusCode).toBe(200);
    const cookieHeader = login.headers["set-cookie"];
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/custom-fields/${field.id}/options/reorder`,
      payload: { orderedIds: field.options.map((option) => option.id) },
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(response.statusCode).toBe(403);
  });
});
