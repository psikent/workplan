// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ToastProvider";
import AccountAccessSettings from "./AccountAccessSettings";

const apiMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  api: apiMock,
}));

type UserFixture = {
  id: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  loginMode: "password" | "token";
  disabledAt: string | null;
  version: number;
  createdAt: string;
  tokens: Array<{ id: string; name: string; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; version: number }>;
};

let users: UserFixture[];

const adminUser: UserFixture = {
  id: "0d433d19-78a1-4587-80c6-4058748d6f15",
  username: "lxj",
  role: "admin",
  loginMode: "password",
  disabledAt: null,
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  tokens: [],
};

beforeEach(() => {
  clipboardWriteTextMock.mockReset();
  Object.assign(navigator, { clipboard: { writeText: clipboardWriteTextMock } });
  users = [adminUser];
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/users" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as {
        username: string;
        role: "editor" | "viewer";
        loginMode: "password" | "token";
        password?: string;
        tokenName?: string;
        tokenExpiresAt?: string;
      };
      const tokens = input.loginMode === "token"
        ? [{ id: "4f1adba1-e070-4d42-9099-b59fc5c897de", name: input.tokenName!, expiresAt: input.tokenExpiresAt!, lastUsedAt: null, createdAt: "2026-08-09T00:00:00.000Z", version: 1 }]
        : [];
      const user: UserFixture = {
        id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
        username: input.username,
        role: input.role,
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
    const userDeleteMatch = path.match(/^\/users\/([^/?]+)\?version=\d+$/);
    if (userDeleteMatch && init?.method === "DELETE") {
      users = users.filter((item) => item.id !== userDeleteMatch[1]);
      return { deleted: true };
    }
    if (path === "/users") return users;
    throw new Error(`Unexpected API path: ${path}`);
  });
});

function renderAccountAccessSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><AccountAccessSettings /></ToastProvider></QueryClientProvider>);
}

