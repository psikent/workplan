// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { compareWorkPlansBySchedule } from "@workplan/contracts";
import type { CustomFieldDefinition, ExportTemplate, MonthlyGoal, WorkPlan, WorkPlanQueryRequest, WorkPlanQueryResponse } from "@workplan/contracts";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import WorkPlansPage from "./WorkPlansPage";

const apiMock = vi.hoisted(() => vi.fn());
const fetchRemindersMock = vi.hoisted(() => vi.fn());
const downloadWorkPlansXlsCustomMock = vi.hoisted(() => vi.fn());
const fileToBase64Mock = vi.hoisted(() => vi.fn());
const drawerPropsMock = vi.hoisted(() => vi.fn());
const ganttPropsMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  user: { id: "user-lxj", username: "lxj", role: "admin" as "admin" | "editor" | "viewer", loginMode: "password" as "password" | "token" },
}));

vi.mock("../App", () => ({
  useSession: () => ({ user: sessionMock.user, signOut: vi.fn() }),
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: apiMock,
  fetchReminders: fetchRemindersMock,
  downloadWorkPlansXlsCustom: downloadWorkPlansXlsCustomMock,
  fileToBase64: fileToBase64Mock,
}));

vi.mock("../components/GanttTimeline", () => ({
  default: (props: unknown) => {
    ganttPropsMock(props);
    return <div data-testid="gantt-timeline" />;
  },
}));
vi.mock("../components/WorkPlanDrawer", () => ({
  default: (props: unknown) => {
    drawerPropsMock(props);
    return null;
  },
}));

const plan: WorkPlan = {
  id: "b70cff45-b93c-4dff-ab87-e15ef3d2494f",
  title: "示例计划",
  description: "",
  status: "pending",
  statusMode: "automatic",
  startAt: new Date(2026, 7, 8, 10).toISOString(),
  endAt: new Date(2026, 7, 8, 12).toISOString(),
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: { owner: "lxj", effort: 8 },
  monthlyGoalIds: [],
  ownerAccount: null,
  ownerConflict: null,
  createdAt: new Date(2026, 7, 1).toISOString(),
  updatedAt: new Date(2026, 7, 1).toISOString(),
};
const copiedPlanId = "cd230f99-29ae-4d04-82fc-2eb710b5c861";
const trailingPlan: WorkPlan = {
  ...plan,
  id: "ec718abc-5257-490a-b30f-daa8b86f7ed9",
  title: "后续计划",
};

const ownerField: CustomFieldDefinition = {
  id: "f9a9dc48-e819-4b1b-89a3-ee680649e842",
  key: "owner",
  label: "负责人",
  description: "",
  type: "short_text",
  required: false,
  sortOrder: 0,
  defaultValue: null,
  archivedAt: null,
  version: 1,
  options: [],
  createdAt: new Date(2026, 7, 1).toISOString(),
  updatedAt: new Date(2026, 7, 1).toISOString(),
};

const effortField: CustomFieldDefinition = {
  ...ownerField,
  id: "d9da12af-f852-4ccf-b523-572c8bd35cb9",
  key: "effort",
  label: "工时",
  type: "number",
};

const exportTemplate: ExportTemplate = {
  id: "8b8f906c-b4e9-4b10-890e-6582e0c48ec2",
  name: "标准工作计划",
  sheetName: "工作计划",
  columns: [
    { source: "title", header: "工作内容" },
    { source: "startAt", header: "开始时间" },
    { source: "endAt", header: "结束时间" },
  ],
  version: 1,
  createdAt: new Date(2026, 7, 1).toISOString(),
  updatedAt: new Date(2026, 7, 1).toISOString(),
};

const monthlyGoal: MonthlyGoal = {
  id: "7c1e2d3f-aaaa-4bbb-8ccc-0123456789ab",
  title: "完成官网改版",
  description: "",
  year: 2026,
  month: 8,
  archivedAt: null,
  version: 1,
  status: "pending",
  linkedWorkPlan: null,
  seriesId: null,
  occurrenceKey: null,
  createdAt: new Date(2026, 7, 1).toISOString(),
  updatedAt: new Date(2026, 7, 1).toISOString(),
};

beforeEach(() => {
  sessionMock.user = { id: "user-lxj", username: "lxj", role: "admin", loginMode: "password" };
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 8, 9));
  apiMock.mockClear();
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/export-templates") return [exportTemplate];
    if (path === "/owner-account-mappings") return [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }];
    if (path === "/work-plans/import.xls") return { imported: 1 };
    if (path.startsWith("/work-plan-series")) return [];
    if (path === "/monthly-goals") return [monthlyGoal];
    if (path === "/work-plans/query" && init?.method === "POST") return emulateQuery([plan], init);
    if (path.startsWith("/work-plans")) return [plan];
    if (path.startsWith("/custom-fields")) return [ownerField, effortField];
    throw new Error(`Unexpected API path: ${path}`);
  });
  fetchRemindersMock.mockClear();
  fetchRemindersMock.mockResolvedValue({ days: [] });
  drawerPropsMock.mockClear();
  ganttPropsMock.mockClear();
  downloadWorkPlansXlsCustomMock.mockResolvedValue(undefined);
  fileToBase64Mock.mockResolvedValue("ZmFrZQ==");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function LocationProbe({ locationRef }: { locationRef: { current: string } }) {
  const location = useLocation();
  locationRef.current = location.search;
  return null;
}

function renderPage(initialEntry = "/work-plans", locationRef?: { current: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          {locationRef ? <LocationProbe locationRef={locationRef} /> : null}
          <WorkPlansPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function headerLabels(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".planner-columns > span"), (node) => node.textContent ?? "");
}

// 最小引擎仿真：与统一查询一致的范围/筛选语义与排期兜底顺序，供页面测试使用。
function emulateQuery(storedPlans: WorkPlan[], init?: RequestInit): WorkPlanQueryResponse {
  const body = init?.body
    ? JSON.parse(String(init.body)) as WorkPlanQueryRequest
    : { filters: [], range: {}, sort: [], limit: 100 } as WorkPlanQueryRequest;
  const needle = body.q?.toLocaleLowerCase();
  const filtered = storedPlans.filter((candidate) => {
    if (needle && !`${candidate.title} ${candidate.description}`.toLocaleLowerCase().includes(needle)) return false;
    for (const filter of body.filters) {
      const actual = filter.field.startsWith("custom.")
        ? candidate.customFields[filter.field.slice("custom.".length)]
        : (candidate as unknown as Record<string, unknown>)[filter.field];
      if (filter.op === "eq" && actual !== filter.value) return false;
      if (filter.op === "neq" && actual === filter.value) return false;
      if (filter.op === "contains" && !String(actual ?? "").toLocaleLowerCase().includes(String(filter.value ?? "").toLocaleLowerCase())) return false;
      if (filter.op === "any") {
        const actualList = Array.isArray(actual) ? actual : [actual];
        const expected = Array.isArray(filter.value) ? filter.value : [filter.value];
        if (!expected.some((value) => actualList.includes(value))) return false;
      }
      if (["gt", "gte", "lt", "lte"].includes(filter.op)) {
        const left = Date.parse(String(actual));
        const right = Date.parse(String(filter.value));
        if (Number.isNaN(left) || Number.isNaN(right)) return false;
        if (filter.op === "gt" && !(left > right)) return false;
        if (filter.op === "gte" && !(left >= right)) return false;
        if (filter.op === "lt" && !(left < right)) return false;
        if (filter.op === "lte" && !(left <= right)) return false;
      }
    }
    const from = body.range.from ? Date.parse(body.range.from) : null;
    const to = body.range.to ? Date.parse(body.range.to) : null;
    if (from !== null && !(Date.parse(candidate.endAt) > from)) return false;
    if (to !== null && !(Date.parse(candidate.startAt) < to)) return false;
    return true;
  });
  const items = [...filtered].sort(compareWorkPlansBySchedule);
  return { items, total: items.length, evaluatedAt: new Date(2026, 7, 8, 9).toISOString(), nextCursor: null };
}

