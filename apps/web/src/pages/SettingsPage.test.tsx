// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomFieldDefinition, ExportTemplate, OwnerAccountMapping } from "@workplan/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import AccountManagementPage from "./AccountManagementPage";
import SettingsPage from "./SettingsPage";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../App", () => ({ useSession: () => ({ user: { username: "lxj", role: "admin", loginMode: "password" } }) }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: apiMock,
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

let template: ExportTemplate;
let ownerMappings: OwnerAccountMapping[];
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
    if (path === "/export-templates") return [template];
    if (path === `/export-templates/${template.id}` && init?.method === "PATCH") {
      const input = JSON.parse(String(init.body)) as Pick<ExportTemplate, "name" | "sheetName" | "columns">;
      template = { ...template, ...input, version: template.version + 1, updatedAt: "2026-08-08T00:00:00.000Z" };
      return template;
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><SettingsPage /></ToastProvider></QueryClientProvider>);
}

function renderAccountManagementPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><AccountManagementPage /></ToastProvider></QueryClientProvider>);
}

describe("Excel template settings", () => {
  it("edits template metadata, custom-field columns, headers and order", async () => {
    const view = renderPage();
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
    const view = renderPage();
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
    const view = renderPage();
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

describe("account access settings", () => {
  it("creates a password editor that can use the Web login", async () => {
    const view = renderAccountManagementPage();
    expect(screen.getByRole("heading", { name: "账户管理" })).toBeTruthy();
    await screen.findByText("lxj");

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "Web 编辑者" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "very-secure-editor-password" } });
    fireEvent.click(screen.getByRole("button", { name: "创建编辑者" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/users", expect.objectContaining({ method: "POST" })));
    const createCall = apiMock.mock.calls.find(([path, init]) => path === "/users" && init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      username: "Web 编辑者",
      role: "editor",
      loginMode: "password",
      password: "very-secure-editor-password",
    });
    expect(await screen.findByText("Web 编辑者")).toBeTruthy();
    expect(screen.getByText("编辑者 · 密码登录")).toBeTruthy();
    expect(screen.queryByText("wp_one-time-secret")).toBeNull();
    view.unmount();
  });

  it("creates a 90-day token-only editor and reveals the token once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-09T04:00:00.000Z"));
    const view = renderAccountManagementPage();
    await screen.findByText("lxj");

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "测试" } });
    fireEvent.change(screen.getByLabelText("登录方式"), { target: { value: "token" } });
    fireEvent.change(screen.getByLabelText("初始 Token 名称"), { target: { value: "测试账户初始 Token" } });
    fireEvent.click(screen.getByRole("button", { name: "创建编辑者" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/users", expect.objectContaining({ method: "POST" })));
    const createCall = apiMock.mock.calls.find(([path, init]) => path === "/users" && init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      username: "测试",
      role: "editor",
      loginMode: "token",
      tokenName: "测试账户初始 Token",
      tokenExpiresAt: "2026-11-07T04:00:00.000Z",
    });
    expect(await screen.findByText("wp_one-time-secret")).toBeTruthy();
    expect(screen.getByText("测试")).toBeTruthy();
    view.unmount();
    vi.useRealTimers();
  });

  it("disables, re-enables, issues and revokes editor tokens", async () => {
    users.push({
      id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
      username: "测试",
      role: "editor",
      loginMode: "token",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [{ id: "4f1adba1-e070-4d42-9099-b59fc5c897de", name: "初始 Token", expiresAt: "2026-11-07T04:00:00.000Z", lastUsedAt: null, createdAt: "2026-08-09T00:00:00.000Z", version: 1 }],
    });
    const view = renderAccountManagementPage();
    await screen.findByText("测试");

    fireEvent.click(screen.getByRole("button", { name: "停用 测试" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/users/7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(await screen.findByText("已停用")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "启用 测试" }));
    await waitFor(() => expect(screen.getAllByText("已启用")).toHaveLength(2));

    fireEvent.change(screen.getByLabelText("测试 新 Token 名称"), { target: { value: "轮换 Token" } });
    fireEvent.click(screen.getByRole("button", { name: "为 测试 签发 Token" }));
    expect(await screen.findByText("wp_replacement-secret")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "撤销 测试 的 轮换 Token" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/users/7a55df50-0af4-4f3b-ad63-b6e7db1aab32/tokens/56a9da65-b8ef-4f20-938b-889abdbb13ab?version=1",
      expect.objectContaining({ method: "DELETE" }),
    ));

    fireEvent.change(screen.getByLabelText("测试 设置登录密码"), { target: { value: "converted-editor-password" } });
    fireEvent.click(screen.getByRole("button", { name: "启用密码登录" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/users/7a55df50-0af4-4f3b-ad63-b6e7db1aab32/password",
      expect.objectContaining({ method: "PUT" }),
    ));
    expect(await screen.findByText("编辑者 · 密码登录")).toBeTruthy();
    view.unmount();
  });
});
