// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ListRemindersResponse, Reminder, WorkPlan, WorkbenchOverview } from "@workplan/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import { toLocalDateString } from "../lib/format";

const apiMock = vi.hoisted(() => vi.fn());
const fetchRemindersMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({ api: apiMock, fetchReminders: fetchRemindersMock }));

const now = Date.now();

function makePlan(overrides: Partial<WorkPlan> & { id: string; title: string }): WorkPlan {
  return {
    description: "",
    status: "pending",
    statusMode: "automatic",
    startAt: new Date(now + 86_400_000).toISOString(),
    endAt: new Date(now + 172_800_000).toISOString(),
    version: 1,
    seriesId: null,
    occurrenceKey: null,
    isException: false,
    customFields: {},
    monthlyGoalIds: [],
    ownerAccount: null,
    ownerConflict: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

const today = toLocalDateString(new Date());

function emptyOverview(): WorkbenchOverview {
  return {
    evaluatedAt: new Date(now).toISOString(),
    timeZone: "Asia/Shanghai",
    today,
    windowEnd: today,
    startingToday: { items: [], total: 0 },
    continuingToday: { items: [], total: 0 },
    upcoming: { items: [], total: 0 },
    summary: { all: 0, pending: 0, inProgress: 0, completed: 0 },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/overview"]}>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue(emptyOverview());
  fetchRemindersMock.mockReset();
  fetchRemindersMock.mockResolvedValue({ days: [] } satisfies ListRemindersResponse);
});

describe("OverviewPage", () => {
  it("renders server blocks verbatim and links an upcoming plan to its week and detail drawer", async () => {
    const upcomingPlan = makePlan({ id: "f6251b28-a2d2-4f7f-bff1-b901cb1d9a53", title: "下周计划" });
    apiMock.mockResolvedValue({ ...emptyOverview(), upcoming: { items: [upcomingPlan], total: 1 } });
    const view = renderPage();

    const link = await screen.findByRole("link", { name: /下周计划/ });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    const params = new URLSearchParams(url.search);
    expect(url.pathname).toBe("/work-plans");
    expect(params.get("view")).toBe("week");
    expect(params.get("date")).toBe(upcomingPlan.startAt);
    expect(params.get("plan")).toBe(upcomingPlan.id);
    view.unmount();
  });

  it("shows each plan only in the block reported by the server", async () => {
    apiMock.mockResolvedValue({
      ...emptyOverview(),
      startingToday: { items: [makePlan({ id: "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c", title: "今天开工" })], total: 1 },
      continuingToday: { items: [makePlan({ id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", title: "跨天改造" })], total: 1 },
    });
    const view = renderPage();

    expect(await screen.findByRole("heading", { name: "今日新开工" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /今天开工/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今日继续开工" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /跨天改造/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "接下来的计划" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("reflects server-computed summary counts", async () => {
    apiMock.mockResolvedValue({
      ...emptyOverview(),
      summary: { all: 12, pending: 5, inProgress: 4, completed: 3 },
    });
    const view = renderPage();

    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    view.unmount();
  });

  it("shows the overall empty state when no plans need attention today", async () => {
    const view = renderPage();

    expect(await screen.findByText("今天没有需要关注的工作计划")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日新开工" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日继续开工" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "接下来的计划" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("fetches today's reminders next to the plan groups and opens the plan from a reminder row", async () => {
    const reminderPlanId = "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c";
    fetchRemindersMock.mockResolvedValue({
      days: [{ date: today, reminders: [{ type: "work-order", date: today, originalDate: null, plans: [{ id: reminderPlanId, title: "起检修单", startAt: new Date(now + 86_400_000).toISOString(), endAt: new Date(now + 90_000_000).toISOString(), createdAt: new Date(now).toISOString(), risk: null }] }] }],
    });
    const view = renderPage();

    const heading = await screen.findByRole("heading", { name: "今日提醒" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("检修单提醒")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /起检修单/ });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    const params = new URLSearchParams(url.search);
    expect(url.pathname).toBe("/work-plans");
    expect(params.get("plan")).toBe(reminderPlanId);
    view.unmount();
  });

  it("labels plan-submission reminders and lists every triggered plan", async () => {
    const plans: Reminder["plans"] = [
      { id: "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c", title: "高风险检修", startAt: new Date(now + 86_400_000).toISOString(), endAt: new Date(now + 90_000_000).toISOString(), createdAt: new Date(now).toISOString(), risk: "高" },
      { id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", title: "中风险改造", startAt: new Date(now + 259_200_000).toISOString(), endAt: new Date(now + 260_000_000).toISOString(), createdAt: new Date(now).toISOString(), risk: "中" },
    ];
    fetchRemindersMock.mockResolvedValue({
      days: [{ date: today, reminders: [{ type: "plan-submission", date: today, originalDate: null, plans }] }],
    });
    const view = renderPage();

    expect(await screen.findAllByText("作业计划提交提醒")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /高风险检修/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /中风险改造/ })).toBeInTheDocument();
    view.unmount();
  });

  it("notes the original reminder date on overdue reminders re-hung on today", async () => {
    fetchRemindersMock.mockResolvedValue({
      days: [{ date: today, reminders: [{ type: "work-order", date: today, originalDate: "2026-08-20", plans: [{ id: "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c", title: "逾期检修", startAt: new Date(now + 86_400_000).toISOString(), endAt: new Date(now + 90_000_000).toISOString(), createdAt: new Date(now).toISOString(), risk: null }] }] }],
    });
    const view = renderPage();

    const link = await screen.findByRole("link", { name: /逾期检修/ });
    expect(link).toHaveTextContent("原提醒日 2026/08/20");
    view.unmount();
  });

  it("omits the reminders panel when there is nothing to remind today", async () => {
    const view = renderPage();

    await screen.findByRole("heading", { name: "工作台" });
    expect(screen.queryByRole("heading", { name: "今日提醒" })).not.toBeInTheDocument();
    expect(screen.queryByText("检修单提醒", { exact: true })).not.toBeInTheDocument();
    view.unmount();
  });
});