function mockMutableWorkPlans(initialPlans: WorkPlan[] = [plan]) {
  let storedPlans = initialPlans;
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/export-templates") return [exportTemplate];
    if (path === "/owner-account-mappings") return [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }];
    if (path.startsWith("/work-plan-series")) return [];
    if (path.startsWith("/custom-fields")) return [ownerField, effortField];
    if (path === "/monthly-goals") return [monthlyGoal];
    if (path === "/work-plans/query" && init?.method === "POST") return emulateQuery(storedPlans, init);
    if (path === "/work-plans" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as Partial<WorkPlan>;
      const copied = { ...plan, ...input, id: copiedPlanId, sortOrder: storedPlans.length, version: 1 };
      storedPlans = [...storedPlans, copied];
      return copied;
    }
    if (path.startsWith("/work-plans")) return storedPlans;
    throw new Error(`Unexpected API path: ${path}`);
  });
}

describe("editor permissions", () => {
  it("keeps work plan export and editing while hiding import and template management", async () => {
    sessionMock.user = { id: "user-editor", username: "测试", role: "editor", loginMode: "password" };
    const view = renderPage();
    await screen.findByText("示例计划");

    expect(screen.getByRole("button", { name: /导出 XLS/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建工作计划" })).toBeTruthy();
    expect(screen.queryByText("导入 XLS")).toBeNull();
    // 编辑角色没有导入权限：拆分按钮不渲染下拉箭头
    expect(screen.queryByRole("button", { name: "导入 XLS" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /导出 XLS/ }));
    expect(screen.queryByLabelText("另存为模板名称")).toBeNull();
    expect(screen.getByRole("button", { name: "导出" })).toBeTruthy();
    view.unmount();
  });
});

describe("plan create split button", () => {
  it("sits at the filter toolbar's right edge and toggles the import dropdown", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const toolbar = view.container.querySelector(".filter-toolbar");
    const createButton = screen.getByRole("button", { name: "新建工作计划" });
    const importArrow = screen.getByRole("button", { name: "导入 XLS" });
    expect(toolbar!.contains(createButton)).toBe(true);
    expect(toolbar!.contains(importArrow)).toBe(true);
    expect(createButton.closest(".plan-create-split")).not.toBeNull();
    expect(importArrow.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector('input[type="file"][accept*=".xls"]')).toBeNull();

    fireEvent.click(importArrow);
    expect(importArrow.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.querySelector('input[type="file"][accept*=".xls"]')).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(view.container.querySelector('input[type="file"][accept*=".xls"]')).toBeNull());
    expect(importArrow.getAttribute("aria-expanded")).toBe("false");
    view.unmount();
  });
});

describe("mobile work plan header layout", () => {
  it("keeps the template and export controls in the page header", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const pageHeader = view.container.querySelector<HTMLElement>(".work-plans-page > .page-header")!;
    expect(pageHeader.querySelector('select[aria-label="Excel 导入导出模板"]')).not.toBeNull();
    expect(within(pageHeader).getByRole("button", { name: "导出 XLS" })).toBeTruthy();
    expect(view.container.querySelector(".filter-toolbar select[aria-label=\"Excel 导入导出模板\"]")).toBeNull();
    expect(view.container.querySelector(".filter-toolbar")!.contains(screen.getByRole("button", { name: "新建工作计划" }))).toBe(true);
    view.unmount();
  });
});

describe("viewer read-only workbench", () => {
  it("hides write entries, shows the read-only hint and keeps search and export usable", async () => {
    sessionMock.user = { id: "user-shenji", username: "审计", role: "viewer", loginMode: "password" };
    const view = renderPage();
    await screen.findByText("示例计划");

    expect(screen.queryByRole("button", { name: "新建工作计划" })).toBeNull();
    expect(screen.queryByText("导入 XLS")).toBeNull();
    expect(screen.getByText(/只读账户/)).toBeTruthy();
    expect(screen.getByText(/不能新建或修改工作计划/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("搜索工作计划"), { target: { value: "不匹配" } });
    expect(await screen.findByText("这个时间范围还没有工作计划")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("搜索工作计划"), { target: { value: "" } });
    await screen.findByText("示例计划");

    const exportButton = screen.getByRole("button", { name: "导出 XLS" }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));
    fireEvent.click(exportButton);
    fireEvent.click(await screen.findByRole("button", { name: "导出" }));
    await waitFor(() => expect(downloadWorkPlansXlsCustomMock).toHaveBeenCalled());

    const ganttProps = ganttPropsMock.mock.calls.at(-1)![0] as { readOnly?: boolean };
    expect(ganttProps.readOnly).toBe(true);
    view.unmount();
  });

  it("opens the plan drawer in read-only mode without mutation callbacks", async () => {
    sessionMock.user = { id: "user-shenji", username: "审计", role: "viewer", loginMode: "password" };
    const view = renderPage();
    await screen.findByText("示例计划");

    fireEvent.click(screen.getByRole("button", { name: "示例计划" }));
    await waitFor(() => expect(drawerPropsMock).toHaveBeenCalled());
    const drawerProps = drawerPropsMock.mock.calls.at(-1)![0] as { readOnly?: boolean; onDuplicate?: unknown; onDelete?: unknown };
    expect(drawerProps.readOnly).toBe(true);
    expect(drawerProps.onDuplicate).toBeUndefined();
    expect(drawerProps.onDelete).toBeUndefined();
    view.unmount();
  });
});

