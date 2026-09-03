// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MonthlyGoal, MonthlyGoalSeries, MonthlyGoalSeriesDissolvePreview, MonthlyGoalSeriesFrequency, WorkPlan } from "@workplan/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { ToastProvider } from "../components/ToastProvider";
import MonthlyGoalsPage from "./MonthlyGoalsPage";

const apiMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  user: { username: "lxj", role: "admin" as "admin" | "editor" | "viewer", loginMode: "password" as "password" | "token" },
}));

vi.mock("../App", () => ({
  useSession: () => ({ user: sessionMock.user, signOut: vi.fn() }),
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: apiMock,
}));

const linkedPlan: WorkPlan = {
  id: "3f2a5a12-7e3a-4b3f-a4c0-d1b2e3f4a5b6",
  title: "官网上线计划",
  description: "",
  status: "in_progress",
  statusMode: "automatic",
  startAt: "2026-08-10T02:00:00.000Z",
  endAt: "2026-08-20T03:00:00.000Z",
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: {},
  monthlyGoalIds: [],
  ownerAccount: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const freePlan: WorkPlan = {
  ...linkedPlan,
  id: "a1b2c3d4-1111-4222-8333-444455556666",
  title: "待排期设计评审",
  status: "pending",
  startAt: "2026-08-25T02:00:00.000Z",
  endAt: "2026-08-26T03:00:00.000Z",
};

const occupiedPlan: WorkPlan = {
  ...linkedPlan,
  id: "b2c3d4e5-2222-4333-8444-555566667777",
  title: "他人占用的计划",
  status: "completed",
  monthlyGoalIds: ["8e7f6a5b-3333-4ddd-8eee-abcdefabcdef"],
};

function goalFixture(overrides: Partial<MonthlyGoal> = {}): MonthlyGoal {
  return {
    id: "7c1e2d3f-aaaa-4bbb-8ccc-0123456789ab",
    title: "完成官网改版",
    description: "主页与详情页上线",
    year: 2026,
    month: 8,
    archivedAt: null,
    version: 1,
    status: "pending",
    linkedWorkPlan: null,
    seriesId: null,
    occurrenceKey: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const activeGoal = goalFixture({
  title: "完成官网改版",
  id: "5d6e3902-7a69-4e7d-8c1c-4a34ecc0f179",
  status: "in_progress",
  linkedWorkPlan: { id: linkedPlan.id, title: linkedPlan.title },
});
const unlinkedGoal = goalFixture({ id: "8e7f6a5b-3333-4ddd-8eee-abcdefabcdef", title: "完成内容审核" });
const archivedGoal = goalFixture({
  id: "9f0a1b2c-4444-4eee-8fff-012345678901",
  title: "已归档的季度评审",
  status: "completed",
  archivedAt: "2026-08-10T00:00:00.000Z",
});

let storedGoals: MonthlyGoal[] = [];
let storedPlans: WorkPlan[] = [];
let storedSeries: MonthlyGoalSeries[] = [];

export const seriesFixture: MonthlyGoalSeries = {
  id: "a0b0c0d0-5555-4666-8777-888899990000",
  template: { title: "定期巡检", description: "每月巡检一次" },
  frequency: "monthly",
  interval: 1,
  startPeriod: { year: 2026, month: 8 },
  occurrenceCount: 3,
  untilPeriod: { year: 2026, month: 10 },
  active: true,
  version: 1,
  instanceCount: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function mockStatefulApi(
  initialGoals: MonthlyGoal[] = [activeGoal, unlinkedGoal, archivedGoal],
  initialPlans: WorkPlan[] = [linkedPlan, freePlan, occupiedPlan],
  initialSeries: MonthlyGoalSeries[] = [],
) {
  storedGoals = initialGoals;
  storedPlans = initialPlans;
  storedSeries = initialSeries;
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const [cleanPath = "", query = ""] = path.split("?");
    if (cleanPath === "/monthly-goal-series" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as {
        template: { title: string; description: string };
        frequency: MonthlyGoalSeriesFrequency;
        interval: number;
        startPeriod: { year: number; month: number };
        occurrenceCount: number | null;
        untilPeriod: { year: number; month: number } | null;
      };
      const series: MonthlyGoalSeries = {
        id: seriesFixture.id,
        template: input.template,
        frequency: input.frequency,
        interval: input.interval,
        startPeriod: input.startPeriod,
        occurrenceCount: input.occurrenceCount,
        untilPeriod: input.untilPeriod,
        active: true,
        version: 1,
        instanceCount: input.occurrenceCount ?? 3,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      };
      const generated: MonthlyGoal[] = [];
      for (let index = 0; index < (input.occurrenceCount ?? 3); index += 1) {
        const key = addPeriod(input.startPeriod, stepMonths(input.frequency, input.interval), index);
        generated.push(goalFixture({ id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: input.template.title, description: input.template.description, year: key.year, month: key.month, seriesId: series.id, occurrenceKey: occurrenceKeyOf(key) }));
      }
      storedSeries = [...storedSeries, series];
      storedGoals = [...storedGoals, ...generated];
      return { series, generated };
    }
    if (cleanPath.startsWith("/monthly-goal-series/") && init?.method === "PATCH") {
      const id = cleanPath.split("/").at(-1)!;
      const input = JSON.parse(String(init.body)) as { version: number; occurrenceCount?: number | null; untilPeriod?: { year: number; month: number } | null; frequency?: MonthlyGoalSeriesFrequency; interval?: number };
      const current = storedSeries.find((series) => series.id === id);
      if (!current) throw new ApiError({ status: 404, code: "NOT_FOUND", detail: "目标重复系列不存在" });
      const updated: MonthlyGoalSeries = {
        ...current,
        frequency: input.frequency ?? current.frequency,
        interval: input.interval ?? current.interval,
        occurrenceCount: input.occurrenceCount === undefined ? current.occurrenceCount : input.occurrenceCount,
        untilPeriod: input.untilPeriod === undefined ? current.untilPeriod : input.untilPeriod,
        version: current.version + 1,
      };
      storedSeries = storedSeries.map((series) => series.id === id ? updated : series);
      return { series: updated, generated: [] };
    }
    if (cleanPath.startsWith("/monthly-goal-series/") && init?.method === "DELETE") {
      const id = cleanPath.split("/").at(-1)!;
      storedSeries = storedSeries.map((series) => series.id === id ? { ...series, active: false, version: series.version + 1 } : series);
      return undefined;
    }
    if (cleanPath.startsWith("/monthly-goal-series/")) {
      const id = cleanPath.split("/").at(-1)!;
      const series = storedSeries.find((item) => item.id === id);
      if (!series) throw new ApiError({ status: 404, code: "NOT_FOUND", detail: "目标重复系列不存在" });
      return { ...series, instances: storedGoals.filter((goal) => goal.seriesId === id).map((goal) => ({ id: goal.id, title: goal.title, year: goal.year, month: goal.month, archivedAt: goal.archivedAt })) };
    }
    if (cleanPath === "/monthly-goal-series") return storedSeries;
    if (cleanPath === "/monthly-goals" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as Partial<MonthlyGoal> & { workPlanId: string | null };
      const linked = input.workPlanId ? storedPlans.find((plan) => plan.id === input.workPlanId) : undefined;
      const created = goalFixture({
        id: "10000000-0000-4000-8000-000000000001",
        title: input.title ?? "",
        description: input.description ?? "",
        year: input.year ?? 2026,
        month: input.month ?? 8,
        status: linked?.status ?? null,
        linkedWorkPlan: linked ? { id: linked.id, title: linked.title } : null,
      });
      storedGoals = [...storedGoals, created];
      return created;
    }
    if (cleanPath.startsWith("/monthly-goals/") && init?.method === "PATCH") {
      const id = cleanPath.split("/").at(-1)!;
      const input = JSON.parse(String(init.body)) as Partial<MonthlyGoal> & { archived?: boolean; workPlanId?: string | null };
      const current = storedGoals.find((goal) => goal.id === id);
      if (!current) throw new ApiError({ status: 404, code: "NOT_FOUND", detail: "月目标不存在" });
      const linked = input.workPlanId === undefined
        ? current.linkedWorkPlan
        : input.workPlanId === null
          ? null
          : (() => {
              const plan = storedPlans.find((item) => item.id === input.workPlanId);
              return plan ? { id: plan.id, title: plan.title } : null;
            })();
      const updated: MonthlyGoal = {
        ...current,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        year: input.year ?? current.year,
        month: input.month ?? current.month,
        archivedAt: input.archived === undefined ? current.archivedAt : input.archived ? "2026-08-10T00:00:00.000Z" : null,
        version: current.version + 1,
        linkedWorkPlan: linked,
        status: linked ? storedPlans.find((item) => item.id === linked.id)?.status ?? null : null,
      };
      storedGoals = storedGoals.map((goal) => goal.id === id ? updated : goal);
      return updated;
    }
    if (cleanPath.startsWith("/monthly-goals/") && init?.method === "DELETE") {
      const id = cleanPath.split("/").at(-1)!;
      storedGoals = storedGoals.filter((goal) => goal.id !== id);
      return undefined;
    }
    if (cleanPath === "/monthly-goals/quick-edit" && init?.method === "PUT") {
      const input = JSON.parse(String(init.body)) as {
        year: number;
        rows: Array<{ originalTitle: string | null; title: string; activeMonths: number[] }>;
      };
      const created = input.rows.flatMap((row) => row.originalTitle === null
        ? row.activeMonths.map((month, index) => goalFixture({
            id: `90000000-0000-4000-8000-${String(storedGoals.length + index).padStart(12, "0")}`,
            title: row.title,
            year: input.year,
            month,
          }))
        : []);
      storedGoals = [...storedGoals, ...created];
      return { createdCount: created.length, updatedCount: 0, goals: storedGoals.filter((goal) => goal.year === input.year) };
    }
    if (cleanPath === "/monthly-goals") {
      const params = new URLSearchParams(query);
      const year = Number(params.get("year"));
      const monthValue = params.get("month");
      const month = monthValue === null ? null : Number(monthValue);
      return storedGoals.filter((goal) => goal.year === year && (month === null || goal.month === month));
    }
    if (cleanPath === "/work-plans" && query === "limit=500") return storedPlans;
    throw new Error(`Unexpected API path: ${path}`);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 22, 9));
  sessionMock.user = { username: "lxj", role: "admin", loginMode: "password" };
  apiMock.mockClear();
  mockStatefulApi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MonthlyGoalsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function toolbarSelects(container: HTMLElement) {
  return container.querySelectorAll<HTMLSelectElement>(".month-selector select");
}

function stepMonths(frequency: MonthlyGoalSeriesFrequency, interval: number): number {
  return frequency === "monthly" ? interval : frequency === "quarterly" ? interval * 3 : interval * 12;
}

function addPeriod(start: { year: number; month: number }, step: number, index: number): { year: number; month: number } {
  const key = start.year * 12 + start.month - 1 + step * index;
  return { year: Math.floor(key / 12), month: (key % 12) + 1 };
}

function occurrenceKeyOf(period: { year: number; month: number }): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

/** The toast region keeps up to three messages alive, so assertions target the newest one. */
function latestToast() {
  return screen.getAllByRole("status").at(-1);
}

describe("MonthlyGoalsPage", () => {
  it("opens the annual quick editor with the current year", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: "快速编辑月目标" }));
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    expect(within(dialog).getByRole("combobox")).toHaveValue("2026");
    await within(dialog).findByLabelText("完成官网改版，目标名称");
    expect(within(dialog).getByLabelText("完成官网改版，8 月")).toBeChecked();
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path === "/monthly-goals?year=2026&includeArchived=true")).toBe(true));
    view.unmount();
  });

  it("updates the parent year after saving and keeps the selected month", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: "快速编辑月目标" }));
    const dialog = await screen.findByRole("dialog", { name: "年度快速编辑" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "2027" } });
    await within(dialog).findByLabelText("第 1 行，目标名称");
    fireEvent.change(within(dialog).getByLabelText("第 1 行，目标名称"), { target: { value: "切年保存验证" } });
    fireEvent.click(within(dialog).getByLabelText("切年保存验证，2 月"));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "年度快速编辑" })).toBeNull());
    expect(toolbarSelects(view.container)[0]?.value).toBe("2027");
    expect(toolbarSelects(view.container)[1]?.value).toBe("8");
    expect(latestToast()).toHaveTextContent("年度月目标已保存");
    view.unmount();
  });

  it("renders the month's goals, derived badges and the summary copy", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    expect(screen.getByRole("heading", { name: "月目标" })).toBeTruthy();
    expect(screen.getByText("本月已完成 0 / 2 个目标")).toBeTruthy();
    expect(screen.getByText("完成官网改版")).toBeTruthy();
    expect(screen.getByText("完成内容审核")).toBeTruthy();

    expect(screen.getByTitle(linkedPlan.title)).toBeTruthy();
    expect(screen.getAllByText("进行中")).toHaveLength(2); // linked plan badge + derived goal badge
    expect(screen.getByText("未关联")).toBeTruthy();

    // Hidden archived goal and its completion excluded from the summary.
    expect(screen.queryByText("已归档的季度评审")).toBeNull();
    view.unmount();
  });

  it("shows archived goals only after toggling and keeps the summary stable", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("checkbox", { name: "显示已归档" }));
    await screen.findByText("已归档的季度评审");
    expect(screen.getByText("已归档")).toBeTruthy();
    expect(screen.getByText("本月已完成 0 / 2 个目标")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "显示已归档" }));
    await waitFor(() => expect(screen.queryByText("已归档的季度评审")).toBeNull());
    view.unmount();
  });

  it("switches months and refetches the matching list", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    const selects = toolbarSelects(view.container);
    expect(selects[0]?.value).toBe("2026");
    expect(selects[1]?.value).toBe("8");

    fireEvent.change(selects[1]!, { target: { value: "9" } });
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path === "/monthly-goals?year=2026&month=9&includeArchived=true")).toBe(true));
    await screen.findByText("这个月还没有配置月目标");
    expect(screen.queryByText("完成官网改版")).toBeNull();
    expect(screen.getByText("本月已完成 0 / 0 个目标")).toBeTruthy();
    view.unmount();
  });

  it("creates a goal through the dialog and submits the linked plan", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: "新建月目标" }));
    expect(screen.getByRole("heading", { name: "新建月目标" })).toBeTruthy();
    const form = view.container.querySelector<HTMLFormElement>(".goal-dialog")!;
    const recurrenceSection = form.querySelector("fieldset.form-section")!;
    const descriptionField = screen.getByLabelText(/说明/).parentElement!;
    const gridChildren = Array.from(form.querySelector(".field-grid")!.children);
    expect(recurrenceSection.classList).toContain("full");
    expect(gridChildren.indexOf(recurrenceSection)).toBeLessThan(gridChildren.indexOf(descriptionField));

    fireEvent.change(screen.getByLabelText(/目标名称/), { target: { value: "冲刺收尾" } });
    fireEvent.change(screen.getByLabelText(/说明/), { target: { value: "收尾总结会" } });
    fireEvent.change(screen.getByRole("combobox", { name: /关联计划/ }), { target: { value: freePlan.id } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const createCall = apiMock.mock.calls.find(([path, init]) => path === "/monthly-goals" && init?.method === "POST");
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        title: "冲刺收尾",
        description: "收尾总结会",
        year: 2026,
        month: 8,
        workPlanId: freePlan.id,
      });
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("月目标已创建"));
    expect(screen.queryByRole("heading", { name: "新建月目标" })).toBeNull();
    await screen.findByText("冲刺收尾");
    expect(screen.getByText("本月已完成 0 / 3 个目标")).toBeTruthy();
    view.unmount();
  });

  it("offers only Work Plans that overlap the Monthly Goal month when creating", async () => {
    const crossMonthPlan: WorkPlan = {
      ...freePlan,
      id: "b3c4d5e6-2222-4333-8444-555566667788",
      title: "跨月发布计划",
      startAt: new Date(2026, 6, 31, 23).toISOString(),
      endAt: new Date(2026, 7, 1, 1).toISOString(),
    };
    const septemberPlan: WorkPlan = {
      ...freePlan,
      id: "c3d4e5f6-3333-4444-8555-666677778888",
      title: "九月独立计划",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    mockStatefulApi([activeGoal, unlinkedGoal], [freePlan, septemberPlan, linkedPlan, crossMonthPlan]);
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: "新建月目标" }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;

    expect(Array.from(planSelect.options, (option) => option.textContent)).toEqual([
      "不关联",
      crossMonthPlan.title,
      linkedPlan.title,
      freePlan.title,
    ]);
    view.unmount();
  });

  it("offers same-month and cross-month Work Plans when editing without showing other months", async () => {
    const crossMonthPlan: WorkPlan = {
      ...freePlan,
      id: "c4d5e6f7-4444-4555-8666-777788889999",
      title: "七八月持续计划",
      startAt: new Date(2026, 6, 31, 23).toISOString(),
      endAt: new Date(2026, 7, 2, 9).toISOString(),
    };
    const septemberPlan: WorkPlan = {
      ...freePlan,
      id: "d5e6f708-5555-4666-8777-888899990000",
      title: "九月独立计划",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    mockStatefulApi([activeGoal], [linkedPlan, freePlan, crossMonthPlan, septemberPlan]);
    const view = renderPage();
    await screen.findByText(activeGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${activeGoal.title}` }));
    const optionLabels = Array.from(
      (screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement).options,
      (option) => option.textContent,
    );

    expect(optionLabels).toEqual([
      "不关联",
      crossMonthPlan.title,
      linkedPlan.title,
      freePlan.title,
    ]);
    expect(optionLabels).not.toContain(septemberPlan.title);
    view.unmount();
  });

  it("keeps an out-of-month Work Plan visible for an existing Goal-Plan Link", async () => {
    const historicalPlan: WorkPlan = {
      ...freePlan,
      id: "d4e5f607-4444-4555-8666-777788889999",
      title: "九月历史关联计划",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    const otherSeptemberPlan: WorkPlan = {
      ...historicalPlan,
      id: "d5e6f718-4545-4666-8777-888899990011",
      title: "其他九月计划",
      monthlyGoalIds: [],
    };
    const historicalGoal = goalFixture({
      id: "e5f60718-5555-4666-8777-888899990000",
      title: "保留历史关联",
      linkedWorkPlan: { id: historicalPlan.id, title: historicalPlan.title },
      status: historicalPlan.status,
    });
    historicalPlan.monthlyGoalIds = [historicalGoal.id];
    mockStatefulApi([historicalGoal], [freePlan, historicalPlan, otherSeptemberPlan]);
    const view = renderPage();
    await screen.findByText(historicalGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${historicalGoal.title}` }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;

    expect(planSelect.value).toBe(historicalPlan.id);
    expect(Array.from(planSelect.options, (option) => option.textContent)).toContain(
      `${historicalPlan.title}（当前关联，不在所选月份）`,
    );
    expect(Array.from(planSelect.options, (option) => option.textContent)).not.toContain(otherSeptemberPlan.title);

    fireEvent.change(screen.getByLabelText(/目标名称/), { target: { value: "保留历史关联（二版）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const patchCall = apiMock.mock.calls.find(([path, init]) => path === `/monthly-goals/${historicalGoal.id}` && init?.method === "PATCH");
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        title: "保留历史关联（二版）",
        workPlanId: historicalPlan.id,
      });
    });
    view.unmount();
  });

  it("keeps a Goal-Plan Link visible when its Work Plan is outside the capped candidate response", async () => {
    const omittedPlan: WorkPlan = {
      ...freePlan,
      id: "e6f71829-5656-4777-8888-999900001122",
      title: "候选列表外的当前计划",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    const omittedPlanGoal = goalFixture({
      id: "f718293a-6767-4888-8999-000011112233",
      title: "候选列表外关联目标",
      linkedWorkPlan: { id: omittedPlan.id, title: omittedPlan.title },
      status: omittedPlan.status,
    });
    mockStatefulApi([omittedPlanGoal], [freePlan]);
    const view = renderPage();
    await screen.findByText(omittedPlanGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${omittedPlanGoal.title}` }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;
    expect(planSelect.value).toBe(omittedPlan.id);
    expect(Array.from(planSelect.options, (option) => option.textContent)).toContain(
      `${omittedPlan.title}（当前关联，未在候选列表中）`,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "所属月份" }), { target: { value: "9" } });
    expect(planSelect.value).toBe(omittedPlan.id);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: `关联计划 ${omittedPlanGoal.title}` }));
    expect(view.container.querySelector(".goal-link-current")).toHaveTextContent("计划未在候选列表中，无法确认目标所属月份");
    view.unmount();
  });

  it("waits for Work Plan candidates before changing the period of a linked Monthly Goal", async () => {
    const statefulApi = apiMock.getMockImplementation()!;
    let resolvePlans!: (plans: WorkPlan[]) => void;
    const pendingPlans = new Promise<WorkPlan[]>((resolve) => {
      resolvePlans = resolve;
    });
    apiMock.mockImplementation((path: string, init?: RequestInit) => (
      path === "/work-plans?limit=500" ? pendingPlans : statefulApi(path, init)
    ));
    const view = renderPage();
    await screen.findByText(activeGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${activeGoal.title}` }));
    const monthSelect = screen.getByRole("combobox", { name: "所属月份" });
    expect(monthSelect).toBeDisabled();

    resolvePlans([linkedPlan, freePlan, occupiedPlan]);
    await waitFor(() => expect(monthSelect).not.toBeDisabled());
    fireEvent.change(monthSelect, { target: { value: "9" } });
    expect((screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement).value).toBe("");
    view.unmount();
  });

  it("clears an out-of-month Goal-Plan Link from the draft before saving", async () => {
    const view = renderPage();
    await screen.findByText(activeGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${activeGoal.title}` }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;
    expect(planSelect.value).toBe(linkedPlan.id);

    fireEvent.change(screen.getByRole("combobox", { name: "所属月份" }), { target: { value: "9" } });
    expect(planSelect.value).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "所属月份" }), { target: { value: "8" } });
    expect(planSelect.value).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "所属月份" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const patchCall = apiMock.mock.calls.find(([path, init]) => path === `/monthly-goals/${activeGoal.id}` && init?.method === "PATCH");
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        month: 9,
        workPlanId: null,
      });
    });
    view.unmount();
  });

  it("keeps the persisted Goal-Plan Link when a year change is cancelled", async () => {
    const view = renderPage();
    await screen.findByText(activeGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${activeGoal.title}` }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;
    fireEvent.change(screen.getByRole("combobox", { name: "所属年份" }), { target: { value: "2027" } });
    expect(planSelect.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(apiMock.mock.calls.some(([path, init]) => path === `/monthly-goals/${activeGoal.id}` && init?.method === "PATCH")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: `编辑 ${activeGoal.title}` }));
    expect((screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement).value).toBe(linkedPlan.id);
    view.unmount();
  });

  it("keeps a Goal-Plan Link whose Work Plan still overlaps the changed month", async () => {
    const crossMonthPlan: WorkPlan = {
      ...freePlan,
      id: "4b5c6d7e-1111-4222-8333-444455556677",
      title: "八九月持续计划",
      startAt: new Date(2026, 7, 15, 9).toISOString(),
      endAt: new Date(2026, 8, 15, 9).toISOString(),
    };
    const crossMonthGoal = goalFixture({
      id: "5c6d7e8f-2222-4333-8444-555566667788",
      title: "跨月目标",
      linkedWorkPlan: { id: crossMonthPlan.id, title: crossMonthPlan.title },
      status: crossMonthPlan.status,
    });
    crossMonthPlan.monthlyGoalIds = [crossMonthGoal.id];
    mockStatefulApi([crossMonthGoal], [crossMonthPlan]);
    const view = renderPage();
    await screen.findByText(crossMonthGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${crossMonthGoal.title}` }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;
    fireEvent.change(screen.getByRole("combobox", { name: "所属月份" }), { target: { value: "9" } });
    expect(planSelect.value).toBe(crossMonthPlan.id);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const patchCall = apiMock.mock.calls.find(([path, init]) => path === `/monthly-goals/${crossMonthGoal.id}` && init?.method === "PATCH");
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        month: 9,
        workPlanId: crossMonthPlan.id,
      });
    });
    view.unmount();
  });

  it("does not clear a Goal-Plan Link when the Work Plan range is invalid", async () => {
    const invalidPlan: WorkPlan = {
      ...freePlan,
      id: "6d7e8f90-3333-4444-8555-666677778899",
      title: "日期异常的历史计划",
      startAt: new Date(2026, 7, 20, 9).toISOString(),
      endAt: new Date(2026, 7, 19, 9).toISOString(),
    };
    const invalidRangeGoal = goalFixture({
      id: "7e8f901a-4444-4555-8666-777788889900",
      title: "日期异常关联目标",
      linkedWorkPlan: { id: invalidPlan.id, title: invalidPlan.title },
      status: invalidPlan.status,
    });
    invalidPlan.monthlyGoalIds = [invalidRangeGoal.id];
    mockStatefulApi([invalidRangeGoal], [invalidPlan]);
    const view = renderPage();
    await screen.findByText(invalidRangeGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${invalidRangeGoal.title}` }));
    const planSelect = screen.getByRole("combobox", { name: /关联计划/ }) as HTMLSelectElement;
    fireEvent.change(screen.getByRole("combobox", { name: "所属月份" }), { target: { value: "9" } });

    expect(planSelect.value).toBe(invalidPlan.id);
    view.unmount();
  });

  it("filters quick picker Work Plans by month before applying search", async () => {
    const crossMonthPlan: WorkPlan = {
      ...freePlan,
      id: "f6071829-6666-4777-8888-999900001111",
      title: "跨月交付计划",
      description: "统一检索词",
      startAt: new Date(2026, 7, 31, 23).toISOString(),
      endAt: new Date(2026, 8, 1, 1).toISOString(),
    };
    const septemberPlan: WorkPlan = {
      ...freePlan,
      id: "0718293a-7777-4888-8999-000011112222",
      title: "九月迁移计划",
      description: "统一检索词",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    mockStatefulApi([unlinkedGoal], [freePlan, crossMonthPlan, septemberPlan]);
    const view = renderPage();
    await screen.findByText(unlinkedGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `关联计划 ${unlinkedGoal.title}` }));
    expect(await screen.findByRole("button", { name: new RegExp(crossMonthPlan.title) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(septemberPlan.title) })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("搜索工作计划"), { target: { value: "统一检索词" } });
    expect(screen.getByRole("button", { name: new RegExp(crossMonthPlan.title) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(septemberPlan.title) })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("搜索工作计划"), { target: { value: "没有这个计划" } });
    expect(screen.getByText("没有匹配的工作计划")).toBeTruthy();
    view.unmount();
  });

  it("marks a quick picker Goal-Plan Link whose Work Plan is outside the Monthly Goal month", async () => {
    const historicalPlan: WorkPlan = {
      ...freePlan,
      id: "18293a4b-8888-4999-8000-111122223333",
      title: "九月历史快捷关联",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    const historicalGoal = goalFixture({
      id: "293a4b5c-9999-4000-8111-222233334444",
      title: "历史快捷关联目标",
      linkedWorkPlan: { id: historicalPlan.id, title: historicalPlan.title },
      status: historicalPlan.status,
    });
    historicalPlan.monthlyGoalIds = [historicalGoal.id];
    mockStatefulApi([historicalGoal], [freePlan, historicalPlan]);
    const view = renderPage();
    await screen.findByText(historicalGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `关联计划 ${historicalGoal.title}` }));
    const currentLink = view.container.querySelector(".goal-link-current");
    expect(currentLink).toHaveTextContent(`当前关联：${historicalPlan.title}`);
    expect(currentLink).toHaveTextContent("不在目标所属月份");
    expect(screen.queryByRole("button", { name: new RegExp(historicalPlan.title) })).toBeNull();
    view.unmount();
  });

  it("shows the month-specific empty state when no Work Plans overlap", async () => {
    const septemberPlan: WorkPlan = {
      ...freePlan,
      id: "3a4b5c6d-0000-4111-8222-333344445555",
      title: "仅九月计划",
      startAt: new Date(2026, 8, 10, 9).toISOString(),
      endAt: new Date(2026, 8, 11, 9).toISOString(),
    };
    mockStatefulApi([unlinkedGoal], [septemberPlan]);
    const view = renderPage();
    await screen.findByText(unlinkedGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `关联计划 ${unlinkedGoal.title}` }));

    expect(await screen.findByText("所选月份暂无可关联计划")).toBeTruthy();
    view.unmount();
  });

  it("uses Work Plan terminology across Monthly Goal link controls", async () => {
    const view = renderPage();
    await screen.findByText(activeGoal.title);

    expect(screen.getByText("每月为工作安排一组随月份变化的目标，并自动跟随关联计划完成。")).toBeTruthy();
    expect(view.container.querySelector(".goals-table.table-head")).toHaveTextContent("关联计划");
    const linkButton = screen.getByRole("button", { name: `关联计划 ${unlinkedGoal.title}` });
    expect(linkButton).toHaveAttribute("title", "关联计划");

    fireEvent.click(screen.getByRole("button", { name: "新建月目标" }));
    expect(screen.getByRole("combobox", { name: "关联计划" })).toBeTruthy();
    expect(screen.getByText("未关联计划时目标显示为「未关联」。")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "频率" }), { target: { value: "monthly" } });
    expect(screen.getByText(/每期可单独编辑与关联计划/)).toBeTruthy();
    view.unmount();
  });

  it("shows the recurring goal's series editing entry in the goal dialog", async () => {
    const recurringGoal = goalFixture({
      title: "定期巡检",
      seriesId: seriesFixture.id,
      occurrenceKey: "2026-08",
    });
    mockStatefulApi([recurringGoal, unlinkedGoal], [linkedPlan, freePlan, occupiedPlan], [seriesFixture]);
    const view = renderPage();
    await screen.findByText("定期巡检");

    fireEvent.click(screen.getByRole("button", { name: "编辑 定期巡检" }));
    expect(screen.getByText("每月重复 · 共 3 期")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑重复周期" }));
    expect(await screen.findByRole("dialog", { name: "目标重复周期" })).toBeTruthy();
    view.unmount();
  });

  it("edits a goal while keeping other fields untouched", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: /编辑 完成官网改版/ }));
    expect(screen.getByRole("heading", { name: "编辑月目标" })).toBeTruthy();
    expect((screen.getByLabelText(/目标名称/) as HTMLInputElement).value).toBe("完成官网改版");

    fireEvent.change(screen.getByLabelText(/目标名称/), { target: { value: "完成官网改版（二版）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const patchCall = apiMock.mock.calls.find(([path, init]) => path === "/monthly-goals/5d6e3902-7a69-4e7d-8c1c-4a34ecc0f179" && init?.method === "PATCH");
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        title: "完成官网改版（二版）",
        description: "主页与详情页上线",
        year: 2026,
        month: 8,
        workPlanId: linkedPlan.id,
        version: 1,
      });
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("月目标已保存"));
    await screen.findByText("完成官网改版（二版）");
    view.unmount();
  });

  it("archives, restores and deletes a goal with confirmation", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: /归档 完成官网改版/ }));
    await waitFor(() => expect(latestToast()).toHaveTextContent("月目标已归档"));
    await waitFor(() => expect(screen.queryByText("完成官网改版")).toBeNull());

    fireEvent.click(screen.getByRole("checkbox", { name: "显示已归档" }));
    await screen.findByText("完成官网改版");
    fireEvent.click(screen.getByRole("button", { name: /恢复 完成官网改版/ }));
    await waitFor(() => expect(latestToast()).toHaveTextContent("月目标已恢复"));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示已归档" }));

    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /删除 完成官网改版/ }));
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("删除后该月目标将从关联的工作计划中消失"));
    await waitFor(() => expect(latestToast()).toHaveTextContent("月目标已删除"));
    await waitFor(() => expect(screen.queryByText("完成官网改版")).toBeNull());
    expect(screen.getByText("完成内容审核")).toBeTruthy();
    view.unmount();
  });

  it("links and unlinks a goal through the plan picker, disabling occupied rows", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: "关联计划 完成内容审核" }));
    expect(screen.getByRole("dialog", { name: "关联工作计划" })).toBeTruthy();

    const occupiedRow = view.container.querySelector<HTMLButtonElement>(".goal-link-option.disabled");
    expect(occupiedRow).not.toBeNull();
    expect(occupiedRow?.textContent).toContain("他人占用的计划");
    expect(occupiedRow?.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /待排期设计评审/ }));
    await waitFor(() => expect(latestToast()).toHaveTextContent("已关联工作计划"));
    await screen.findByText("待排期设计评审");

    fireEvent.click(screen.getByRole("button", { name: "关联计划 完成内容审核" }));
    fireEvent.click(screen.getByRole("button", { name: "解除关联" }));
    await waitFor(() => expect(latestToast()).toHaveTextContent("已解除关联"));
    await waitFor(() => expect(screen.queryByTitle("待排期设计评审")).toBeNull());
    view.unmount();
  });

  it("surfaces version conflicts in the form and refreshes the list", async () => {
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/monthly-goals/") && init?.method === "PATCH") {
        throw new ApiError({ status: 409, code: "VERSION_CONFLICT", detail: "数据已被修改，请刷新后重试" });
      }
      if (path.startsWith("/monthly-goals")) return storedGoals;
      if (path.startsWith("/work-plans")) return storedPlans;
      throw new Error(`Unexpected API path: ${path}`);
    });
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: /编辑 完成官网改版/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("数据已被修改，请刷新后重试"));
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });

  it("submits a recurring series payload and renders the generated instances", async () => {
    const view = renderPage();
    await screen.findByText("完成官网改版");

    fireEvent.click(screen.getByRole("button", { name: "新建月目标" }));
    fireEvent.change(screen.getByLabelText(/目标名称/), { target: { value: "定期巡检" } });
    fireEvent.change(screen.getByLabelText(/说明/), { target: { value: "每月巡检一次" } });
    fireEvent.change(screen.getByRole("combobox", { name: "频率" }), { target: { value: "monthly" } });
    fireEvent.change(screen.getByRole("combobox", { name: "结束方式" }), { target: { value: "count" } });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="number"][min="1"][max="600"]')!, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const createCall = apiMock.mock.calls.find(([path, init]) => path === "/monthly-goal-series" && init?.method === "POST");
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        template: { title: "定期巡检", description: "每月巡检一次" },
        frequency: "monthly",
        interval: 1,
        startPeriod: { year: 2026, month: 8 },
        occurrenceCount: 3,
        untilPeriod: null,
      });
    });
    await waitFor(() => expect(latestToast()).toHaveTextContent("月目标已创建"));
    await screen.findByText("定期巡检");
    await waitFor(() => expect(screen.getByRole("button", { name: "管理系列 定期巡检" })).toBeTruthy());
    view.unmount();
  });

  it("opens the series dialog from the badge to edit rules and stop generation", async () => {
    const recurringGoal = goalFixture({
      id: "30000000-0000-4000-8000-000000000001",
      title: "定期巡检",
      seriesId: seriesFixture.id,
      occurrenceKey: "2026-08",
    });
    const augustGoal = goalFixture({ // keep an ungrouped goal so the list is not all-series
      id: "40000000-0000-4000-8000-000000000001",
      title: "完成内容审核",
    });
    mockStatefulApi([recurringGoal, augustGoal], [linkedPlan, freePlan, occupiedPlan], [{ ...seriesFixture, instanceCount: 1 }]);
    const view = renderPage();
    await screen.findByText("定期巡检");

    const badge = screen.getByRole("button", { name: "管理系列 定期巡检" });
    expect(badge.getAttribute("title")).toBe("每月重复 · 共 1 期");
    fireEvent.click(badge);

    expect(await screen.findByRole("dialog", { name: "目标重复周期" })).toBeTruthy();
    await screen.findByText("起始于 2026 年 8 月 · 已生成 1 期");
    expect(view.container.querySelectorAll(".series-instance")).toHaveLength(1);
    expect(view.container.querySelector(".series-instance")?.textContent).toContain("2026 年 8 月");

    fireEvent.change(screen.getByRole("combobox", { name: "结束方式" }), { target: { value: "count" } });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="number"][min="1"][max="600"]')!, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存规则" }));

    await waitFor(() => {
      const patchCall = apiMock.mock.calls.find(([path, init]) => path === `/monthly-goal-series/${seriesFixture.id}` && init?.method === "PATCH");
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({ occurrenceCount: 5, version: 1 });
    });
    await waitFor(() => expect(latestToast()).toHaveTextContent("系列规则已保存"));

    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("停止后不再生成后续月目标"));
    await waitFor(() => expect(latestToast()).toHaveTextContent("已停止重复周期"));
    await waitFor(() => expect(screen.getByText(/（已停止）/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "解散重复系列" })).toBeEnabled();
    view.unmount();
  });

  it("previews and dissolves a series after confirming the selected goal title", async () => {
    const selectedGoal = goalFixture({
      id: "50000000-0000-4000-8000-000000000001",
      title: "保留本期巡检",
      seriesId: seriesFixture.id,
      occurrenceKey: "2026-08",
    });
    const protectedGoal = goalFixture({
      id: "50000000-0000-4000-8000-000000000002",
      title: "已经关联的九月巡检",
      year: 2026,
      month: 9,
      seriesId: seriesFixture.id,
      occurrenceKey: "2026-09",
      linkedWorkPlan: { id: linkedPlan.id, title: linkedPlan.title },
      status: "completed",
    });
    const untouchedGoal = goalFixture({
      id: "50000000-0000-4000-8000-000000000003",
      title: "十月自动巡检",
      year: 2026,
      month: 10,
      seriesId: seriesFixture.id,
      occurrenceKey: "2026-10",
    });
    mockStatefulApi([selectedGoal, protectedGoal, untouchedGoal], [linkedPlan], [seriesFixture]);
    const statefulApi = apiMock.getMockImplementation()!;
    const preview: MonthlyGoalSeriesDissolvePreview = {
      seriesId: seriesFixture.id,
      seriesVersion: 1,
      snapshotToken: "a".repeat(64),
      keepGoal: { id: selectedGoal.id, title: selectedGoal.title, year: selectedGoal.year, month: selectedGoal.month },
      counts: { retained: 2, deleted: 1, linked: 1 },
      instances: [
        { id: selectedGoal.id, title: selectedGoal.title, year: 2026, month: 8, archivedAt: null, linkedWorkPlan: null, status: null, action: "retain", reasons: ["selected"] },
        { id: protectedGoal.id, title: protectedGoal.title, year: 2026, month: 9, archivedAt: null, linkedWorkPlan: protectedGoal.linkedWorkPlan, status: "completed", action: "retain", reasons: ["edited", "linked", "completed"] },
        { id: untouchedGoal.id, title: untouchedGoal.title, year: 2026, month: 10, archivedAt: null, linkedWorkPlan: null, status: null, action: "delete", reasons: [] },
      ],
    };
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/monthly-goal-series/${seriesFixture.id}/dissolve-preview?keepGoalId=${selectedGoal.id}`) return preview;
      if (path === `/monthly-goal-series/${seriesFixture.id}/dissolve` && init?.method === "POST") {
        storedGoals = storedGoals
          .filter((goal) => goal.id !== untouchedGoal.id)
          .map((goal) => goal.seriesId === seriesFixture.id ? { ...goal, seriesId: null, occurrenceKey: null, version: goal.version + 1 } : goal);
        storedSeries = storedSeries.filter((series) => series.id !== seriesFixture.id);
        return { retainedCount: 2, deletedCount: 1 };
      }
      return statefulApi(path, init);
    });
    const view = renderPage();
    await screen.findByText(selectedGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `管理系列 ${selectedGoal.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "解散重复系列" }));

    const dissolveDialog = await screen.findByRole("dialog", { name: "解散重复系列" });
    expect(await within(dissolveDialog).findByText("保留为普通月目标（2）")).toBeTruthy();
    expect(within(dissolveDialog).getByText("永久删除（1）")).toBeTruthy();
    expect(within(dissolveDialog).getByText(protectedGoal.title)).toBeTruthy();
    expect(within(dissolveDialog).getByText("已编辑、已关联、已完成")).toBeTruthy();
    expect(within(dissolveDialog).getByText(untouchedGoal.title)).toBeTruthy();
    const dissolveButton = within(dissolveDialog).getByRole("button", { name: "解散并删除 1 个目标" });
    expect(dissolveButton).toBeDisabled();

    fireEvent.change(within(dissolveDialog).getByLabelText("输入目标名称确认"), { target: { value: selectedGoal.title } });
    expect(dissolveButton).toBeEnabled();
    fireEvent.click(dissolveButton);

    await waitFor(() => {
      const dissolveCall = apiMock.mock.calls.find(([path, init]) => path === `/monthly-goal-series/${seriesFixture.id}/dissolve` && init?.method === "POST");
      expect(JSON.parse(String(dissolveCall?.[1]?.body))).toEqual({
        keepGoalId: selectedGoal.id,
        snapshotToken: preview.snapshotToken,
        confirmationTitle: selectedGoal.title,
      });
    });
    await waitFor(() => expect(latestToast()).toHaveTextContent("重复系列已解散：保留 2 个，删除 1 个"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "目标重复周期" })).toBeNull());
    expect(screen.queryByRole("button", { name: `管理系列 ${selectedGoal.title}` })).toBeNull();
    view.unmount();
  });

  it("reloads the dissolve preview and clears confirmation after a version conflict", async () => {
    const selectedGoal = goalFixture({
      id: "60000000-0000-4000-8000-000000000001",
      title: "冲突测试巡检",
      seriesId: seriesFixture.id,
      occurrenceKey: "2026-08",
    });
    mockStatefulApi([selectedGoal], [linkedPlan], [{ ...seriesFixture, instanceCount: 1 }]);
    const statefulApi = apiMock.getMockImplementation()!;
    const preview: MonthlyGoalSeriesDissolvePreview = {
      seriesId: seriesFixture.id,
      seriesVersion: 1,
      snapshotToken: "b".repeat(64),
      keepGoal: { id: selectedGoal.id, title: selectedGoal.title, year: selectedGoal.year, month: selectedGoal.month },
      counts: { retained: 1, deleted: 0, linked: 0 },
      instances: [
        { id: selectedGoal.id, title: selectedGoal.title, year: 2026, month: 8, archivedAt: null, linkedWorkPlan: null, status: null, action: "retain", reasons: ["selected"] },
      ],
    };
    let previewRequests = 0;
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/monthly-goal-series/${seriesFixture.id}/dissolve-preview?keepGoalId=${selectedGoal.id}`) {
        previewRequests += 1;
        return preview;
      }
      if (path === `/monthly-goal-series/${seriesFixture.id}/dissolve` && init?.method === "POST") {
        throw new ApiError({ status: 409, code: "VERSION_CONFLICT", detail: "数据已发生变化" });
      }
      return statefulApi(path, init);
    });
    const view = renderPage();
    await screen.findByText(selectedGoal.title);

    fireEvent.click(screen.getByRole("button", { name: `管理系列 ${selectedGoal.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "解散重复系列" }));
    const dissolveDialog = await screen.findByRole("dialog", { name: "解散重复系列" });
    const confirmationInput = await within(dissolveDialog).findByLabelText("输入目标名称确认");
    fireEvent.change(confirmationInput, { target: { value: selectedGoal.title } });
    fireEvent.click(within(dissolveDialog).getByRole("button", { name: "解散并删除 0 个目标" }));

    await waitFor(() => expect(within(dissolveDialog).getByRole("alert")).toHaveTextContent("数据已发生变化，请重新确认解散范围"));
    expect(confirmationInput).toHaveValue("");
    expect(within(dissolveDialog).getByRole("button", { name: "解散并删除 0 个目标" })).toBeDisabled();
    await waitFor(() => expect(previewRequests).toBeGreaterThanOrEqual(2));
    view.unmount();
  });
});

describe("viewer read-only monthly goals", () => {
  it("keeps browsing and filtering while hiding every write entry", async () => {
    sessionMock.user = { username: "审计", role: "viewer", loginMode: "password" };
    const view = renderPage();
    await screen.findByText("官网上线计划");

    expect(screen.queryByRole("button", { name: "快速编辑月目标" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建月目标" })).toBeNull();
    expect(screen.queryByRole("button", { name: /编辑 官网上线计划/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /关联计划 官网上线计划/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /归档 官网上线计划/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /删除 官网上线计划/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /管理系列/ })).toBeNull();
    expect(screen.getByText(/只读账户/)).toBeTruthy();
    expect(screen.getByText(/不能新建或修改目标/)).toBeTruthy();

    // 查询能力保留：显示已归档、月份切换仍然可用
    fireEvent.click(screen.getByLabelText("显示已归档"));
    await screen.findByText("已归档");
    view.unmount();
  });
});
