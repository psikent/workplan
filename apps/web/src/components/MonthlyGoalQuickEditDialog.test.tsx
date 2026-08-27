// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MonthlyGoal } from "@workplan/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ToastProvider";
import MonthlyGoalQuickEditDialog from "./MonthlyGoalQuickEditDialog";
import { ApiError } from "../lib/api";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: apiMock,
}));

function goal(id: string, overrides: Partial<MonthlyGoal> = {}): MonthlyGoal {
  return {
    id,
    title: "年度目标",
    description: "保留说明",
    year: 2026,
    month: 1,
    archivedAt: null,
    version: 1,
    status: null,
    linkedWorkPlan: null,
    seriesId: null,
    occurrenceKey: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let storedGoals: MonthlyGoal[] = [];
let previousYearGoals: MonthlyGoal[] = [];

function renderDialog(onClose = vi.fn(), onSaved = vi.fn(), initialYear = 2026) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onClose, onSaved, ...render(<QueryClientProvider client={client}><ToastProvider><MonthlyGoalQuickEditDialog initialYear={initialYear} onClose={onClose} onSaved={onSaved} /></ToastProvider></QueryClientProvider>) };
}

beforeEach(() => {
  storedGoals = [];
  previousYearGoals = [];
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/monthly-goals?year=")) return path.includes("year=2025") ? previousYearGoals : storedGoals;
    if (path === "/monthly-goals/quick-edit" && init?.method === "PUT") return { createdCount: 0, updatedCount: 1, goals: storedGoals };
    throw new Error(`Unexpected API path: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MonthlyGoalQuickEditDialog", () => {
  it("aggregates archived, series and duplicate same-month instances", async () => {
    storedGoals = [
      goal("10000000-0000-4000-8000-000000000001", { title: "  年度目标 ", month: 1, createdAt: "2026-01-02T00:00:00.000Z" }),
      goal("10000000-0000-4000-8000-000000000002", { title: "年度目标", month: 1, archivedAt: "2026-01-05T00:00:00.000Z", version: 2 }),
      goal("10000000-0000-4000-8000-000000000003", { title: "年度目标", month: 3, seriesId: "20000000-0000-4000-8000-000000000001", occurrenceKey: "2026-03" }),
      goal("10000000-0000-4000-8000-000000000004", { title: "仅归档", month: 2, archivedAt: "2026-01-06T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z" }),
    ];

    const view = renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    await within(dialog).findByLabelText("年度目标，目标名称");
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
    expect(within(dialog).getByDisplayValue("年度目标")).toBeTruthy();
    expect(within(dialog).getByLabelText("年度目标，1 月")).toBeChecked();
    expect(within(dialog).getByLabelText("年度目标，3 月")).toBeChecked();
    expect(within(dialog).getByLabelText("仅归档，2 月")).not.toBeChecked();
    expect(apiMock.mock.calls.some(([path]) => path === "/monthly-goals?year=2026&includeArchived=true")).toBe(true);
    view.unmount();
  });

  it("keeps one blank row, validates new rows and submits a trimmed sorted payload", async () => {
    const saved = renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    const name = await within(dialog).findByLabelText("第 1 行，目标名称");

    fireEvent.change(name, { target: { value: " 新目标 " } });
    expect(within(dialog).getByText("新行至少选择一个月份")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.click(within(dialog).getByLabelText("新目标，2 月"));
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.mock.calls.some(([path, init]) => path === "/monthly-goals/quick-edit" && init?.method === "PUT")).toBe(true));
    const [, init] = apiMock.mock.calls.find(([path, request]) => path === "/monthly-goals/quick-edit" && request?.method === "PUT")!;
    expect(JSON.parse(String(init.body))).toEqual({ year: 2026, baseline: [], rows: [{ originalTitle: null, title: "新目标", activeMonths: [2] }] });
    await waitFor(() => expect(saved.onSaved).toHaveBeenCalledWith(2026));
  });

  it("blocks duplicate final names and protects dirty cancellation", async () => {
    storedGoals = [
      goal("30000000-0000-4000-8000-000000000001", { title: "甲目标" }),
      goal("30000000-0000-4000-8000-000000000002", { title: "乙目标", month: 2, createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose } = renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    await within(dialog).findByLabelText("甲目标，目标名称");
    fireEvent.change(within(dialog).getByLabelText("甲目标，目标名称"), { target: { value: "乙目标" } });
    expect(within(dialog).getAllByText("目标名称不能重复")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the draft after a version conflict until reload is confirmed", async () => {
    storedGoals = [goal("40000000-0000-4000-8000-000000000001")];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/monthly-goals?year=")) return storedGoals;
      if (path === "/monthly-goals/quick-edit" && init?.method === "PUT") throw new ApiError({ status: 409, code: "VERSION_CONFLICT", detail: "版本冲突" });
      throw new Error(`Unexpected API path: ${path}`);
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    await within(dialog).findByLabelText("年度目标，目标名称");
    fireEvent.change(within(dialog).getByLabelText("年度目标，目标名称"), { target: { value: "改名" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(await within(dialog).findByText("数据已变化，请重新载入后重试")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "重新载入" }));
    expect(confirm).toHaveBeenCalled();
    expect(within(dialog).getByDisplayValue("改名")).toBeTruthy();
  });

  it("confirms dirty year changes and keeps the editor when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    const name = await within(dialog).findByLabelText("第 1 行，目标名称");
    fireEvent.change(name, { target: { value: "未保存目标" } });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "2027" } });
    expect(confirm).toHaveBeenCalledWith("切换年份将放弃未保存修改，确定继续吗？");
    expect(within(dialog).getByRole("combobox")).toHaveValue("2026");
    expect(within(dialog).getByDisplayValue("未保存目标")).toBeTruthy();
  });

  it("keeps the draft and reports ordinary save errors", async () => {
    storedGoals = [goal("50000000-0000-4000-8000-000000000001")];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/monthly-goals?year=")) return storedGoals;
      if (path === "/monthly-goals/quick-edit" && init?.method === "PUT") throw new Error("保存失败");
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    const name = await within(dialog).findByLabelText("年度目标，目标名称");
    fireEvent.change(name, { target: { value: "保存失败草稿" } });
    fireEvent.click(within(dialog).getByLabelText("保存失败草稿，2 月"));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("保存失败");
    expect(within(dialog).getByDisplayValue("保存失败草稿")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("copies the previous active title-month matrix into the current-year draft", async () => {
    storedGoals = [
      goal("60000000-0000-4000-8000-000000000001", { title: "同名目标", month: 1, version: 3 }),
      goal("60000000-0000-4000-8000-000000000002", { title: "同名目标", month: 4, archivedAt: "2026-04-02T00:00:00.000Z", version: 2 }),
      goal("60000000-0000-4000-8000-000000000003", { title: "本年独有", month: 3, createdAt: "2026-01-03T00:00:00.000Z" }),
    ];
    previousYearGoals = [
      goal("61000000-0000-4000-8000-000000000001", { title: " 同名目标 ", year: 2025, month: 2, createdAt: "2025-01-01T00:00:00.000Z" }),
      goal("61000000-0000-4000-8000-000000000002", { title: "同名目标", year: 2025, month: 5, archivedAt: "2025-05-02T00:00:00.000Z" }),
      goal("61000000-0000-4000-8000-000000000003", { title: "去年独有", year: 2025, month: 6, createdAt: "2025-01-02T00:00:00.000Z" }),
      goal("61000000-0000-4000-8000-000000000004", { title: "仅归档来源", year: 2025, month: 7, archivedAt: "2025-07-02T00:00:00.000Z" }),
    ];

    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    const copy = await within(dialog).findByRole("button", { name: "复制 2025 年月目标" });
    const add = within(dialog).getByRole("button", { name: "新增一行" });
    expect(Boolean(copy.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    fireEvent.click(copy);

    expect(await within(dialog).findByText("已复制 2025 年月目标，请确认后保存")).toBeTruthy();
    expect(within(dialog).getByLabelText("同名目标，1 月")).not.toBeChecked();
    expect(within(dialog).getByLabelText("同名目标，2 月")).toBeChecked();
    expect(within(dialog).getByLabelText("同名目标，5 月")).not.toBeChecked();
    expect(within(dialog).getByLabelText("去年独有，6 月")).toBeChecked();
    expect(within(dialog).getByLabelText("本年独有，3 月")).not.toBeChecked();
    expect(within(dialog).queryByDisplayValue("仅归档来源")).toBeNull();
    expect(apiMock.mock.calls.some(([path]) => path === "/monthly-goals?year=2025&includeArchived=true")).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(apiMock.mock.calls.some(([path, init]) => path === "/monthly-goals/quick-edit" && init?.method === "PUT")).toBe(true));
    const [, init] = apiMock.mock.calls.find(([path, request]) => path === "/monthly-goals/quick-edit" && request?.method === "PUT")!;
    expect(JSON.parse(String(init.body))).toEqual({
      year: 2026,
      baseline: [
        { id: "60000000-0000-4000-8000-000000000001", version: 3 },
        { id: "60000000-0000-4000-8000-000000000002", version: 2 },
        { id: "60000000-0000-4000-8000-000000000003", version: 1 },
      ],
      rows: [
        { originalTitle: "同名目标", title: "同名目标", activeMonths: [2] },
        { originalTitle: null, title: "去年独有", activeMonths: [6] },
        { originalTitle: "本年独有", title: "本年独有", activeMonths: [] },
      ],
    });
  });

  it("protects a dirty draft before copying and rebuilds from the server snapshot after confirmation", async () => {
    storedGoals = [goal("70000000-0000-4000-8000-000000000001", { title: "本年目标" })];
    previousYearGoals = [goal("71000000-0000-4000-8000-000000000001", { title: "去年目标", year: 2025, month: 8 })];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    const name = await within(dialog).findByLabelText("本年目标，目标名称");
    fireEvent.change(name, { target: { value: "未保存改名" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "复制 2025 年月目标" }));
    expect(confirm).toHaveBeenCalledWith("复制去年将放弃当前未保存修改，确定继续吗？");
    expect(within(dialog).getByDisplayValue("未保存改名")).toBeTruthy();
    expect(apiMock.mock.calls.some(([path]) => path === "/monthly-goals?year=2025&includeArchived=true")).toBe(false);

    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "复制 2025 年月目标" }));
    expect(await within(dialog).findByDisplayValue("去年目标")).toBeTruthy();
    expect(within(dialog).queryByDisplayValue("未保存改名")).toBeNull();
    expect(within(dialog).getByDisplayValue("本年目标")).toBeTruthy();
  });

  it("preserves the current draft when the previous year is empty or fails to load", async () => {
    let previousRequests = 0;
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("year=2025")) {
        previousRequests += 1;
        if (previousRequests === 1) return [];
        if (previousRequests === 2) throw new Error("读取失败");
        return [goal("81000000-0000-4000-8000-000000000001", { title: "重试成功", year: 2025, month: 9 })];
      }
      if (path.startsWith("/monthly-goals?year=")) return storedGoals;
      if (path === "/monthly-goals/quick-edit" && init?.method === "PUT") return { createdCount: 0, updatedCount: 1, goals: storedGoals };
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    const name = await within(dialog).findByLabelText("第 1 行，目标名称");
    fireEvent.change(name, { target: { value: "保留草稿" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "复制 2025 年月目标" }));
    expect(await within(dialog).findByText("2025 年没有可复制的月目标")).toBeTruthy();
    expect(within(dialog).getByDisplayValue("保留草稿")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "复制 2025 年月目标" }));
    expect(await within(dialog).findByText("读取失败")).toHaveAttribute("role", "alert");
    expect(within(dialog).getByDisplayValue("保留草稿")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "复制 2025 年月目标" }));
    expect(await within(dialog).findByDisplayValue("重试成功")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("keeps save disabled when the previous year structure is identical", async () => {
    storedGoals = [goal("90000000-0000-4000-8000-000000000001", { title: "相同目标", month: 2 })];
    previousYearGoals = [goal("91000000-0000-4000-8000-000000000001", { title: "相同目标", year: 2025, month: 2 })];
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "复制 2025 年月目标" }));
    expect(await within(dialog).findByText("2025 年月目标与当前年度结构一致")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("disables copying when the selected year has no supported previous year", async () => {
    renderDialog(vi.fn(), vi.fn(), 2000);
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    expect(await within(dialog).findByRole("button", { name: "复制去年月目标" })).toBeDisabled();
    expect(apiMock.mock.calls.some(([path]) => path.includes("year=1999"))).toBe(false);
  });
});
