// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomFieldDefinition } from "@workplan/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import CustomFieldsPage from "./CustomFieldsPage";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
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
});

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/custom-fields?includeArchived=true") return [firstField, secondField];
    return {};
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CustomFieldsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("custom field management", () => {
  it("edits an existing field while keeping its stable key and type immutable", async () => {
    const view = renderPage();
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
    const view = renderPage();
    await screen.findByText("字段甲");

    fireEvent.click(screen.getByRole("button", { name: "下移 字段甲" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/custom-fields/reorder",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ orderedIds: [secondField.id, firstField.id] }),
      }),
    ));
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
