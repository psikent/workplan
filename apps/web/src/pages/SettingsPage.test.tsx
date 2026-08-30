// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { CustomFieldDefinition, EnvConfigImportResult, EnvConfigPackage, EnvConfigPlan, ExportTemplate, OwnerAccountMapping } from "@workplan/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import { settingsTabs } from "./settings/tabs";
import SettingsPage from "./SettingsPage";

const apiMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const downloadEnvConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../App", () => ({ useSession: () => ({ user: { username: "lxj", role: "admin", loginMode: "password" } }) }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: apiMock,
  downloadEnvConfig: downloadEnvConfigMock,
}));

const ownerField: CustomFieldDefinition = {
  id: "f9a9dc48-e819-4b1b-89a3-ee680649e842",
  key: "owner",
  label: "负责人",
  description: "",
  type: "single_select",
  required: false,
  defaultValue: null,
  sortOrder: 0,
  archivedAt: null,
  version: 1,
  options: [
    { id: "52c30b18-5b30-4ba0-bd61-bd9371d1139e", value: "fengmingqian", label: "冯铭倩", sortOrder: 0, archivedAt: null, version: 1 },
    { id: "bb690d69-8585-45c2-b922-f069ba84cb13", value: "linyaqian", label: "林雅茜", sortOrder: 1, archivedAt: null, version: 1 },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const envConfigPackage: EnvConfigPackage = {
  schemaVersion: 2,
  exportedAt: "2026-08-16T00:00:00.000Z",
  customFields: [],
  ownerAccountMappings: [],
  exportTemplates: [],
};

const envConfigPlan: EnvConfigPlan = {
  mode: "sync",
  hasDestructiveChanges: true,
  sections: {
    customFields: [{
      action: "create",
      grade: "safe",
      reason: null,
      key: "priority",
      label: "优先级",
      options: [
        { action: "add_option", grade: "safe", reason: null, value: "high", label: "高" },
        { action: "retire_option", grade: "destructive", reason: null, value: "legacy", label: "旧选项" },
      ],
    }],
    ownerAccountMappings: [{
      action: "skip",
      grade: "safe",
      reason: "owner_exists",
      ownerName: "冯铭倩",
      account: "fengmingqian@zh.gd.csg.cn",
    }],
    exportTemplates: [{
      action: "update",
      grade: "safe",
      reason: null,
      name: "标准工作计划",
      sheetName: "工作计划",
    }],
  },
};

const envConfigImportResult: EnvConfigImportResult = {
  sections: {
    customFields: [{
      ...envConfigPlan.sections.customFields[0]!,
      outcome: "created",
      options: [
        { ...envConfigPlan.sections.customFields[0]!.options![0]!, outcome: "created" },
        { ...envConfigPlan.sections.customFields[0]!.options![1]!, outcome: "retired" },
      ],
    }],
    ownerAccountMappings: [{ ...envConfigPlan.sections.ownerAccountMappings[0]!, outcome: "not_selected" }],
    exportTemplates: [{ ...envConfigPlan.sections.exportTemplates[0]!, outcome: "updated" }],
  },
};

let template: ExportTemplate;
let ownerMappings: OwnerAccountMapping[];
let barkConfig: { serverUrl: string; deviceKey: string | null };
let users: Array<{
  id: string;
  username: string;
  role: "admin" | "editor";
  loginMode: "password" | "token";
  disabledAt: string | null;
  version: number;
  createdAt: string;
  tokens: Array<{ id: string; name: string; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; version: number }>;
}>;

beforeEach(() => {
  clipboardWriteTextMock.mockReset();
  clipboardWriteTextMock.mockResolvedValue(undefined);
  downloadEnvConfigMock.mockReset();
  downloadEnvConfigMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
  template = {
    id: "8b8f906c-b4e9-4b10-890e-6582e0c48ec2",
    name: "标准工作计划",
    sheetName: "工作计划",
    columns: [
      { source: "title", header: "工作内容" },
      { source: "status", header: "状态" },
      { source: "startAt", header: "开始时间" },
      { source: "endAt", header: "结束时间" },
    ],
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  ownerMappings = [
    { ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" },
    { ownerName: "罗智凌", account: "luozhiling@zh.gd.csg.cn" },
  ];
  barkConfig = { serverUrl: "https://api.day.app", deviceKey: null };
  users = [{
    id: "0d433d19-78a1-4587-80c6-4058748d6f15",
    username: "lxj",
    role: "admin",
    loginMode: "password",
    disabledAt: null,
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    tokens: [],
  }];
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/users" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as {
        username: string;
        loginMode: "password" | "token";
        password?: string;
        tokenName?: string;
        tokenExpiresAt?: string;
      };
      const tokens = input.loginMode === "token"
        ? [{ id: "4f1adba1-e070-4d42-9099-b59fc5c897de", name: input.tokenName!, expiresAt: input.tokenExpiresAt!, lastUsedAt: null, createdAt: "2026-08-09T00:00:00.000Z", version: 1 }]
        : [];
      const user = {
        id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
        username: input.username,
        role: "editor" as const,
        loginMode: input.loginMode,
        disabledAt: null,
        version: 1,
        createdAt: "2026-08-09T00:00:00.000Z",
        tokens,
      };
      users = [...users, user];
      return input.loginMode === "token"
        ? { user, accessToken: { ...tokens[0], token: "wp_one-time-secret" } }
        : { user };
    }
    const userStatusMatch = path.match(/^\/users\/([^/]+)$/);
    if (userStatusMatch && init?.method === "PATCH") {
      const input = JSON.parse(String(init.body)) as { disabled: boolean; version: number };
      const user = users.find((item) => item.id === userStatusMatch[1])!;
      Object.assign(user, {
        disabledAt: input.disabled ? "2026-08-09T04:00:00.000Z" : null,
        version: input.version + 1,
        tokens: input.disabled ? [] : user.tokens,
      });
      return user;
    }
    const passwordMatch = path.match(/^\/users\/([^/]+)\/password$/);
    if (passwordMatch && init?.method === "PUT") {
      const input = JSON.parse(String(init.body)) as { password: string; version: number };
      const user = users.find((item) => item.id === passwordMatch[1])!;
      Object.assign(user, { loginMode: "password" as const, version: input.version + 1 });
      return user;
    }
    const userTokensMatch = path.match(/^\/users\/([^/]+)\/tokens$/);
    if (userTokensMatch && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as { name: string; expiresAt: string };
      const token = { id: "56a9da65-b8ef-4f20-938b-889abdbb13ab", name: input.name, expiresAt: input.expiresAt, lastUsedAt: null, createdAt: "2026-08-09T04:00:00.000Z", version: 1, token: "wp_replacement-secret" };
      users.find((item) => item.id === userTokensMatch[1])!.tokens.push(token);
      return token;
    }
    const revokeMatch = path.match(/^\/users\/([^/]+)\/tokens\/([^/?]+)/);
    if (revokeMatch && init?.method === "DELETE") {
      const user = users.find((item) => item.id === revokeMatch[1])!;
      user.tokens = user.tokens.filter((token) => token.id !== revokeMatch[2]);
      return { revoked: true };
    }
    if (path === "/users") return users;
    if (path === "/tokens") return [];
    if (path === "/custom-fields?includeArchived=true") return [ownerField];
    if (path === "/custom-fields") return [ownerField];
    if (path === "/owner-account-mappings" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as OwnerAccountMapping;
      ownerMappings = [...ownerMappings, input];
      return input;
    }
    const ownerMappingMatch = path.match(/^\/owner-account-mappings\/(.+)$/);
    if (ownerMappingMatch && init?.method === "PUT") {
      const currentOwnerName = decodeURIComponent(ownerMappingMatch[1]!);
      const input = JSON.parse(String(init.body)) as OwnerAccountMapping;
      ownerMappings = ownerMappings.map((mapping) => mapping.ownerName === currentOwnerName ? input : mapping);
      return input;
    }
    if (ownerMappingMatch && init?.method === "DELETE") {
      const currentOwnerName = decodeURIComponent(ownerMappingMatch[1]!);
      ownerMappings = ownerMappings.filter((mapping) => mapping.ownerName !== currentOwnerName);
      return undefined;
    }
    if (path === "/owner-account-mappings") return ownerMappings;
    if (path === "/settings/bark" && init?.method === "PUT") {
      const input = JSON.parse(String(init.body)) as { serverUrl: string; deviceKey: string };
      barkConfig = { serverUrl: input.serverUrl, deviceKey: input.deviceKey || null };
      return barkConfig;
    }
    if (path === "/settings/bark/test" && init?.method === "POST") return { success: true, message: "测试推送成功" };
    if (path === "/settings/bark") return barkConfig;
    if (path === "/env-config") return envConfigPackage;
    if (path === "/env-config/validate" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as { mode: "additive" | "sync" };
      return { ...envConfigPlan, mode: input.mode };
    }
    if (path === "/env-config/import" && init?.method === "POST") return envConfigImportResult;
    if (path === "/export-templates") return [template];
    if (path === `/export-templates/${template.id}` && init?.method === "PATCH") {
      const input = JSON.parse(String(init.body)) as Pick<ExportTemplate, "name" | "sheetName" | "columns">;
      template = { ...template, ...input, version: template.version + 1, updatedAt: "2026-08-08T00:00:00.000Z" };
      return template;
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
});

function renderSettings(initialEntry = "/settings") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/settings", element: <SettingsPage /> }], { initialEntries: [initialEntry] });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router, unmount: () => view.unmount() };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("settings tab shell", () => {
  it("renders the five tabs in the spec order with ARIA wiring and one visible panel", async () => {
    const view = renderSettings();
    const tablist = await screen.findByRole("tablist", { name: "设置分区" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(settingsTabs.map((tab) => tab.label));

    const active = screen.getByRole("tab", { name: "环境配置" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.getAttribute("aria-controls")).toBe("settings-panel-environment");
    expect(active.getAttribute("tabindex")).toBe("0");
    for (const tab of tabs.filter((tab) => tab !== active)) {
      expect(tab.getAttribute("aria-selected")).toBe("false");
      expect(tab.getAttribute("tabindex")).toBe("-1");
    }

    const panel = screen.getByRole("tabpanel", { name: "环境配置" });
    expect(panel.getAttribute("aria-labelledby")).toBe("settings-tab-environment");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    view.unmount();
  });

  it("normalizes /settings without a tab parameter to the environment tab via replace", async () => {
    const { router, unmount } = renderSettings();
    await screen.findByRole("tabpanel");
    await waitFor(() => expect(router.state.location.search).toBe("?tab=environment"));
    await waitFor(() => expect(router.state.historyAction).toBe("REPLACE"));
    unmount();
  });

  it("falls back to the environment tab for an unknown tab value via replace", async () => {
    const { router, unmount } = renderSettings("/settings?tab=nonsense");
    await screen.findByRole("tabpanel");
    await waitFor(() => expect(router.state.location.search).toBe("?tab=environment"));
    await waitFor(() => expect(router.state.historyAction).toBe("REPLACE"));
    expect(screen.getByRole("tab", { name: "环境配置" }).getAttribute("aria-selected")).toBe("true");
    unmount();
  });

  it("falls back to the environment tab for an empty tab value via replace", async () => {
    const { router, unmount } = renderSettings("/settings?tab=");
    await screen.findByRole("tabpanel");
    await waitFor(() => expect(router.state.location.search).toBe("?tab=environment"));
    await waitFor(() => expect(router.state.historyAction).toBe("REPLACE"));
    unmount();
  });

  it("selects the tab for a valid query parameter without redirecting", async () => {
    const { router, unmount } = renderSettings("/settings?tab=accounts");
    await screen.findByText("账户与访问 Token");
    expect(router.state.location.search).toBe("?tab=accounts");
    expect(router.state.historyAction).toBe("POP");
    expect(screen.getByRole("tab", { name: "账户管理" }).getAttribute("aria-selected")).toBe("true");
    unmount();
  });

  it("pushes history on tab clicks and restores tabs on back and forward", async () => {
    const { router, unmount } = renderSettings("/settings?tab=push");
    await screen.findByText("Bark 推送");

    fireEvent.click(screen.getByRole("tab", { name: "环境配置" }));
    expect(router.state.location.search).toBe("?tab=environment");
    expect(router.state.historyAction).toBe("PUSH");

    act(() => {
      router.navigate(-1);
    });
    expect(screen.getByRole("tab", { name: "推送配置" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "推送配置" })).toBeTruthy();

    act(() => {
      router.navigate(1);
    });
    expect(screen.getByRole("tab", { name: "环境配置" }).getAttribute("aria-selected")).toBe("true");
    unmount();
  });

  it("moves tab focus with keyboard without changing the active tab until activation", async () => {
    const { unmount } = renderSettings();
    await screen.findByRole("tabpanel");
    const tabs = screen.getAllByRole("tab");
    const second = tabs[1]!;

    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs[0]!);
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(document.activeElement).toBe(tabs[4]!);
    fireEvent.keyDown(tabs[4]!, { key: "Home" });
    expect(document.activeElement).toBe(tabs[0]!);
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs[4]!);
    expect(screen.getByRole("tab", { name: "环境配置" }).getAttribute("aria-selected")).toBe("true");

    // Enter/Space activate buttons natively in browsers; clicking models that activation.
    fireEvent.click(tabs[4]!);
    expect(tabs[4]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[4]!);
    unmount();
  });

  it("keeps visited panels mounted but hidden and inert while other tabs are active", async () => {
    const { unmount } = renderSettings("/settings?tab=push");
    await screen.findByText("Bark 推送");

    fireEvent.click(screen.getByRole("tab", { name: "环境配置" }));
    await screen.findByText("工作负责人账号映射");

    const pushPanel = document.getElementById("settings-panel-push");
    expect(pushPanel?.hidden).toBe(true);
    expect(screen.queryByRole("tabpanel", { name: "推送配置" })).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "推送配置" }));
    expect(screen.getByRole("tabpanel", { name: "推送配置" })).toBeTruthy();
    expect(document.getElementById("settings-panel-environment")?.hidden).toBe(true);
    unmount();
  });

  it("keeps an environment draft and validation preview across tab switches", async () => {
    const { unmount } = renderSettings("/settings?tab=environment");
    const textarea = screen.getByLabelText("粘贴环境配置 JSON") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: JSON.stringify(envConfigPackage) } });

    fireEvent.click(screen.getByRole("tab", { name: "推送配置" }));
    await screen.findByText("Bark 推送");
    expect(textarea.value).toBe(JSON.stringify(envConfigPackage));

    fireEvent.click(screen.getByRole("tab", { name: "环境配置" }));
    expect((screen.getByLabelText("粘贴环境配置 JSON") as HTMLTextAreaElement).value).toBe(JSON.stringify(envConfigPackage));
    unmount();
  });

  it("keeps a revealed one-time token across tab switches", async () => {
    const { unmount } = renderSettings("/settings?tab=accounts");
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "测试" } });
    fireEvent.change(screen.getByLabelText("登录方式"), { target: { value: "token" } });
    fireEvent.change(screen.getByLabelText("初始 Token 名称"), { target: { value: "查询 Token" } });
    fireEvent.click(screen.getByRole("button", { name: "创建编辑者" }));
    expect(await screen.findByText("wp_one-time-secret")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "环境配置" }));
    await screen.findByText("工作负责人账号映射");
    fireEvent.click(screen.getByRole("tab", { name: "账户管理" }));
    expect(screen.getByText("wp_one-time-secret")).toBeTruthy();
    unmount();
  });
});