describe("work plan table columns", () => {
  it("shows, reorders and persists optional and custom-field columns", async () => {
    const firstRender = renderPage();
    await screen.findByText("示例计划");

    expect(headerLabels(firstRender.container)).toEqual(["工作内容", "状态", "开始时间", "结束时间"]);
    fireEvent.click(screen.getByRole("button", { name: "列设置" }));
    expect((screen.getByRole("checkbox", { name: /工作内容/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "负责人" }));

    await waitFor(() => expect(headerLabels(firstRender.container)).toContain("负责人"));
    expect(screen.getByText("lxj")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "上移 负责人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "状态" }));
    expect(headerLabels(firstRender.container)).toEqual(["工作内容", "开始时间", "负责人", "结束时间"]);

    firstRender.unmount();
    const secondRender = renderPage();
    await screen.findByText("示例计划");
    expect(headerLabels(secondRender.container)).toEqual(["工作内容", "开始时间", "负责人", "结束时间"]);
    secondRender.unmount();
  });

  it("centers non-text column headers and values while keeping text columns left-aligned", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    fireEvent.click(screen.getByRole("button", { name: "列设置" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "负责人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "工时" }));

    await waitFor(() => expect(headerLabels(view.container)).toContain("工时"));

    expect(view.container.querySelector(".status-badge")?.parentElement?.classList.contains("plan-cell-centered")).toBe(true);
    expect(Array.from(view.container.querySelectorAll(".plan-row time")).every((element) => element.classList.contains("plan-cell-centered"))).toBe(true);
    expect(screen.getByTitle("lxj").classList.contains("plan-cell-centered")).toBe(false);
    expect(screen.getByTitle("8").classList.contains("plan-cell-centered")).toBe(true);
    view.unmount();
  });

  it("marks conflict rows and passes the owner field to the gantt timeline", async () => {
    const conflicted: WorkPlan = {
      ...plan,
      id: "f1e2d3c4-b5a6-4789-8abc-def012345678",
      title: "冲突计划",
      ownerConflict: {
        owner: "lxj",
        counterparts: [{ id: copiedPlanId, label: "示例计划", startAt: plan.startAt, endAt: plan.endAt }],
      },
    };
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/export-templates") return [exportTemplate];
      if (path === "/owner-account-mappings") return [];
      if (path === "/monthly-goals") return [];
      if (path === "/work-plans/query" && init?.method === "POST") return emulateQuery([plan, conflicted], init);
      if (path.startsWith("/work-plans")) return [plan];
      if (path.startsWith("/custom-fields")) return [ownerField, effortField];
      throw new Error(`Unexpected API path: ${path}`);
    });

    const view = renderPage();
    await screen.findByText("冲突计划");

    expect(view.container.querySelector(".plan-row[data-plan-id=\"f1e2d3c4-b5a6-4789-8abc-def012345678\"]")?.classList.contains("plan-row-conflict")).toBe(true);
    expect(view.container.querySelector(".plan-row[data-plan-id=\"b70cff45-b93c-4dff-ab87-e15ef3d2494f\"]")?.classList.contains("plan-row-conflict")).toBe(false);
    await waitFor(() => expect(ganttPropsMock).toHaveBeenCalledWith(expect.objectContaining({ ownerField })));
    view.unmount();
  });
});

describe("work plan ordering and copying", () => {
  it("forces start ascending, end descending, then creation and id as fallback", async () => {
    const early = { ...plan, id: "10000000-0000-4000-8000-000000000001", title: "最早开始", startAt: new Date(2026, 7, 8, 9).toISOString(), endAt: new Date(2026, 7, 8, 10).toISOString() };
    const longer = { ...plan, id: "10000000-0000-4000-8000-000000000002", title: "同起点较晚结束", endAt: new Date(2026, 7, 8, 14).toISOString() };
    const shorter = { ...plan, id: "10000000-0000-4000-8000-000000000003", title: "同起点较早结束", endAt: new Date(2026, 7, 8, 11).toISOString() };
    const later = { ...plan, id: "10000000-0000-4000-8000-000000000004", title: "最晚开始", startAt: new Date(2026, 7, 8, 11).toISOString(), endAt: new Date(2026, 7, 8, 15).toISOString() };
    const oneTime = { ...plan, id: "10000000-0000-4000-8000-000000000005", title: "同时间单次", sortOrder: 0 };
    const recurring = { ...plan, id: "10000000-0000-4000-8000-000000000006", title: "同时间重复", sortOrder: 1, seriesId: "20000000-0000-4000-8000-000000000001" };
    mockMutableWorkPlans([later, shorter, oneTime, early, recurring, longer]);
    const view = renderPage();
    await screen.findByText("最早开始");

    // 排期兜底：开始升序、结束降序、创建升序、ID 升序；重复来源不再优先
    const expected = ["最早开始", "同起点较晚结束", "同时间单次", "同时间重复", "同起点较早结束", "最晚开始"];
    expect(Array.from(view.container.querySelectorAll(".plan-title-button"), (node) => node.textContent)).toEqual(expected);
    await waitFor(() => expect((ganttPropsMock.mock.calls.at(-1)?.[0] as { plans: WorkPlan[] }).plans.map((item) => item.title)).toEqual(expected));
    expect(screen.queryByRole("button", { name: /拖动排序/ })).toBeNull();
    view.unmount();
  });

  it("copies a plan as a standalone sibling and opens the copy", async () => {
    mockMutableWorkPlans([plan, trailingPlan]);
    const view = renderPage();
    await screen.findByText("示例计划");
    fireEvent.click(screen.getByRole("button", { name: "示例计划" }));

    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plan: { id: plan.id } }));
    const drawer = drawerPropsMock.mock.calls.at(-1)?.[0] as {
      onDuplicate: (plan: WorkPlan) => Promise<void>;
    };
    await act(async () => {
      await drawer.onDuplicate(plan);
    });

    const createCall = apiMock.mock.calls.find(([path, init]) => path === "/work-plans" && init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      title: "示例计划（副本）",
      description: plan.description,
      statusMode: "automatic",
      startAt: plan.startAt,
      endAt: plan.endAt,
      customFields: plan.customFields,
    });
    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      plan: { id: copiedPlanId, title: "示例计划（副本）" },
      open: true,
    }));
    view.unmount();
  });
});

describe("monthly goal chips", () => {
  it("shows goal chips on plan rows that link back to the goals page", async () => {
    const taggedPlan = { ...plan, monthlyGoalIds: [monthlyGoal.id] };
    mockMutableWorkPlans([taggedPlan]);
    const view = renderPage();
    await screen.findByText("示例计划");

    const chip = await screen.findByRole("link", { name: monthlyGoal.title });
    expect(chip.getAttribute("href")).toBe("/monthly-goals");
    expect(chip.getAttribute("title")).toBe("2026 年 8 月 · 完成官网改版");
    view.unmount();
  });

  it("passes the loaded goals and the occupied state into the drawer", async () => {
    const taggedPlan = { ...plan, monthlyGoalIds: [monthlyGoal.id] };
    mockMutableWorkPlans([taggedPlan]);
    const view = renderPage();
    await screen.findByText("示例计划");

    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      monthlyGoals: [{ id: monthlyGoal.id, title: "完成官网改版" }],
    }));
    view.unmount();
  });
});

