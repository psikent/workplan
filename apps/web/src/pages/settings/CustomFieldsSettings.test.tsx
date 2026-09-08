// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomFieldDefinition } from "@workplan/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ToastProvider";
import CustomFieldsSettings from "./CustomFieldsSettings";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  api: apiMock,
}));

const firstField = field({
  id: "2bc22cf4-a6f9-46a7-84e7-59df1fd7ba76",
  key: "first",
  label: "字段甲",
  sortOrder: 0,
});
const secondField = field({
  id: "2ef4dd62-fd78-410a-9b24-9d83c524ec2f",
  key: "second",
  label: "字段乙",
  sortOrder: 1,
  collapsed: true,
});
const remarksField = field({
  id: "4b8a1f20-9c14-4a5e-8f3d-2a7c6b1e0d55",
  key: "remarks",
  label: "备注",
  type: "single_select",
  sortOrder: 0,
  options: [
    { id: "0b6fd15b-9e6d-4c2a-9a4e-6f0a1c3d5e01", value: "duty", label: "1.值班", sortOrder: 0, archivedAt: null, version: 1 },
    { id: "0b6fd15b-9e6d-4c2a-9a4e-6f0a1c3d5e02", value: "automation", label: "4.自动化", sortOrder: 1, archivedAt: null, version: 1 },
    { id: "0b6fd15b-9e6d-4c2a-9a4e-6f0a1c3d5e03", value: "trip", label: "3.出差", sortOrder: 2, archivedAt: "2026-09-01T00:00:00.000Z", version: 2 },
  ],
});

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/custom-fields?includeArchived=true") return [remarksField, firstField, secondField];
    return {};
  });
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CustomFieldsSettings />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("custom field management", () => {
  it("opens the create dialog from the panel header entry", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");

    fireEvent.click(screen.getByRole("button", { name: "新建字段" }));

    expect(screen.getByRole("heading", { name: "新建自定义字段" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "自定义字段", level: 1 })).toBeNull();
    view.unmount();
  });

  it("edits an existing field while keeping its stable key and type immutable", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");

    fireEvent.click(screen.getByRole("button", { name: "编辑 字段甲" }));
    expect(screen.getByLabelText(/稳定键/)).toBeDisabled();
    expect(screen.getByLabelText(/字段类型/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/字段名称/), { target: { value: "字段甲（已更新）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/custom-fields/${firstField.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"label":"字段甲（已更新）"'),
      }),
    ));
    expect(await screen.findByText("字段已保存")).toBeTruthy();
    view.unmount();
  });

  it("reorders fields with the accessible move controls", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");

    fireEvent.click(screen.getByRole("button", { name: "下移 字段甲" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/custom-fields/reorder",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ orderedIds: [remarksField.id, secondField.id, firstField.id] }),
      }),
    ));
    view.unmount();
  });

  it("renders the collapsed column from the field definition", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");

    expect(screen.getByText("折叠")).toBeTruthy();
    const rows = document.querySelectorAll(".fields-table:not(.table-head)");
    expect(rows.length).toBe(3);
    // 列序：拖拽把手/名称/稳定键/类型/必填/折叠/默认值 → 索引 5 为折叠列。
    const collapsedCells = [...rows].map((row) => row.children[5]!.textContent);
    expect(collapsedCells).toEqual(["否", "否", "是"]);
    view.unmount();
  });

  it("sends collapsed on create when the dialog switch is turned on", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");

    fireEvent.click(screen.getByRole("button", { name: "新建字段" }));
    fireEvent.change(screen.getByLabelText(/字段名称/), { target: { value: "补充说明" } });
    fireEvent.click(screen.getByRole("button", { name: "折叠" }));
    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/custom-fields",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"collapsed":true'),
      }),
    ));
    expect(await screen.findByText("字段已创建")).toBeTruthy();
    view.unmount();
  });

  it("sends collapsed on edit when the dialog switch is toggled", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");

    fireEvent.click(screen.getByRole("button", { name: "编辑 字段甲" }));
    expect((screen.getByRole("button", { name: "折叠" }).getAttribute("aria-pressed"))).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "折叠" }));
    expect((screen.getByRole("button", { name: "折叠" }).getAttribute("aria-pressed"))).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/custom-fields/${firstField.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"collapsed":true'),
      }),
    ));
    expect(await screen.findByText("字段已保存")).toBeTruthy();
    view.unmount();
  });
});

describe("custom field option reorder", () => {
  it("renders option move controls with boundary and archived rows still sortable", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");
    fireEvent.click(screen.getByRole("button", { name: "编辑 备注" }));
    await screen.findByPlaceholderText("选项 1");

    expect(screen.getByRole("button", { name: "上移选项 1.值班" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移选项 1.值班" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上移选项 3.出差" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移选项 3.出差" })).toBeDisabled();
    view.unmount();
  });

  it("keeps moved options in the draft and submits one reorder call on save, including archived rows", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");
    fireEvent.click(screen.getByRole("button", { name: "编辑 备注" }));
    await screen.findByPlaceholderText("选项 1");

    fireEvent.click(screen.getByRole("button", { name: "下移选项 1.值班" }));
    expect(apiMock).not.toHaveBeenCalledWith(
      `/custom-fields/${remarksField.id}/options/reorder`,
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    const [duty, automation, trip] = remarksField.options;
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      `/custom-fields/${remarksField.id}/options/reorder`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ orderedIds: [automation!.id, duty!.id, trip!.id] }),
      }),
    ));
    expect(await screen.findByText("字段已保存")).toBeTruthy();
    view.unmount();
  });

  it("skips the reorder call when the option order is unchanged", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");
    fireEvent.click(screen.getByRole("button", { name: "编辑 备注" }));
    await screen.findByPlaceholderText("选项 1");

    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    await screen.findByText("字段已保存");
    expect(apiMock).not.toHaveBeenCalledWith(
      `/custom-fields/${remarksField.id}/options/reorder`,
      expect.anything(),
    );
    view.unmount();
  });

  it("discards draft moves on cancel without any write call", async () => {
    const view = renderSettings();
    await screen.findByText("字段甲");
    fireEvent.click(screen.getByRole("button", { name: "编辑 备注" }));
    await screen.findByPlaceholderText("选项 1");

    fireEvent.click(screen.getByRole("button", { name: "下移选项 1.值班" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    const writes = apiMock.mock.calls.filter(([path, options]) =>
      path !== "/custom-fields?includeArchived=true" && (options as { method?: string } | undefined)?.method);
    expect(writes).toEqual([]);
    view.unmount();
  });
});

function field(overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "c9208bb9-0634-41db-bfc6-064bcfd39b7d",
    key: "field",
    label: "字段",
    description: "",
    type: "short_text",
    required: false,
    collapsed: false,
    defaultValue: null,
    sortOrder: 0,
    archivedAt: null,
    version: 1,
    options: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}
