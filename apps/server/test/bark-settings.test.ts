import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions } from "fastify";
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
  vi.unstubAllGlobals();
  while (contexts.length) await contexts.pop()!.app.close();
});

type StubResponse = { ok: boolean; status: number; text: () => Promise<string> };

function stubFetch(handler: (url: URL) => StubResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return handler(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function createEditorContext(parent: TestContext) {
  const password = "very-secure-editor-password";
  const created = await parent.request({
    method: "POST",
    url: "/api/v1/users",
    payload: { username: "bark-editor", role: "editor", loginMode: "password", password },
  });
  expect(created.statusCode).toBe(201);
  const login = await parent.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username: "bark-editor", password },
  });
  const cookieHeader = login.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
  return (options: InjectOptions) => parent.app.inject({
    ...options,
    headers: {
      cookie,
      ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
      ...options.headers,
    },
  } as InjectOptions);
}

describe("bark settings API", () => {
  it("returns the default config when no row exists and requires administrator", async () => {
    const context = await createContext();

    const anonymous = await context.app.inject({ method: "GET", url: "/api/v1/settings/bark" });
    expect(anonymous.statusCode).toBe(401);

    const response = await context.request({ method: "GET", url: "/api/v1/settings/bark" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ serverUrl: "https://api.day.app", deviceKey: null });

    const editorRequest = await createEditorContext(context);
    const forbidden = await editorRequest({ method: "GET", url: "/api/v1/settings/bark" });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("upserts a single config row and normalizes an empty device key to null", async () => {
    const context = await createContext();

    const save = await context.request({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "https://self-hosted.example.com", deviceKey: "my-device-key" },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toEqual({ serverUrl: "https://self-hosted.example.com", deviceKey: "my-device-key" });
    expect(context.services.barkConfig.get()).toEqual({ serverUrl: "https://self-hosted.example.com", deviceKey: "my-device-key" });

    const clear = await context.request({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "https://self-hosted.example.com", deviceKey: "" },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ serverUrl: "https://self-hosted.example.com", deviceKey: null });

    const readBack = await context.request({ method: "GET", url: "/api/v1/settings/bark" });
    expect(readBack.json()).toEqual({ serverUrl: "https://self-hosted.example.com", deviceKey: null });
    const count = context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM bark_config").get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("rejects non-http(s) URLs and non-administrator writes", async () => {
    const context = await createContext();
    const editorRequest = await createEditorContext(context);

    const badUrl = await context.request({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "not-a-url", deviceKey: null },
    });
    expect(badUrl.statusCode).toBe(422);

    const forbiddenWrite = await editorRequest({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "https://api.day.app", deviceKey: "key" },
    });
    expect(forbiddenWrite.statusCode).toBe(403);

    const forbiddenTest = await editorRequest({ method: "POST", url: "/api/v1/settings/bark/test" });
    expect(forbiddenTest.statusCode).toBe(403);
  });

  it("fails a test push with a clear error when no device key is configured", async () => {
    const context = await createContext();
    const response = await context.request({ method: "POST", url: "/api/v1/settings/bark/test" });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("BARK_NOT_CONFIGURED");
    expect(response.json<{ detail: string }>().detail).toContain("设备 Key");
  });

  it("sends a test push to the configured device and reports success", async () => {
    const context = await createContext();
    await context.request({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "https://self-hosted.example.com/bark", deviceKey: "device-key-1" },
    });
    const fetchMock = stubFetch((url) => {
      expect(url.hostname).toBe("self-hosted.example.com");
      expect(url.pathname).toBe("/bark/device-key-1");
      expect(url.searchParams.get("title")).toBe("Bark 推送测试");
      expect(url.searchParams.get("group")).toBe("work-order-reminder");
      return { ok: true, status: 200, text: () => Promise.resolve("{}") };
    });

    const response = await context.request({ method: "POST", url: "/api/v1/settings/bark/test" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, message: "测试推送成功" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports the failure summary when the Bark server rejects the test push", async () => {
    const context = await createContext();
    await context.request({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "https://api.day.app", deviceKey: "broken-key" },
    });
    stubFetch(() => ({ ok: false, status: 500, text: () => Promise.resolve("server exploded") }));

    const response = await context.request({ method: "POST", url: "/api/v1/settings/bark/test" });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ success: boolean; message: string }>()).toMatchObject({ success: false });
    expect(response.json<{ message: string }>().message).toContain("500");
  });

  it("keeps Bark configuration out of the environment configuration package", async () => {
    const context = await createContext();
    await context.request({
      method: "PUT",
      url: "/api/v1/settings/bark",
      payload: { serverUrl: "https://api.day.app", deviceKey: "secret-device-key" },
    });

    const response = await context.request({ method: "GET", url: "/api/v1/env-config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 2 });
    expect(JSON.stringify(response.json())).not.toMatch(/bark|deviceKey|secret-device-key/i);
  });
});