describe("account access settings", () => {
  it("defaults the account type to editor and keeps the existing editor payload", async () => {
    const view = renderAccountAccessSettings();
    expect(screen.getByText("账户与访问 Token")).toBeTruthy();
    await screen.findByText("lxj");

    const accountType = screen.getByLabelText("账户类型") as HTMLSelectElement;
    expect(accountType.value).toBe("editor");
    expect(screen.getByRole("button", { name: "创建编辑者" })).toBeTruthy();

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
    const view = renderAccountAccessSettings();
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
    const view = renderAccountAccessSettings();
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

  it("creates a password viewer with the viewer role and read-only labels", async () => {
    const view = renderAccountAccessSettings();
    await screen.findByText("lxj");

    fireEvent.change(screen.getByLabelText("账户类型"), { target: { value: "viewer" } });
    expect(screen.getByRole("button", { name: "创建只读账户" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "只读同事" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "very-secure-viewer-password" } });
    fireEvent.click(screen.getByRole("button", { name: "创建只读账户" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/users", expect.objectContaining({ method: "POST" })));
    const createCall = apiMock.mock.calls.find(([path, init]) => path === "/users" && init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      username: "只读同事",
      role: "viewer",
      loginMode: "password",
      password: "very-secure-viewer-password",
    });
    expect(await screen.findByText("只读同事")).toBeTruthy();
    expect(screen.getByText("只读账户 · 密码登录")).toBeTruthy();
    expect(await screen.findByText("只读账户已创建")).toBeTruthy();
    view.unmount();
  });

  it("creates a token-only viewer, reveals the one-time token and keeps lifecycle controls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-09T04:00:00.000Z"));
    const view = renderAccountAccessSettings();
    await screen.findByText("lxj");

    fireEvent.change(screen.getByLabelText("账户类型"), { target: { value: "viewer" } });
    fireEvent.change(screen.getByLabelText("登录方式"), { target: { value: "token" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "只读接口" } });
    fireEvent.change(screen.getByLabelText("初始 Token 名称"), { target: { value: "查询导出 Token" } });
    fireEvent.click(screen.getByRole("button", { name: "创建只读账户" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/users", expect.objectContaining({ method: "POST" })));
    const createCall = apiMock.mock.calls.find(([path, init]) => path === "/users" && init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      username: "只读接口",
      role: "viewer",
      loginMode: "token",
      tokenName: "查询导出 Token",
      tokenExpiresAt: "2026-11-07T04:00:00.000Z",
    });
    expect(await screen.findByText("wp_one-time-secret")).toBeTruthy();
    expect(screen.getByText("只读接口")).toBeTruthy();

    expect(await screen.findByText("只读账户 · 仅 API Token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "停用 只读接口" })).toBeTruthy();
    expect(screen.getByLabelText("只读接口 设置登录密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "为 只读接口 签发 Token" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "撤销 只读接口 的 查询导出 Token" })).toBeTruthy();
    view.unmount();
    vi.useRealTimers();
  });

  it("disables and re-enables a viewer like an editor", async () => {
    users.push({
      id: "9c1d2a34-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      username: "只读同事",
      role: "viewer",
      loginMode: "password",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [],
    });
    const view = renderAccountAccessSettings();
    await screen.findByText("只读同事");

    fireEvent.click(screen.getByRole("button", { name: "停用 只读同事" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/users/9c1d2a34-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(JSON.parse(String(apiMock.mock.calls.find(([path, init]) => path === "/users/9c1d2a34-5e6f-4a7b-8c9d-0e1f2a3b4c5d" && init?.method === "PATCH")?.[1]?.body))).toEqual({ disabled: true, version: 1 });
    expect(await screen.findByText("已停用")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "启用 只读同事" }));
    await waitFor(() => expect(screen.getAllByText("已启用")).toHaveLength(2));
    view.unmount();
  });

  it("offers no role conversion entry on account cards", async () => {
    users.push({
      id: "9c1d2a34-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      username: "只读同事",
      role: "viewer",
      loginMode: "password",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [],
    });
    const view = renderAccountAccessSettings();
    await screen.findByText("只读同事");

    const accountList = document.querySelector<HTMLElement>(".account-list")!;;
    expect(accountList).toBeTruthy();
    expect(within(accountList).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(accountList).queryAllByRole("button", { name: /转换|改为|角色/ })).toHaveLength(0);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByLabelText("账户类型")).toBeTruthy();
    view.unmount();
  });

  it("renders the delete button only on non-admin cards", async () => {
    users.push({
      id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
      username: "可删账户",
      role: "editor",
      loginMode: "password",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [],
    });
    const view = renderAccountAccessSettings();
    await screen.findByText("可删账户");

    expect(screen.getByRole("button", { name: "删除 可删账户" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除 lxj" })).toBeNull();
    view.unmount();
  });

  it("asks for confirmation and deletes without a request when cancelled", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);
    users.push({
      id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
      username: "可删账户",
      role: "editor",
      loginMode: "password",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [],
    });
    const view = renderAccountAccessSettings();
    await screen.findByText("可删账户");

    fireEvent.click(screen.getByRole("button", { name: "删除 可删账户" }));
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("可删账户"));
    expect(confirmMock.mock.calls[0]![0]).toContain("访问 Token 将一并失效");
    expect(apiMock).not.toHaveBeenCalledWith("/users/7a55df50-0af4-4f3b-ad63-b6e7db1aab32?version=1", expect.objectContaining({ method: "DELETE" }));
    view.unmount();
    confirmMock.mockRestore();
  });

  it("deletes an account after confirmation and refreshes the list", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    users.push({
      id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
      username: "可删账户",
      role: "editor",
      loginMode: "password",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [],
    });
    const view = renderAccountAccessSettings();
    await screen.findByText("可删账户");

    fireEvent.click(screen.getByRole("button", { name: "删除 可删账户" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/users/7a55df50-0af4-4f3b-ad63-b6e7db1aab32?version=1",
      expect.objectContaining({ method: "DELETE" }),
    ));
    await waitFor(() => expect(screen.queryByText("可删账户")).toBeNull());
    expect(await screen.findByText("账户已删除")).toBeTruthy();
    view.unmount();
    confirmMock.mockRestore();
  });

  it("shows the error message when deletion fails", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    users.push({
      id: "7a55df50-0af4-4f3b-ad63-b6e7db1aab32",
      username: "删不掉的账户",
      role: "editor",
      loginMode: "password",
      disabledAt: null,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      tokens: [],
    });
    const defaultApi = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith("/users/") && init?.method === "DELETE") {
        throw new Error("数据已被修改，请刷新后重试");
      }
      return defaultApi(path, init);
    });
    const view = renderAccountAccessSettings();
    await screen.findByText("删不掉的账户");

    fireEvent.click(screen.getByRole("button", { name: "删除 删不掉的账户" }));
    expect(await screen.findByText("数据已被修改，请刷新后重试")).toBeTruthy();
    view.unmount();
    confirmMock.mockRestore();
  });
});
