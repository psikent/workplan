// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import type { CustomFieldDefinition, WorkPlan } from "@workplan/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GanttTimeline from "./GanttTimeline";

const ganttMock = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  tasks: [] as Array<{ id: string; name: string; start: Date; end: Date }>,
  range: null as { start: Date; end: Date } | null,
  renderCount: 0,
}));

vi.mock("../lib/gantt", () => ({
  loadGantt: vi.fn(async () => class MockGantt {
    gantt_start = new Date();
    gantt_end = new Date();

    constructor(_element: HTMLElement, tasks: Array<{ id: string; name: string; start: Date; end: Date }>, options: Record<string, unknown>) {
      ganttMock.tasks = tasks;
      ganttMock.options = options;
    }

    setup_date_values() {
      ganttMock.range = { start: this.gantt_start, end: this.gantt_end };
    }

    render() {
      ganttMock.renderCount += 1;
    }
  }),
}));

const plan: WorkPlan = {
  id: "b70cff45-b93c-4dff-ab87-e15ef3d2494f",
  title: "设计评审",
  description: "评审交互",
  status: "pending",
  statusMode: "automatic",
  startAt: "2026-08-05T02:00:00.000Z",
  endAt: "2026-08-05T04:00:00.000Z",
  sortOrder: 0,
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: { owner: "lxj" },
  ownerAccount: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
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
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  ganttMock.options = null;
  ganttMock.tasks = [];
  ganttMock.range = null;
  ganttMock.renderCount = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
});

afterEach(() => vi.restoreAllMocks());

describe("GanttTimeline adapter", () => {
  it("uses whole-day tasks while leaving date interaction to the document-level controller", async () => {
    const onScheduleChange = vi.fn();
    const rangeStart = new Date(2026, 7, 3);
    const rangeEnd = new Date(2026, 7, 10);
    render(<GanttTimeline plans={[plan]} displayProperties={[]} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={onScheduleChange} onSelect={vi.fn()} />);

    await waitFor(() => expect(ganttMock.options).toMatchObject({ column_width: 100 }));
    expect(ganttMock.options).toMatchObject({
      column_width: 100,
      snap_at: "1d",
      infinite_padding: false,
      scroll_to: "2026-08-03",
      readonly_dates: true,
      readonly_progress: true,
      move_dependencies: false,
    });
    expect(ganttMock.tasks[0]?.start.getHours()).toBe(0);
    expect(ganttMock.tasks[0]?.start.getMinutes()).toBe(0);
    expect(ganttMock.tasks[0]?.end.getHours()).toBe(23);
    expect(ganttMock.tasks[0]?.end.getMinutes()).toBe(59);
    expect(ganttMock.options?.view_modes).toEqual([expect.objectContaining({ name: "Day", step: "1d", padding: ["0d", "0d"] })]);
    expect(ganttMock.options?.on_date_change).toBeUndefined();
    expect(ganttMock.range).toEqual({ start: rangeStart, end: new Date(2026, 7, 9) });
    expect(ganttMock.renderCount).toBeGreaterThan(0);
    expect(onScheduleChange).not.toHaveBeenCalled();
  });

  it("uses whole-day snapping for the natural month view", async () => {
    const rangeStart = new Date(2026, 7, 1);
    const rangeEnd = new Date(2026, 8, 1);
    render(<GanttTimeline plans={[plan]} displayProperties={[]} view="month" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />);
    await waitFor(() => expect(ganttMock.options).not.toBeNull());
    expect(ganttMock.options).toMatchObject({ column_width: 32, snap_at: "1d", scroll_to: "2026-08-01" });
    expect(ganttMock.range).toEqual({ start: rangeStart, end: new Date(2026, 7, 31) });
  });

  it("shows only selected property values in the Gantt bar label", async () => {
    render(
      <GanttTimeline
        plans={[plan]}
        displayProperties={[{ id: "status", label: "状态" }, { id: "custom:owner", label: "负责人", field: ownerField }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.name).toBe("待开始 · lxj");
  });

  it("leaves the Gantt bar label empty when no property is selected", async () => {
    render(<GanttTimeline plans={[plan]} displayProperties={[]} view="week" rangeStart={new Date(2026, 7, 3)} rangeEnd={new Date(2026, 7, 10)} onScheduleChange={vi.fn()} onSelect={vi.fn()} />);

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.name).toBe("");
  });

  it("keeps the existing Gantt when refreshed plans have the same rendered content", async () => {
    const rangeStart = new Date(2026, 7, 3);
    const rangeEnd = new Date(2026, 7, 10);
    const firstSelect = vi.fn();
    const view = render(
      <GanttTimeline plans={[plan]} displayProperties={[]} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={firstSelect} />,
    );

    await waitFor(() => expect(ganttMock.renderCount).toBeGreaterThan(0));
    const renderCount = ganttMock.renderCount;
    const onClick = ganttMock.options?.on_click as ((task: { id: string }) => void);
    const refreshedPlan = { ...plan, version: plan.version + 1, updatedAt: "2026-08-10T00:00:00.000Z" };
    const latestSelect = vi.fn();

    view.rerender(
      <GanttTimeline plans={[refreshedPlan]} displayProperties={[]} view="week" rangeStart={new Date(rangeStart)} rangeEnd={new Date(rangeEnd)} onScheduleChange={vi.fn()} onSelect={latestSelect} />,
    );

    await waitFor(() => expect(ganttMock.renderCount).toBe(renderCount));
    onClick({ id: plan.id });
    expect(firstSelect).not.toHaveBeenCalled();
    expect(latestSelect).toHaveBeenCalledWith(refreshedPlan);
  });

  it("rerenders the Gantt when rendered plan content changes", async () => {
    const rangeStart = new Date(2026, 7, 3);
    const rangeEnd = new Date(2026, 7, 10);
    const view = render(
      <GanttTimeline plans={[plan]} displayProperties={[{ id: "status", label: "状态" }]} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    await waitFor(() => expect(ganttMock.renderCount).toBeGreaterThan(0));
    const renderCount = ganttMock.renderCount;

    view.rerender(
      <GanttTimeline plans={[{ ...plan, status: "in_progress" }]} displayProperties={[{ id: "status", label: "状态" }]} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    await waitFor(() => expect(ganttMock.renderCount).toBeGreaterThan(renderCount));
    expect(ganttMock.tasks[0]?.name).toBe("进行中");
  });
});