describe("work plan range and Gantt display", () => {
  it("keeps the date timeline mounted when search, status or custom filters have no results", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const searchInput = screen.getByPlaceholderText("搜索工作计划");
    fireEvent.change(searchInput, { target: { value: "不存在" } });
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plans: [] }));

    fireEvent.change(view.container.querySelector(".filter-toolbar select")!, { target: { value: "completed" } });
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plans: [] }));

    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    const advancedSelects = view.container.querySelectorAll(".advanced-filter-panel select");
    fireEvent.change(advancedSelects[0]!, { target: { value: "owner" } });
    await waitFor(() => expect(screen.getByPlaceholderText("输入筛选值")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("输入筛选值"), { target: { value: "nobody" } });
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plans: [] }));

    expect(screen.getByText("这个时间范围还没有工作计划")).toBeTruthy();
    view.unmount();
  });

  it("opens a linked plan in the week containing its schedule", async () => {
    const linkedPlan = {
      ...plan,
      id: "f6251b28-a2d2-4f7f-bff1-b901cb1d9a53",
      title: "下周计划",
      startAt: new Date(2026, 7, 17, 8, 30).toISOString(),
      endAt: new Date(2026, 7, 21, 18).toISOString(),
    };
    mockMutableWorkPlans([plan, linkedPlan]);

    const view = renderPage(`/work-plans?view=week&date=${encodeURIComponent(linkedPlan.startAt)}&plan=${linkedPlan.id}`);

    await screen.findByText("下周计划");
    expect(screen.getByText("8月第3周")).toBeTruthy();
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      rangeStart: new Date(2026, 7, 17),
      view: "week",
    }));
    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      plan: { id: linkedPlan.id },
      open: true,
    }));
    view.unmount();
  });

  it("opens a date-seeded new drawer without creating a plan before save", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const ganttProps = ganttPropsMock.mock.calls.at(-1)?.[0] as {
      onCreateAt: (date: Date) => void;
    };
    act(() => ganttProps.onCreateAt(new Date(2026, 7, 12)));

    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      plan: null,
      open: true,
      initialDate: new Date(2026, 7, 12),
    }));
    expect(apiMock.mock.calls.some(([path, init]) => path === "/work-plans" && init?.method === "POST")).toBe(false);
    view.unmount();
  });

  it("shows normal creation feedback and preserves the active range and filters", async () => {
    mockMutableWorkPlans();
    const view = renderPage();
    await screen.findByText("示例计划");
    const initialGantt = ganttPropsMock.mock.calls.at(-1)?.[0] as { rangeStart: Date; rangeEnd: Date; view: string };

    fireEvent.change(screen.getByPlaceholderText("搜索工作计划"), { target: { value: "新计划" } });
    fireEvent.change(view.container.querySelector(".filter-toolbar select")!, { target: { value: "pending" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(view.container.querySelector(".advanced-filter-panel select")!, { target: { value: "owner" } });
    await waitFor(() => expect(screen.getByPlaceholderText("输入筛选值")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("输入筛选值"), { target: { value: "lxj" } });
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plans: [] }));

    fireEvent.click(screen.getByRole("button", { name: "新建工作计划" }));
    const drawer = drawerPropsMock.mock.calls.at(-1)?.[0] as {
      onSave: (input: object, recurrence: null) => Promise<void>;
    };
    await act(async () => {
      await drawer.onSave({
        title: "新计划",
        description: "",
        status: "pending",
        statusMode: "manual",
        startAt: new Date(2026, 7, 8, 10).toISOString(),
        endAt: new Date(2026, 7, 8, 12).toISOString(),
        customFields: { owner: "lxj" },
      }, null);
    });

    expect(await screen.findByText("工作计划已保存")).toBeTruthy();
    expect((screen.getByPlaceholderText("搜索工作计划") as HTMLInputElement).value).toBe("新计划");
    expect((view.container.querySelector(".filter-toolbar select") as HTMLSelectElement).value).toBe("pending");
    expect((view.container.querySelector(".advanced-filter-panel select") as HTMLSelectElement).value).toBe("owner");
    expect((screen.getByPlaceholderText("输入筛选值") as HTMLInputElement).value).toBe("lxj");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      rangeStart: initialGantt.rangeStart,
      rangeEnd: initialGantt.rangeEnd,
      view: initialGantt.view,
      plans: [expect.objectContaining({ title: "新计划" })],
    }));
    view.unmount();
  });

  it.each([
    ["date range", { title: "范围外计划", startAt: new Date(2026, 7, 20, 10).toISOString(), endAt: new Date(2026, 7, 20, 12).toISOString(), customFields: {} }],
    ["search", { title: "其他计划", startAt: new Date(2026, 7, 8, 10).toISOString(), endAt: new Date(2026, 7, 8, 12).toISOString(), customFields: {} }],
    ["status", { title: "状态隐藏计划", status: "pending", statusMode: "manual", startAt: new Date(2026, 7, 8, 10).toISOString(), endAt: new Date(2026, 7, 8, 12).toISOString(), customFields: {} }],
    ["Custom Field", { title: "字段隐藏计划", startAt: new Date(2026, 7, 8, 10).toISOString(), endAt: new Date(2026, 7, 8, 12).toISOString(), customFields: { owner: "lxj" } }],
  ])("explains when a newly created plan is hidden by the %s", async (reason, input) => {
    mockMutableWorkPlans();
    const view = renderPage();
    await screen.findByText("示例计划");
    if (reason === "search") fireEvent.change(screen.getByPlaceholderText("搜索工作计划"), { target: { value: "只看这个标题" } });
    if (reason === "status") fireEvent.change(view.container.querySelector(".filter-toolbar select")!, { target: { value: "completed" } });
    if (reason === "Custom Field") {
      fireEvent.click(screen.getByRole("button", { name: "筛选" }));
      fireEvent.change(view.container.querySelector(".advanced-filter-panel select")!, { target: { value: "owner" } });
      await waitFor(() => expect(screen.getByPlaceholderText("输入筛选值")).toBeTruthy());
      fireEvent.change(screen.getByPlaceholderText("输入筛选值"), { target: { value: "nobody" } });
    }
    if (reason !== "date range") {
      await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plans: [] }));
    }

    fireEvent.click(screen.getByRole("button", { name: "新建工作计划" }));
    const drawer = drawerPropsMock.mock.calls.at(-1)?.[0] as {
      onSave: (input: object, recurrence: null) => Promise<void>;
    };
    await act(async () => {
      await drawer.onSave({
        description: "",
        ...input,
      }, null);
    });

    expect(await screen.findByText("工作计划已创建，但在当前时间范围或筛选条件下不可见")).toBeTruthy();
    view.unmount();
  });

  it("places the timeline controls in the merged panel toolbar", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const toolbar = view.container.querySelector(".table-toolbar");
    expect(toolbar).not.toBeNull();
    const timeline = view.container.querySelector(".planner-timeline");
    const tabs = screen.getByRole("tablist", { name: "时间轴视图" });
    expect(toolbar!.contains(tabs)).toBe(true);
    const previousRange = screen.getByRole("button", { name: "上一时间范围" });
    const nextRange = screen.getByRole("button", { name: "下一时间范围" });
    const today = screen.getByRole("button", { name: "今天" });
    expect(toolbar!.contains(previousRange)).toBe(true);
    expect(toolbar!.contains(today)).toBe(true);
    const ganttSettings = screen.getByRole("button", { name: "甘特条属性" });
    expect(toolbar!.contains(ganttSettings)).toBe(true);
    expect(timeline!.contains(toolbar!)).toBe(false);
    const ganttProps = ganttPropsMock.mock.calls.at(-1)?.[0] as { verticalScrollPeerRef?: { current: HTMLElement | null } };
    expect(ganttProps.verticalScrollPeerRef?.current).toBe(view.container.querySelector(".plan-rows"));
    expect(view.container.querySelector(".plan-row")?.getAttribute("data-plan-id")).toBe(plan.id);
    expect(screen.getByRole("tab", { name: "周视图" }).getAttribute("aria-selected")).toBe("true");
    expect(view.container.querySelector(".planner-panel")?.classList.contains("view-week")).toBe(true);

    fireEvent.click(nextRange);
    expect(screen.getByText("8月第2周")).toBeTruthy();
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ rangeStart: new Date(2026, 7, 10) }));
    fireEvent.click(today);
    expect(screen.getByText("8月第1周")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "月视图" }));
    expect(screen.getByRole("tab", { name: "月视图" }).getAttribute("aria-selected")).toBe("true");
    expect(view.container.querySelector(".planner-panel")?.classList.contains("view-month")).toBe(true);
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ view: "month" }));
    view.unmount();
  });

  it("keeps the schedule callback stable across unrelated page state changes", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");
    const initialProps = ganttPropsMock.mock.calls.at(-1)?.[0] as { onScheduleChange: unknown };

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));

    const latestProps = ganttPropsMock.mock.calls.at(-1)?.[0] as { onScheduleChange: unknown };
    expect(latestProps.onScheduleChange).toBe(initialProps.onScheduleChange);
    view.unmount();
  });

  it("uses a month-relative week label and persists selected Gantt properties", async () => {
    const firstRender = renderPage();
    await screen.findByText("示例计划");

    expect(screen.getByText("8月第1周")).toBeTruthy();
    expect(screen.queryByText("优先级")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "负责人" }));

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      displayProperties: [expect.objectContaining({ id: "custom:owner", label: "负责人" })],
    }));

    firstRender.unmount();
    const secondRender = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      displayProperties: [expect.objectContaining({ id: "custom:owner" })],
    }));
    secondRender.unmount();
  });

  it("lists work content as the first built-in bar property and keeps it out of the tooltip section", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    const barList = view.container.querySelector(".column-settings-popover > .column-settings-list");
    expect(barList).not.toBeNull();
    const firstRow = barList!.querySelector(".column-setting-row");
    expect(firstRow?.querySelector("label span")?.textContent).toBe("工作内容");
    expect(firstRow?.querySelector("small")?.textContent).toBe("内置属性");

    const tooltipSection = view.container.querySelector(".gantt-popover-section");
    expect(tooltipSection?.textContent).not.toContain("工作内容");
    view.unmount();
  });

  it("persists the work content bar selection and clears it with the header button", async () => {
    const firstRender = renderPage();
    await screen.findByText("示例计划");

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "工作内容" }));

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      displayProperties: [expect.objectContaining({ id: "title", label: "工作内容" })],
    }));
    expect(JSON.parse(localStorage.getItem("workplan:gantt-properties:v1") ?? "null"))
      .toEqual({ version: 1, visibleIds: ["title"] });

    firstRender.unmount();
    const secondRender = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      displayProperties: [expect.objectContaining({ id: "title" })],
    }));

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    const popover = secondRender.container.querySelector(".gantt-property-popover");
    expect(popover).not.toBeNull();
    fireEvent.click(popover!.querySelector<HTMLButtonElement>("header button")!);

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ displayProperties: [] }));
    expect(JSON.parse(localStorage.getItem("workplan:gantt-properties:v1") ?? "null"))
      .toEqual({ version: 1, visibleIds: [] });
    secondRender.unmount();
  });
});

