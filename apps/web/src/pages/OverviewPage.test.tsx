// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ListRemindersResponse, WorkPlan } from "@workplan/contracts";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import { toLocalDateString } from "../lib/format";

const apiMock = vi.hoisted(() => vi.fn());
const fetchRemindersMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({ api: apiMock, fetchReminders: fetchRemindersMock }));

// The overview groups plans by local calendar day, so the fixture dates must
// stay relative to the current time instead of a hardcoded range.
const now = Date.now();

function makePlan(overrides: Partial<WorkPlan> & { id: string; title: string }): WorkPlan {
  return {
    description: "",
    status: "pending",
    statusMode: "automatic",
    startAt: new Date(now + 86_400_000).toISOString(),
    endAt: new Date(now + 172_800_000).toISOString(),
    sortOrder: 0,
    version: 1,
    seriesId: null,
    occurrenceKey: null,
    isException: false,
    customFields: {},
    monthlyGoalIds: [],
    ownerAccount: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

function dayAtOffset(days: number, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const today = toLocalDateString(new Date());

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

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue([makePlan({ id: "f6251b28-a2d2-4f7f-bff1-b901cb1d9a53", title: "下周计划" })]);
  fetchRemindersMock.mockReset();
  fetchRemindersMock.mockResolvedValue({ days: [] } satisfies ListRemindersResponse);
});

describe("OverviewPage", () => {
  it("links an upcoming plan to its week and detail drawer", async () => {
    const view = renderPage();

    const link = await screen.findByRole("link", { name: /下周计划/ });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    const params = new URLSearchParams(url.search);
    expect(url.pathname).toBe("/work-plans");
    expect(params.get("view")).toBe("week");
    expect(params.get("date")).toBe(new Date(now + 86_400_000).toISOString());
    expect(params.get("plan")).toBe("f6251b28-a2d2-4f7f-bff1-b901cb1d9a53");
    view.unmount();
  });

  it("lists a plan starting today under 今日新开工 only", async () => {
    apiMock.mockResolvedValue([makePlan({ id: "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c", title: "今天开工", startAt: dayAtOffset(0, 9), endAt: dayAtOffset(0, 18) })]);
    const view = renderPage();

    expect(await screen.findByRole("heading", { name: "今日新开工" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /今天开工/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日继续开工" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "接下来的计划" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("lists a plan spanning today under 今日继续开工 only", async () => {
    apiMock.mockResolvedValue([makePlan({ id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", title: "跨天改造", startAt: dayAtOffset(-3, 9), endAt: dayAtOffset(1, 18) })]);
    const view = renderPage();

    expect(await screen.findByRole("heading", { name: "今日继续开工" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /跨天改造/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日新开工" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "接下来的计划" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("keeps upcoming plans within the seven working-day window and hides empty groups", async () => {
    apiMock.mockResolvedValue([
      makePlan({ id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", title: "窗口内计划", startAt: dayAtOffset(1, 9), endAt: dayAtOffset(2, 18) }),
      makePlan({ id: "3d4e5f6a-7b8c-4d9e-0f1a-2b3c4d5e6f7a", title: "窗口外计划", startAt: dayAtOffset(20, 9), endAt: dayAtOffset(21, 18) }),
    ]);
    const view = renderPage();

    expect(await screen.findByRole("heading", { name: "接下来的计划" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /窗口内计划/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /窗口外计划/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日新开工" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日继续开工" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("excludes completed and cancelled plans from every group", async () => {
    apiMock.mockResolvedValue([
      makePlan({ id: "4e5f6a7b-8c9d-4e0f-1a2b-3c4d5e6f7a8b", title: "已完成事项", status: "completed", startAt: dayAtOffset(0, 9), endAt: dayAtOffset(0, 18) }),
      makePlan({ id: "5f6a7b8c-9d0e-4f1a-2b3c-4d5e6f7a8b9c", title: "已取消事项", status: "cancelled", startAt: dayAtOffset(1, 9), endAt: dayAtOffset(2, 18) }),
    ]);
    const view = renderPage();

    expect(await screen.findByText("今天没有需要关注的工作计划")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /已完成事项/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /已取消事项/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日新开工" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("shows the overall empty state when no plans need attention today", async () => {
    apiMock.mockResolvedValue([]);
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
      days: [{ date: today, reminders: [{ type: "work-order", date: today, originalDate: null, plans: [{ id: reminderPlanId, title: "起检修单", startAt: new Date(now + 86_400_000).toISOString(), risk: null }] }] }],
    });
    const view = renderPage();

    const heading = await screen.findByRole("heading", { name: "今日提醒" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("检修单提醒")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /起检修单/ });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    const params = new URLSearchParams(url.search);
    expect(url.pathname).toBe("/work-plans");
    expect(params.get("view")).toBe("week");
    expect(params.get("plan")).toBe(reminderPlanId);
    view.unmount();
  });

  it("labels plan-submission reminders and lists every triggered plan", async () => {
    fetchRemindersMock.mockResolvedValue({
      days: [{
        date: today,
        reminders: [{
          type: "plan-submission",
          date: today,
          originalDate: null,
          plans: [
            { id: "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c", title: "高风险检修", startAt: new Date(now + 86_400_000).toISOString(), risk: "高" },
            { id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", title: "中风险改造", startAt: new Date(now + 259_200_000).toISOString(), risk: "中" },
          ],
        }],
      }],
    });
    const view = renderPage();

    expect(await screen.findAllByText("作业计划提交提醒")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /高风险检修/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /中风险改造/ })).toBeInTheDocument();
    view.unmount();
  });

  it("notes the original reminder date on overdue reminders re-hung on today", async () => {
    fetchRemindersMock.mockResolvedValue({
      days: [{ date: today, reminders: [{ type: "work-order", date: today, originalDate: "2026-08-20", plans: [{ id: "0a1b9f74-3d2e-4f5a-8c6b-7d9e0f1a2b3c", title: "逾期检修", startAt: new Date(now + 86_400_000).toISOString(), risk: null }] }] }],
    });
    const view = renderPage();

    const link = await screen.findByRole("link", { name: /逾期检修/ });
    expect(link).toHaveTextContent("原提醒日 2026/08/20");
    view.unmount();
  });

  it("omits the reminders panel when there is nothing to remind today", async () => {
    const view = renderPage();

    await screen.findByRole("heading", { name: "接下来的计划" });
    expect(screen.queryByRole("heading", { name: "今日提醒" })).not.toBeInTheDocument();
    expect(screen.queryByText("检修单提醒", { exact: true })).not.toBeInTheDocument();
    view.unmount();
  });
});
