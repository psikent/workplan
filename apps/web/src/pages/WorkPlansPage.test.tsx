// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomFieldDefinition, ExportTemplate, WorkPlan } from "@workplan/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import WorkPlansPage from "./WorkPlansPage";

const apiMock = vi.hoisted(() => vi.fn());
const downloadWorkPlansXlsCustomMock = vi.hoisted(() => vi.fn());
const fileToBase64Mock = vi.hoisted(() => vi.fn());
const drawerPropsMock = vi.hoisted(() => vi.fn());
const ganttPropsMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  user: { username: "lxj", role: "admin" as "admin" | "editor", loginMode: "password" as "password" | "token" },
}));

vi.mock("../App", () => ({
  useSession: () => ({ user: sessionMock.user, signOut: vi.fn() }),
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: apiMock,
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
  sortOrder: 0,
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: { owner: "lxj", effort: 8 },
  ownerAccount: null,
  createdAt: new Date(2026, 7, 1).toISOString(),
  updatedAt: new Date(2026, 7, 1).toISOString(),
};
const copiedPlanId = "cd230f99-29ae-4d04-82fc-2eb710b5c861";
const trailingPlan: WorkPlan = {
  ...plan,
  id: "ec718abc-5257-490a-b30f-daa8b86f7ed9",
  title: "后续计划",
  sortOrder: 1,
};

const ownerField: CustomFieldDefinition = {
  id: "f9a9dc48-e819-4b1b-89a3-ee680649e842",
  key: "owner",
  label: "负责人",
  description: "",
  type: "short_text",
  required: false,
  defaultValue: null,
  sortOrder: 0,
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
  sortOrder: 1,
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

beforeEach(() => {
  sessionMock.user = { username: "lxj", role: "admin", loginMode: "password" };
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 8, 9));
  apiMock.mockClear();
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/export-templates") return [exportTemplate];
    if (path === "/owner-account-mappings") return [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }];
    if (path === "/work-plans/import.xls") return { imported: 1 };
    if (path.startsWith("/work-plan-series")) return [];
    if (path.startsWith("/work-plans")) return [plan];
    if (path.startsWith("/custom-fields")) return [ownerField, effortField];
    throw new Error(`Unexpected API path: ${path}`);
  });
  drawerPropsMock.mockClear();
  ganttPropsMock.mockClear();
  downloadWorkPlansXlsCustomMock.mockResolvedValue(undefined);
  fileToBase64Mock.mockResolvedValue("ZmFrZQ==");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPage(initialEntry = "/work-plans") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <WorkPlansPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function headerLabels(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".planner-columns > span"), (node) => node.textContent ?? "");
}

function mockMutableWorkPlans(initialPlans: WorkPlan[] = [plan]) {
  let storedPlans = initialPlans;
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/export-templates") return [exportTemplate];
    if (path === "/owner-account-mappings") return [{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }];
    if (path.startsWith("/work-plan-series")) return [];
    if (path.startsWith("/custom-fields")) return [ownerField, effortField];
    if (path === "/work-plans?limit=500") return storedPlans;
    if (path === "/work-plans" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as Partial<WorkPlan>;
      const copied = { ...plan, ...input, id: copiedPlanId, sortOrder: storedPlans.length, version: 1 };
      storedPlans = [...storedPlans, copied];
      return copied;
    }
    if (path === "/work-plans/reorder" && init?.method === "POST") {
      const { orderedIds } = JSON.parse(String(init.body)) as { orderedIds: string[] };
      const byId = new Map(storedPlans.map((item) => [item.id, item]));
      storedPlans = orderedIds.map((id, index) => ({ ...byId.get(id)!, sortOrder: index, version: byId.get(id)!.version + 1 }));
      return storedPlans;
    }
    if (path.startsWith("/work-plans")) return storedPlans;
    throw new Error(`Unexpected API path: ${path}`);
  });
}