describe("work plan tooltip settings", () => {
  it("keeps the tooltip selection independent and persists it across renders", async () => {
    const firstRender = renderPage();
    await screen.findByText("示例计划");

    expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ tooltipProperties: [], displayProperties: [] });

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "浮动提示 负责人" }));

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "custom:owner", label: "负责人" })],
    }));
    expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ displayProperties: [] });
    expect(JSON.parse(localStorage.getItem("workplan:gantt-tooltip:v1") ?? "null"))
      .toEqual({ version: 1, visibleIds: ["custom:owner"] });

    firstRender.unmount();
    const secondRender = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "custom:owner" })],
      displayProperties: [],
    }));
    secondRender.unmount();
  });

  it("stops the bar property selection from changing the tooltip selection", async () => {
    localStorage.setItem("workplan:gantt-tooltip:v1", JSON.stringify({ version: 1, visibleIds: ["custom:owner"] }));
    const view = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "custom:owner" })],
    }));

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "状态" }));

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      displayProperties: [expect.objectContaining({ id: "status" })],
    }));
    expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "custom:owner" })],
    });
    view.unmount();
  });

  it("reorders the tooltip properties and persists the new order", async () => {
    localStorage.setItem("workplan:gantt-tooltip:v1", JSON.stringify({ version: 1, visibleIds: ["status", "custom:owner"] }));
    const view = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "status" }), expect.objectContaining({ id: "custom:owner" })],
    }));

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    fireEvent.click(screen.getByRole("button", { name: "下移浮动提示 状态" }));

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "custom:owner" }), expect.objectContaining({ id: "status" })],
    }));
    expect(JSON.parse(localStorage.getItem("workplan:gantt-tooltip:v1") ?? "null"))
      .toEqual({ version: 1, visibleIds: ["custom:owner", "status"] });
    view.unmount();
  });

  it("clears the tooltip selection with the section button while keeping bar properties", async () => {
    localStorage.setItem("workplan:gantt-tooltip:v1", JSON.stringify({ version: 1, visibleIds: ["status"] }));
    localStorage.setItem("workplan:gantt-properties:v1", JSON.stringify({ version: 1, visibleIds: ["custom:owner"] }));
    const view = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tooltipProperties: [expect.objectContaining({ id: "status" })],
      displayProperties: [expect.objectContaining({ id: "custom:owner" })],
    }));

    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    const tooltipSection = view.container.querySelector<HTMLElement>(".gantt-popover-section");
    expect(tooltipSection).not.toBeNull();
    fireEvent.click(within(tooltipSection!).getByRole("button", { name: "清空" }));

    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ tooltipProperties: [] }));
    expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      displayProperties: [expect.objectContaining({ id: "custom:owner" })],
    });
    expect(JSON.parse(localStorage.getItem("workplan:gantt-tooltip:v1") ?? "null")).toEqual({ version: 1, visibleIds: [] });
    view.unmount();
  });

  it("falls back to an empty tooltip selection for malformed persisted data", async () => {
    localStorage.setItem("workplan:gantt-tooltip:v1", JSON.stringify({ version: 2, visibleIds: ["custom:owner"] }));
    const view = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ tooltipProperties: [] }));
    expect(screen.getByRole("button", { name: "甘特条属性" })).toBeTruthy();
    view.unmount();
  });

  it("rejects the work content id in persisted tooltip selections", async () => {
    localStorage.setItem("workplan:gantt-tooltip:v1", JSON.stringify({ version: 1, visibleIds: ["title"] }));
    const view = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(ganttPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ tooltipProperties: [] }));
    view.unmount();
  });
});