describe("environment configuration settings", () => {
  it("copies a pretty-printed Environment Configuration Package and shows success", async () => {
    const view = renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "复制配置" }));

    await waitFor(() => expect(clipboardWriteTextMock).toHaveBeenCalledWith(`{
  "schemaVersion": 2,
  "exportedAt": "2026-08-16T00:00:00.000Z",
  "customFields": [],
  "ownerAccountMappings": [],
  "exportTemplates": []
}`));
    expect(await screen.findByText("环境配置已复制")).toBeTruthy();
    view.unmount();
  });

  it("downloads the Environment Configuration Package file and shows success", async () => {
    const view = renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "下载配置文件" }));

    await waitFor(() => expect(downloadEnvConfigMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("环境配置文件已下载")).toBeTruthy();
    view.unmount();
  });

  it("loads an uploaded Environment Configuration Package into the shared validation flow", async () => {
    const view = renderSettings();
    const file = new File([JSON.stringify(envConfigPackage)], "env-config.json", { type: "application/json" });

    fireEvent.change(screen.getByLabelText("上传环境配置文件"), { target: { files: [file] } });

    await waitFor(() => expect((screen.getByLabelText("粘贴环境配置 JSON") as HTMLTextAreaElement).value).toBe(JSON.stringify(envConfigPackage)));
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/env-config/validate",
      expect.objectContaining({ method: "POST" }),
    ));
    const validateCall = apiMock.mock.calls.find(([path, init]) => path === "/env-config/validate" && init?.method === "POST");
    expect(JSON.parse(String(validateCall?.[1]?.body))).toEqual({ package: envConfigPackage, mode: "additive" });
    view.unmount();
  });

  it("does not let an earlier file read overwrite newer pasted text", async () => {
    const readers: Array<{ resolve: (value: string) => void }> = [];
    class DeferredFileReader {
      result: string | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsText() {
        readers.push({
          resolve: (value) => {
            this.result = value;
            this.onload?.();
          },
        });
      }
    }
    vi.stubGlobal("FileReader", DeferredFileReader);
    const view = renderSettings();
    try {
      const input = screen.getByLabelText("粘贴环境配置 JSON") as HTMLTextAreaElement;
      const file = new File([JSON.stringify(envConfigPackage)], "env-config.json", { type: "application/json" });

      fireEvent.change(screen.getByLabelText("上传环境配置文件"), { target: { files: [file] } });
      expect(readers).toHaveLength(1);
      fireEvent.change(input, { target: { value: "{}" } });
      await act(async () => {
        readers[0]!.resolve(JSON.stringify(envConfigPackage));
        await Promise.resolve();
      });

      expect(input.value).toBe("{}");
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("validates pasted JSON and renders a graded preview with every section selected", async () => {
    const defaultApi = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/env-config/validate" && init?.method === "POST") {
        return {
          ...envConfigPlan,
          sections: {
            ...envConfigPlan.sections,
            customFields: [
              ...envConfigPlan.sections.customFields,
              { action: "skip", grade: "destructive", reason: "type_conflict", key: "legacy-priority", label: "旧优先级", options: [] },
            ],
          },
        };
      }
      return defaultApi(path, init);
    });
    const view = renderSettings();
    const mode = screen.getByLabelText("导入模式") as HTMLSelectElement;
    expect(mode.value).toBe("additive");

    fireEvent.change(screen.getByLabelText("粘贴环境配置 JSON"), { target: { value: JSON.stringify(envConfigPackage) } });
    fireEvent.change(mode, { target: { value: "sync" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/env-config/validate",
      expect.objectContaining({ method: "POST" }),
    ));
    const validateCall = apiMock.mock.calls.find(([path, init]) => path === "/env-config/validate" && init?.method === "POST");
    expect(JSON.parse(String(validateCall?.[1]?.body))).toEqual({ package: envConfigPackage, mode: "sync" });
    expect(await screen.findByText("校验预览")).toBeTruthy();
    expect(screen.getByText("优先级")).toBeTruthy();
    expect(screen.getByText("旧选项")).toBeTruthy();
    expect(screen.getAllByText("破坏性").length).toBeGreaterThan(0);
    expect(screen.getByText("负责人已存在")).toBeTruthy();
    const conflictRow = screen.getByText("字段类型冲突").closest(".env-config-plan-row");
    expect(conflictRow?.classList.contains("destructive")).toBe(true);
    expect(conflictRow?.textContent).toContain("跳过");
    expect(conflictRow?.textContent).toContain("破坏性");
    expect((screen.getByRole("checkbox", { name: "导入自定义字段" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "导入负责人账号映射" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "导入 XLS 导出模板" }) as HTMLInputElement).checked).toBe(true);
    view.unmount();
  });

  it("ignores a validation response after the package text changes", async () => {
    const validation = createDeferred<EnvConfigPlan>();
    const defaultApi = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => (
      path === "/env-config/validate" && init?.method === "POST"
        ? validation.promise
        : defaultApi(path, init)
    ));
    const view = renderSettings();
    const input = screen.getByLabelText("粘贴环境配置 JSON") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: JSON.stringify(envConfigPackage) } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/env-config/validate",
      expect.objectContaining({ method: "POST" }),
    ));
    fireEvent.change(input, { target: { value: "{}" } });
    await act(async () => {
      validation.resolve({ ...envConfigPlan, mode: "additive" });
      await validation.promise;
    });

    expect(input.value).toBe("{}");
    expect(screen.queryByText("校验预览")).toBeNull();
    view.unmount();
  });

  it("requires confirmation before a Sync Import with a destructive nested option", async () => {
    const view = renderSettings();
    fireEvent.change(screen.getByLabelText("粘贴环境配置 JSON"), { target: { value: JSON.stringify(envConfigPackage) } });
    fireEvent.change(screen.getByLabelText("导入模式"), { target: { value: "sync" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await screen.findByText("校验预览");

    const execute = screen.getByRole("button", { name: "执行导入" }) as HTMLButtonElement;
    const confirmation = screen.getByRole("checkbox", { name: "我已确认破坏性变更" }) as HTMLInputElement;
    expect(execute.disabled).toBe(true);
    expect(confirmation.checked).toBe(false);

    fireEvent.click(confirmation);
    expect(execute.disabled).toBe(false);
    view.unmount();
  });

  it("does not require destructive confirmation when the destructive section is not selected", async () => {
    const view = renderSettings();
    fireEvent.change(screen.getByLabelText("粘贴环境配置 JSON"), { target: { value: JSON.stringify(envConfigPackage) } });
    fireEvent.change(screen.getByLabelText("导入模式"), { target: { value: "sync" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await screen.findByText("校验预览");

    fireEvent.click(screen.getByRole("checkbox", { name: "导入自定义字段" }));
    expect(screen.queryByRole("checkbox", { name: "我已确认破坏性变更" })).toBeNull();
    const execute = screen.getByRole("button", { name: "执行导入" }) as HTMLButtonElement;
    expect(execute.disabled).toBe(false);
    fireEvent.click(execute);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/env-config/import",
      expect.objectContaining({ method: "POST" }),
    ));
    const importCall = apiMock.mock.calls.find(([path, init]) => path === "/env-config/import" && init?.method === "POST");
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      package: envConfigPackage,
      mode: "sync",
      sections: ["ownerAccountMappings", "exportTemplates"],
      confirmDestructive: false,
    });
    view.unmount();
  });

  it("imports only selected sections and shows the result", async () => {
    const view = renderSettings();
    fireEvent.change(screen.getByLabelText("粘贴环境配置 JSON"), { target: { value: JSON.stringify(envConfigPackage) } });
    fireEvent.change(screen.getByLabelText("导入模式"), { target: { value: "sync" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await screen.findByText("校验预览");

    fireEvent.click(screen.getByRole("checkbox", { name: "导入负责人账号映射" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "我已确认破坏性变更" }));
    fireEvent.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/env-config/import",
      expect.objectContaining({ method: "POST" }),
    ));
    const importCall = apiMock.mock.calls.find(([path, init]) => path === "/env-config/import" && init?.method === "POST");
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      package: envConfigPackage,
      mode: "sync",
      sections: ["customFields", "exportTemplates"],
      confirmDestructive: true,
    });
    expect(await screen.findByText("导入结果")).toBeTruthy();
    expect(screen.getByText(/自定义字段：.*已创建 2 项.*已停用 1 项/)).toBeTruthy();
    expect(screen.getByText(/XLS 导出模板：.*已更新 1 项/)).toBeTruthy();
    expect(await screen.findByText("环境配置导入完成")).toBeTruthy();
    view.unmount();
  });

  it("freezes the import controls while an import is running", async () => {
    const importRequest = createDeferred<EnvConfigImportResult>();
    const defaultApi = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => (
      path === "/env-config/import" && init?.method === "POST"
        ? importRequest.promise
        : defaultApi(path, init)
    ));
    const view = renderSettings();

    fireEvent.change(screen.getByLabelText("粘贴环境配置 JSON"), { target: { value: JSON.stringify(envConfigPackage) } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await screen.findByText("校验预览");
    fireEvent.click(screen.getByRole("button", { name: "执行导入" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/env-config/import",
      expect.objectContaining({ method: "POST" }),
    ));

    expect((screen.getByLabelText("粘贴环境配置 JSON") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText("导入模式") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("上传环境配置文件") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "导入自定义字段" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "正在导入…" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      importRequest.resolve(envConfigImportResult);
      await importRequest.promise;
    });
    expect(await screen.findByText("环境配置导入完成")).toBeTruthy();
    view.unmount();
  });
});

describe("bark push settings", () => {
  it("loads the saved config and saves edits including an empty device key as disabled", async () => {
    barkConfig = { serverUrl: "https://self-hosted.example.com", deviceKey: "device-key-1" };
    const view = renderSettings("/settings?tab=push");

    await waitFor(() => expect((screen.getByLabelText("Bark 服务器 URL") as HTMLInputElement).value).toBe("https://self-hosted.example.com"));
    expect((screen.getByLabelText("Bark 设备 Key") as HTMLInputElement).value).toBe("device-key-1");

    fireEvent.change(screen.getByLabelText("Bark 服务器 URL"), { target: { value: "https://new.example.com" } });
    fireEvent.change(screen.getByLabelText("Bark 设备 Key"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/settings/bark",
      expect.objectContaining({ method: "PUT" }),
    ));
    const saveCall = apiMock.mock.calls.find(([path, init]) => path === "/settings/bark" && init?.method === "PUT");
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({ serverUrl: "https://new.example.com", deviceKey: "" });
    expect(screen.getByText("Bark 配置已保存")).toBeTruthy();
    view.unmount();
  });

  it("sends a test push and shows the returned summary", async () => {
    barkConfig = { serverUrl: "https://api.day.app", deviceKey: "device-key-1" };
    const view = renderSettings("/settings?tab=push");
    await waitFor(() => expect((screen.getByLabelText("Bark 设备 Key") as HTMLInputElement).value).toBe("device-key-1"));

    fireEvent.click(screen.getByRole("button", { name: "发送测试推送" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/settings/bark/test",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("测试推送成功")).toBeTruthy();
    view.unmount();
  });

  it("shows the failure summary when the test push reports an error", async () => {
    barkConfig = { serverUrl: "https://api.day.app", deviceKey: "broken-key" };
    const defaultApi = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => (
      path === "/settings/bark/test" && init?.method === "POST"
        ? { success: false, message: "测试推送失败：Bark 服务器返回 500" }
        : defaultApi(path, init)
    ));
    const view = renderSettings("/settings?tab=push");
    await waitFor(() => expect((screen.getByLabelText("Bark 设备 Key") as HTMLInputElement).value).toBe("broken-key"));

    fireEvent.click(screen.getByRole("button", { name: "发送测试推送" }));
    expect(await screen.findByText(/测试推送失败：Bark 服务器返回 500/)).toBeTruthy();
    view.unmount();
  });
});

describe("Excel template settings", () => {
  it("edits template metadata, custom-field columns, headers and order", async () => {
    const view = renderSettings("/settings?tab=transfer");
    await screen.findByRole("option", { name: "标准工作计划" });

    fireEvent.change(screen.getByLabelText("模板名称"), { target: { value: "现场模板" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "导出 负责人" }));
    fireEvent.change(screen.getByLabelText("负责人导出列标题"), { target: { value: "负责人姓名" } });
    fireEvent.click(screen.getByRole("button", { name: "上移导出列 负责人" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/export-templates/${template.id}`,
      expect.objectContaining({ method: "PATCH" }),
    ));
    const saveCall = apiMock.mock.calls.find(([path, init]) => path === `/export-templates/${template.id}` && init?.method === "PATCH");
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { name: string; columns: Array<{ source: string; header: string }> };
    expect(body.name).toBe("现场模板");
    expect(body.columns.find((column) => column.source === "custom:owner")?.header).toBe("负责人姓名");
    expect(body.columns.map((column) => column.source)).toEqual(["title", "status", "startAt", "custom:owner", "endAt"]);
    expect(screen.getByText("可用于 XLS 导入")).toBeTruthy();
    expect(await screen.findByText("模板已保存")).toBeTruthy();
    expect(screen.queryByText("账户与访问 Token")).toBeNull();
    view.unmount();
  });

  it("saves the owner account as an ordered hidden export column without changing template defaults", async () => {
    const view = renderSettings("/settings?tab=transfer");
    await screen.findByRole("option", { name: "标准工作计划" });
    expect((screen.getByRole("checkbox", { name: "导出 工作负责人账号" }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "导出 负责人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "导出 工作负责人账号" }));
    fireEvent.change(screen.getByLabelText("工作负责人账号导出列标题"), { target: { value: "负责人4A账号" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/export-templates/${template.id}`,
      expect.objectContaining({ method: "PATCH" }),
    ));
    const saveCalls = apiMock.mock.calls as Array<[string, RequestInit?]>;
    const saveCall = saveCalls.filter(([path, init]) => path === `/export-templates/${template.id}` && init?.method === "PATCH").at(-1);
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { columns: Array<{ source: string; header: string }> };
    expect(body.columns.slice(-2)).toEqual([
      { source: "custom:owner", header: "负责人" },
      { source: "ownerAccount", header: "负责人4A账号" },
    ]);
    view.unmount();
  });
});

describe("owner account mapping settings", () => {
  it("shows coverage and lets an administrator create, edit and delete a mapping", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = renderSettings("/settings?tab=environment");
    expect(await screen.findByText("fengmingqian@zh.gd.csg.cn")).toBeTruthy();
    expect(screen.getByText("当前无对应选项")).toBeTruthy();
    expect(screen.getByRole("button", { name: "为 林雅茜 配置" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "为 林雅茜 配置" }));
    expect((screen.getByLabelText("新增映射工作负责人") as HTMLInputElement).value).toBe("林雅茜");
    fireEvent.change(screen.getByLabelText("新增映射工作负责人账号"), { target: { value: "linyaqian@zh.gd.csg.cn" } });
    fireEvent.click(screen.getByRole("button", { name: "新增映射" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/owner-account-mappings", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("linyaqian@zh.gd.csg.cn")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "为 林雅茜 配置" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑 林雅茜" }));
    fireEvent.change(screen.getByLabelText("编辑 林雅茜 的工作负责人账号"), { target: { value: "linyaqian.updated@zh.gd.csg.cn" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/owner-account-mappings/${encodeURIComponent("林雅茜")}`,
      expect.objectContaining({ method: "PUT" }),
    ));
    expect(await screen.findByText("linyaqian.updated@zh.gd.csg.cn")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除 林雅茜" }));
    expect(confirm).toHaveBeenCalledWith("删除“林雅茜”的账号映射后，相关工作计划将立即显示为未配置。继续吗？");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/owner-account-mappings/${encodeURIComponent("林雅茜")}`,
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(await screen.findByRole("button", { name: "为 林雅茜 配置" })).toBeTruthy();
    view.unmount();
    confirm.mockRestore();
  });
});