describe("editor permissions", () => {
  it("keeps work plan export and editing while hiding import and template management", async () => {
    sessionMock.user = { username: "测试", role: "editor", loginMode: "password" };
    const view = renderPage();
    await screen.findByText("示例计划");

    expect(screen.getByRole("button", { name: /导出 XLS/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建工作计划" })).toBeTruthy();
    expect(screen.queryByText("导入 XLS")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /导出 XLS/ }));
    expect(screen.queryByLabelText("另存为模板名称")).toBeNull();
    expect(screen.getByRole("button", { name: "导出" })).toBeTruthy();
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
    const headers = Array.from(view.container.querySelectorAll<HTMLElement>(".planner-columns > span"));
    const header = (label: string) => headers.find((element) => element.textContent === label);
    expect(header("工作内容")?.classList.contains("plan-column-centered")).toBe(false);
    expect(header("状态")?.classList.contains("plan-column-centered")).toBe(true);
    expect(header("开始时间")?.classList.contains("plan-column-centered")).toBe(true);
    expect(header("结束时间")?.classList.contains("plan-column-centered")).toBe(true);
    expect(header("负责人")?.classList.contains("plan-column-centered")).toBe(false);
    expect(header("工时")?.classList.contains("plan-column-centered")).toBe(true);

    expect(view.container.querySelector(".status-badge")?.parentElement?.classList.contains("plan-cell-centered")).toBe(true);
    expect(Array.from(view.container.querySelectorAll(".plan-row time")).every((element) => element.classList.contains("plan-cell-centered"))).toBe(true);
    expect(screen.getByTitle("lxj").classList.contains("plan-cell-centered")).toBe(false);
    expect(screen.getByTitle("8").classList.contains("plan-cell-centered")).toBe(true);
    view.unmount();
  });
});

describe("work plan ordering and copying", () => {
  it("forces start ascending, end descending, then recurring first", async () => {
    const early = { ...plan, id: "10000000-0000-4000-8000-000000000001", title: "最早开始", startAt: new Date(2026, 7, 8, 9).toISOString(), endAt: new Date(2026, 7, 8, 10).toISOString() };
    const longer = { ...plan, id: "10000000-0000-4000-8000-000000000002", title: "同起点较晚结束", endAt: new Date(2026, 7, 8, 14).toISOString() };
    const shorter = { ...plan, id: "10000000-0000-4000-8000-000000000003", title: "同起点较早结束", endAt: new Date(2026, 7, 8, 11).toISOString() };
    const later = { ...plan, id: "10000000-0000-4000-8000-000000000004", title: "最晚开始", startAt: new Date(2026, 7, 8, 11).toISOString(), endAt: new Date(2026, 7, 8, 15).toISOString() };
    const oneTime = { ...plan, id: "10000000-0000-4000-8000-000000000005", title: "同时间单次", sortOrder: 0 };
    const recurring = { ...plan, id: "10000000-0000-4000-8000-000000000006", title: "同时间重复", sortOrder: 1, seriesId: "20000000-0000-4000-8000-000000000001" };
    mockMutableWorkPlans([later, shorter, oneTime, early, recurring, longer]);
    const view = renderPage();
    await screen.findByText("最早开始");

    const expected = ["最早开始", "同起点较晚结束", "同时间重复", "同时间单次", "同起点较早结束", "最晚开始"];
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

  it("places the timeline controls over the timeline pane", async () => {
    const view = renderPage();
    await screen.findByText("示例计划");

    const tabs = screen.getByRole("tablist", { name: "时间轴视图" });
    expect(tabs.closest(".planner-timeline")).not.toBeNull();
    expect(tabs.closest(".planner-table")).toBeNull();
    const previousRange = screen.getByRole("button", { name: "上一时间范围" });
    const nextRange = screen.getByRole("button", { name: "下一时间范围" });
    const today = screen.getByRole("button", { name: "今天" });
    expect(previousRange.closest(".planner-timeline")).not.toBeNull();
    expect(nextRange.closest(".planner-table")).toBeNull();
    const ganttSettings = screen.getByRole("button", { name: "甘特条属性" });
    expect(ganttSettings.closest(".planner-timeline")).not.toBeNull();
    expect(ganttSettings.closest(".planner-table")).toBeNull();
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
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
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
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
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
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
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