describe("XLS transfer", () => {
  it("offers the hidden owner account only in the drawer and export flow", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");
    fireEvent.click(screen.getByRole("button", { name: "示例计划" }));
    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      ownerAccountMappings: [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }],
      ownerAccountMappingsLoading: false,
      ownerAccountMappingsError: false,
    }));

    fireEvent.click(screen.getByRole("button", { name: "列设置" }));
    expect(screen.queryByRole("checkbox", { name: "工作负责人账号" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "列设置" }));
    fireEvent.click(screen.getByRole("button", { name: "甘特条属性" }));
    expect(screen.queryByRole("checkbox", { name: "工作负责人账号" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "导出 XLS" }));
    const dialog = await screen.findByRole("dialog", { name: "导出 XLS" });
    const labels = Array.from(dialog.querySelectorAll(".export-attribute-row label span"), (node) => node.textContent);
    expect(labels.indexOf("工作负责人账号")).toBe(labels.indexOf("负责人") + 1);
    fireEvent.click(within(dialog).getByLabelText("导出 工作负责人账号"));
    fireEvent.click(within(dialog).getByRole("button", { name: "导出" }));
    await waitFor(() => expect(downloadWorkPlansXlsCustomMock).toHaveBeenCalledWith(
      [...exportTemplate.columns, { source: "ownerAccount", header: "工作负责人账号" }],
      exportTemplate.sheetName,
      exportTemplate.name,
      expect.any(Object),
    ));
    view.unmount();
  });

  it("preserves the selected template's custom column headers when exporting", async () => {
    const customHeaderTemplate: ExportTemplate = {
      ...exportTemplate,
      name: "大二次作业计划导出",
      columns: [
        { source: "title", header: "作业任务" },
        { source: "startAt", header: "计划开始时间" },
        { source: "endAt", header: "计划结束时间" },
      ],
    };
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/export-templates") return [customHeaderTemplate];
      if (path === "/owner-account-mappings") return [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }];
      if (path.startsWith("/work-plan-series")) return [];
      if (path.startsWith("/work-plans")) return [plan];
      if (path.startsWith("/custom-fields")) return [ownerField, effortField];
      throw new Error(`Unexpected API path: ${path}`);
    });

    const view = renderPage();
    await screen.findByRole("option", { name: "大二次作业计划导出" });
    const exportButton = screen.getByRole("button", { name: "导出 XLS" }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));

    fireEvent.click(exportButton);
    const dialog = await screen.findByRole("dialog", { name: "导出 XLS" });
    fireEvent.click(within(dialog).getByRole("button", { name: "导出" }));

    await waitFor(() => expect(downloadWorkPlansXlsCustomMock).toHaveBeenCalledWith(
      customHeaderTemplate.columns,
      customHeaderTemplate.sheetName,
      customHeaderTemplate.name,
      expect.objectContaining({
        query: expect.objectContaining({ range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }) }),
      }),
    ));
    view.unmount();
  });

  it("exports the visible time range with the selected attributes", async () => {
    const view = renderPage();
    await screen.findByRole("option", { name: "标准工作计划" });
    const exportButton = screen.getByRole("button", { name: "导出 XLS" }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));

    fireEvent.click(exportButton);
    const dialog = await screen.findByRole("dialog", { name: "导出 XLS" });
    const titleCheckbox = (await within(dialog).findByLabelText("导出 工作内容")) as HTMLInputElement;
    expect(titleCheckbox.checked).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("导出 状态"));
    fireEvent.click(within(dialog).getByRole("button", { name: "导出" }));

    await waitFor(() => expect(downloadWorkPlansXlsCustomMock).toHaveBeenCalledWith(
      [
        { source: "title", header: "工作内容" },
        { source: "startAt", header: "开始时间" },
        { source: "endAt", header: "结束时间" },
        { source: "status", header: "状态" },
      ],
      "工作计划",
      "标准工作计划",
      expect.objectContaining({
        query: expect.objectContaining({ range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }) }),
      }),
    ));
    expect(await screen.findByText("已导出当前时间范围")).toBeTruthy();
    view.unmount();
  });

  it("reorders the selected export attributes before exporting", async () => {
    const view = renderPage();
    await screen.findByRole("option", { name: "标准工作计划" });
    const exportButton = screen.getByRole("button", { name: "导出 XLS" }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));

    fireEvent.click(exportButton);
    const dialog = await screen.findByRole("dialog", { name: "导出 XLS" });
    const moveUp = within(dialog).getByRole("button", { name: "上移导出列 工作内容" }) as HTMLButtonElement;
    expect(moveUp.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "下移导出列 工作内容" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "导出" }));

    await waitFor(() => expect(downloadWorkPlansXlsCustomMock).toHaveBeenCalledWith(
      [
        { source: "startAt", header: "开始时间" },
        { source: "title", header: "工作内容" },
        { source: "endAt", header: "结束时间" },
      ],
      "工作计划",
      "标准工作计划",
      expect.objectContaining({
        query: expect.objectContaining({ range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }) }),
      }),
    ));
    view.unmount();
  });

  it("saves the current attribute selection as a new export template", async () => {
    const savedTemplate: ExportTemplate = {
      ...exportTemplate,
      id: "3f3a9f9c-9b8e-4c3e-a4d8-7a0b5e8d2f21",
      name: "周报导出（副本）",
      columns: [
        ...exportTemplate.columns,
        { source: "description", header: "说明" },
      ],
    };
    let templates = [exportTemplate];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/export-templates" && init?.method === "POST") {
        const input = JSON.parse(String(init.body)) as { name: string; sheetName: string; columns: ExportTemplate["columns"] };
        const created = { ...savedTemplate, name: input.name, sheetName: input.sheetName, columns: input.columns };
        templates = [...templates, created];
        return created;
      }
      if (path === "/export-templates") return templates;
      if (path === "/owner-account-mappings") return [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }];
      if (path === "/work-plans/import.xls") return { imported: 1 };
      if (path.startsWith("/work-plan-series")) return [];
      if (path.startsWith("/work-plans")) return [plan];
      if (path.startsWith("/custom-fields")) return [ownerField];
      throw new Error(`Unexpected API path: ${path}`);
    });

    const view = renderPage();
    await screen.findByRole("option", { name: "标准工作计划" });
    const exportButton = screen.getByRole("button", { name: "导出 XLS" }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));

    fireEvent.click(exportButton);
    const dialog = await screen.findByRole("dialog", { name: "导出 XLS" });
    fireEvent.click(within(dialog).getByLabelText("导出 说明"));
    const nameInput = within(dialog).getByLabelText("另存为模板名称");
    fireEvent.change(nameInput, { target: { value: "周报导出" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "另存为模板" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/export-templates",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("周报导出"),
      }),
    ));
    expect(await screen.findByText("已另存为模板“周报导出”")).toBeTruthy();
    expect(await screen.findByText("模板已保存")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "周报导出" })).toBeTruthy();
    view.unmount();
  });

  it("imports an XLS as new work plans after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = renderPage();
    await screen.findByRole("option", { name: "标准工作计划" });
    // 导入入口收在新建按钮右侧的下拉箭头里，先展开菜单
    fireEvent.click(screen.getByRole("button", { name: "导入 XLS" }));
    const input = view.container.querySelector('input[type="file"][accept*=".xls"]') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));

    fireEvent.change(input, { target: { files: [new File(["xls"], "计划.xls", { type: "application/vnd.ms-excel" })] } });

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/work-plans/import.xls",
      expect.objectContaining({ method: "POST", body: expect.stringContaining(exportTemplate.id) }),
    ));
    expect(await screen.findByText("导入完成，共新增 1 条工作计划")).toBeTruthy();
    view.unmount();
  });
});

describe("task list collapse", () => {
  it("collapses to the gantt-only layout and expands back while keeping the range title", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const panel = view.container.querySelector(".planner-panel") as HTMLElement;
    expect(panel.classList.contains("planner-collapsed")).toBe(false);
    expect(screen.getByRole("button", { name: "收起任务列表" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "收起任务列表" }));
    expect(panel.classList.contains("planner-collapsed")).toBe(true);
    expect(screen.getByRole("button", { name: "展开任务列表" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("8月第1周")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "月视图" }));
    expect(screen.getByText("2026 年 8 月")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开任务列表" }));
    expect(panel.classList.contains("planner-collapsed")).toBe(false);
    expect(screen.getByRole("button", { name: "收起任务列表" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("2026 年 8 月")).toBeTruthy();
    view.unmount();
  });

  it("persists the desktop collapse choice across renders", async () => {
    const first = renderPage();
    await screen.findByText("示例计划");
    fireEvent.click(screen.getByRole("button", { name: "收起任务列表" }));
    expect(JSON.parse(localStorage.getItem("workplan:planner-collapsed:v1") ?? "null")).toEqual({ version: 1, collapsed: true });
    first.unmount();

    const second = renderPage();
    await screen.findByText("示例计划");
    expect(second.container.querySelector(".planner-panel")?.classList.contains("planner-collapsed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "展开任务列表" }));
    expect(second.container.querySelector(".planner-panel")?.classList.contains("planner-collapsed")).toBe(false);
    expect(JSON.parse(localStorage.getItem("workplan:planner-collapsed:v1") ?? "null")).toEqual({ version: 1, collapsed: false });
    second.unmount();
  });

  it("auto-collapses on mobile viewports and keeps manual expansion session-only", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 720px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const view = renderPage();
    await screen.findByText("示例计划");
    expect(view.container.querySelector(".planner-panel")?.classList.contains("planner-collapsed")).toBe(true);
    expect(localStorage.getItem("workplan:planner-collapsed:v1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开任务列表" }));
    expect(view.container.querySelector(".planner-panel")?.classList.contains("planner-collapsed")).toBe(false);
    expect(localStorage.getItem("workplan:planner-collapsed:v1")).toBeNull();

    view.unmount();
    vi.unstubAllGlobals();
  });
});

describe("work plan layout divider", () => {
  it("resizes the list when the divider is dragged", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const panel = view.container.querySelector(".planner-panel") as HTMLDivElement;
    const divider = screen.getByRole("separator", { name: "调整列表和时间轴宽度" });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}),
    });
    let captured = false;
    Object.defineProperties(divider, {
      setPointerCapture: { value: () => { captured = true; } },
      hasPointerCapture: { value: () => captured },
      releasePointerCapture: { value: () => { captured = false; } },
    });

    fireEvent.pointerDown(divider, { button: 0, clientX: 440, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 600, pointerId: 1 });
    expect(divider.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.pointerUp(divider, { clientX: 600, pointerId: 1 });
    expect(captured).toBe(false);

    view.unmount();
  });

  it("adjusts, persists and resets the list width with the keyboard", async () => {
    const firstRender = renderPage();
    await screen.findByText("示例计划");

    const divider = screen.getByRole("separator", { name: "调整列表和时间轴宽度" });
    expect(divider.getAttribute("aria-valuenow")).toBe("44");

    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider.getAttribute("aria-valuenow")).toBe("48");

    firstRender.unmount();
    const secondRender = renderPage();
    await screen.findByText("示例计划");

    const persistedDivider = screen.getByRole("separator", { name: "调整列表和时间轴宽度" });
    expect(persistedDivider.getAttribute("aria-valuenow")).toBe("48");

    fireEvent.doubleClick(persistedDivider);
    expect(persistedDivider.getAttribute("aria-valuenow")).toBe("44");

    secondRender.unmount();
  });
});

describe("work plan cycle saving", () => {
  it("converts an existing one-time plan through the series endpoint", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");
    fireEvent.click(screen.getByRole("button", { name: "示例计划" }));

    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plan: { id: plan.id } }));
    const drawer = drawerPropsMock.mock.calls.at(-1)?.[0] as {
      onSave: (input: object, recurrence: object) => Promise<void>;
    };
    await act(async () => {
      await drawer.onSave({
        title: plan.title,
        description: plan.description,
        status: plan.status,
        startAt: plan.startAt,
        endAt: plan.endAt,
        customFields: plan.customFields,
        version: plan.version,
      }, { frequency: "weekly", interval: 1, timeZone: "Asia/Shanghai" });
    });

    expect(apiMock).toHaveBeenCalledWith(
      `/work-plans/${plan.id}/series`,
      expect.objectContaining({ method: "POST" }),
    );
    view.unmount();
  });
});

describe("timeline reminder bells", () => {
  it("fetches reminders for the visible range and forwards them to the timeline", async () => {
    const reminderDays = [{
      date: "2026-08-05",
      reminders: [{ type: "work-order", date: "2026-08-05", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: plan.startAt, endAt: plan.startAt, createdAt: plan.createdAt, risk: null }] }],
    }];
    fetchRemindersMock.mockResolvedValue({ days: reminderDays });
    const view = renderPage();
    await screen.findByText("示例计划");

    await waitFor(() => expect(fetchRemindersMock).toHaveBeenCalledWith("2026-08-03", "2026-08-09"));
    await waitFor(() => {
      const props = ganttPropsMock.mock.calls.at(-1)?.[0] as { reminders?: unknown; onReminderSelect?: (planId: string) => void };
      expect(props.reminders).toEqual(reminderDays);
      expect(props.onReminderSelect).toBeTypeOf("function");
    });
    view.unmount();
  });

  it("opens the matching work plan drawer through the timeline reminder callback", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    await waitFor(() => {
      const props = ganttPropsMock.mock.calls.at(-1)?.[0] as { onReminderSelect?: (planId: string) => void };
      expect(props.onReminderSelect).toBeTypeOf("function");
    });
    const props = ganttPropsMock.mock.calls.at(-1)?.[0] as { onReminderSelect: (planId: string) => void };
    await act(async () => {
      props.onReminderSelect(plan.id);
    });

    await waitFor(() => expect(drawerPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ plan: { id: plan.id }, open: true }));
    view.unmount();
  });

  it("updates the reminder range when shifting to the next week", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");
    await waitFor(() => expect(fetchRemindersMock).toHaveBeenCalledWith("2026-08-03", "2026-08-09"));

    fireEvent.click(screen.getByRole("button", { name: "下一时间范围" }));
    await waitFor(() => expect(fetchRemindersMock).toHaveBeenCalledWith("2026-08-10", "2026-08-16"));
    view.unmount();
  });
});


function queryBodies(): WorkPlanQueryRequest[] {
  return apiMock.mock.calls
    .filter(([path, init]) => path === "/work-plans/query" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as WorkPlanQueryRequest);
}

async function openSortPanel() {
  fireEvent.click(screen.getByRole("button", { name: "排序设置" }));
  await screen.findByRole("dialog", { name: "排序设置" });
}

describe("甘特拖动保存失败反馈", () => {
  it("保存失败时强制重建甘特（还原乐观几何）、弹出错误提示并在页脚标明失败", async () => {
    const fallback = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/schedule")) throw new Error("版本冲突，请刷新后重试");
      return fallback(path, init);
    });
    const view = renderPage();
    await screen.findByText("示例计划");
    expect((ganttPropsMock.mock.calls.at(-1)?.[0] as { rebuildKey?: number }).rebuildKey).toBe(0);

    const props = ganttPropsMock.mock.calls.at(-1)?.[0] as { onScheduleChange: (plan: WorkPlan, startAt: string, endAt: string) => void };
    act(() => props.onScheduleChange(plan, plan.startAt, plan.endAt));

    // 甘特收到新的 rebuildKey：整图按服务端数据重建，乐观几何被还原
    await waitFor(() => expect((ganttPropsMock.mock.calls.at(-1)?.[0] as { rebuildKey?: number }).rebuildKey).toBeGreaterThan(0));
    expect(await screen.findByRole("alert")).toHaveTextContent("排程保存失败，甘特图已还原为已保存的排程");
    await waitFor(() => expect(screen.getByText("排程保存失败")).toBeInTheDocument());
    expect(screen.queryByText("所有更改已保存")).toBeNull();
    view.unmount();
  });
});

describe("工作计划页排序体验", () => {
  it("默认显示排期顺序，不写 URL 排序参数", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    expect(view.container.querySelector(".plan-rows .plan-row .plan-title-button")!.textContent).toBe("示例计划");
    await openSortPanel();
    expect(screen.getByText("当前：排期顺序（默认）")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sort")).toBeNull();
    view.unmount();
  });

  it("添加排序字段：写入 URL 与账户偏好，查询请求携带排序", async () => {
    const locationRef = { current: "" };
    const view = renderPage("/work-plans", locationRef);
    await screen.findByText("示例计划");
    await openSortPanel();

    fireEvent.change(screen.getByRole("combobox", { name: "添加排序字段" }), { target: { value: "title" } });
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBe("title:asc"));
    await waitFor(() => expect(queryBodies().some((body) => body.sort.length === 1 && body.sort[0]?.field === "title" && body.sort[0]?.direction === "asc")).toBe(true));
    expect(JSON.parse(window.localStorage.getItem("workplan:list-sort:v1:user-lxj")!).sort).toEqual([{ field: "title", direction: "asc" }]);
    view.unmount();
  });

  it("URL 直达排序：页面直接使用且不反向写偏好，方向可切换", async () => {
    const locationRef = { current: "" };
    const view = renderPage("/work-plans?sort=title:desc", locationRef);
    await screen.findByText("示例计划");
    expect(window.localStorage.getItem("workplan:list-sort:v1:user-lxj")).toBeNull();
    await openSortPanel();
    const toggle = screen.getByRole("button", { name: /工作内容 方向 降序/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBe("title:asc"));
    // 用户主动修改后才保存偏好
    expect(JSON.parse(window.localStorage.getItem("workplan:list-sort:v1:user-lxj")!).sort).toEqual([{ field: "title", direction: "asc" }]);
    view.unmount();
  });

  it("非法 URL 整体回退默认并提示一次，查询请求不带排序", async () => {
    const locationRef = { current: "" };
    const view = renderPage("/work-plans?sort=bogus:asc,title:desc", locationRef);
    await screen.findByText("示例计划");
    expect(await screen.findByText("链接中的排序参数无效，已恢复默认排期顺序")).toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBeNull());
    await waitFor(() => expect(queryBodies().every((body) => body.sort.length === 0)).toBe(true));
    view.unmount();
  });

  it("URL 中未知自定义字段排序按字段目录回退并清理参数，而不是等服务端 400", async () => {
    const locationRef = { current: "" };
    const view = renderPage("/work-plans?sort=custom.gone:asc,title:desc", locationRef);
    await screen.findByText("示例计划");
    expect(await screen.findByText("链接中的排序参数无效，已恢复默认排期顺序")).toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBeNull());
    // 字段目录就绪后的查询不再携带失效字段（首个请求可能先于目录就绪发出）
    await waitFor(() => expect(queryBodies().at(-1)?.sort ?? []).toEqual([]));
    view.unmount();
  });

  it("账户偏好逐项清理失效字段并提示一次", async () => {
    window.localStorage.setItem("workplan:list-sort:v1:user-lxj", JSON.stringify({
      version: 1,
      sort: [{ field: "custom.gone", direction: "asc" }, { field: "updatedAt", direction: "desc" }],
    }));
    const view = renderPage();
    await screen.findByText("示例计划");

    expect(await screen.findByText("浏览器偏好中的失效排序字段已清理")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("workplan:list-sort:v1:user-lxj")!).sort).toEqual([{ field: "updatedAt", direction: "desc" }]);
    view.unmount();
  });

  it("有效的自定义字段排序加载后保留，不提示清理", async () => {
    window.localStorage.setItem("workplan:list-sort:v1:user-lxj", JSON.stringify({
      version: 1,
      sort: [{ field: "custom.owner", direction: "asc" }],
    }));
    const view = renderPage();
    await screen.findByText("示例计划");
    expect(screen.queryByText("浏览器偏好中的失效排序字段已清理")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("workplan:list-sort:v1:user-lxj")!).sort).toEqual([{ field: "custom.owner", direction: "asc" }]);
    await waitFor(() => expect(queryBodies().some((body) => body.sort.length === 1 && body.sort[0]?.field === "custom.owner" && body.sort[0]?.direction === "asc")).toBe(true));
    view.unmount();
  });

  it("账户隔离：不同账户读取各自偏好", async () => {
    window.localStorage.setItem("workplan:list-sort:v1:user-a", JSON.stringify({ version: 1, sort: [{ field: "title", direction: "asc" }] }));
    sessionMock.user = { id: "user-a", username: "甲", role: "admin", loginMode: "password" };
    const first = renderPage();
    await screen.findByText("示例计划");
    expect(queryBodies().some((body) => body.sort.length === 1 && body.sort[0]?.field === "title")).toBe(true);
    first.unmount();

    sessionMock.user = { id: "user-b", username: "乙", role: "admin", loginMode: "password" };
    const second = renderPage();
    await screen.findByText("示例计划");
    expect(queryBodies().at(-1)?.sort).toEqual([]);
    second.unmount();
  });

  it("排序面板支持最多五项、上移/下移/移除与恢复默认", async () => {
    const locationRef = { current: "" };
    const view = renderPage("/work-plans", locationRef);
    await screen.findByText("示例计划");
    await openSortPanel();

    const add = screen.getByRole("combobox", { name: "添加排序字段" });
    for (const field of ["title", "status", "startAt"]) {
      fireEvent.change(add, { target: { value: field } });
    }
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBe("title:asc,status:asc,startAt:asc"));

    // 方向切换
    fireEvent.click(screen.getByRole("button", { name: "状态 方向 升序，点击改为降序" }));
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBe("title:asc,status:desc,startAt:asc"));
    // 上移
    fireEvent.click(screen.getByRole("button", { name: "下移 开始时间" }));
    fireEvent.click(screen.getByRole("button", { name: "上移 开始时间" }));
    // 移除
    fireEvent.click(screen.getByRole("button", { name: "移除 状态" }));
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBe("title:asc,startAt:asc"));
    // 超过五项被禁用
    const addAgain = screen.getByRole("combobox", { name: "添加排序字段" });
    fireEvent.change(addAgain, { target: { value: "endAt" } });
    fireEvent.change(addAgain, { target: { value: "duration" } });
    fireEvent.change(addAgain, { target: { value: "createdAt" } });
    expect(screen.getByRole("combobox", { name: "添加排序字段" }).hasAttribute("disabled")).toBe(true);
    // 恢复默认
    fireEvent.click(screen.getByRole("button", { name: /恢复默认/ }));
    await waitFor(() => expect(new URLSearchParams(locationRef.current).get("sort")).toBeNull());
    expect(screen.getByText("当前：排期顺序（默认）")).toBeInTheDocument();
    view.unmount();
  });
});
