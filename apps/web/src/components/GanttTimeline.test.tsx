// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { CustomFieldDefinition, WorkPlan } from "@workplan/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GanttTimeline, { formatGanttTooltip, type GanttDisplayProperty } from "./GanttTimeline";

const ganttMock = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  tasks: [] as Array<{ id: string; name: string; start: Date; end: Date; custom_class?: string }>,
  range: null as { start: Date; end: Date } | null,
  renderCount: 0,
  element: null as HTMLElement | null,
  injectInteractiveDom: false,
}));

vi.mock("../lib/gantt", () => ({
  loadGantt: vi.fn(async () => class MockGantt {
    gantt_start = new Date();
    gantt_end = new Date();

    constructor(_element: HTMLElement, tasks: Array<{ id: string; name: string; start: Date; end: Date }>, options: Record<string, unknown>) {
      ganttMock.tasks = tasks;
      ganttMock.options = options;
      ganttMock.element = _element;
    }

    setup_date_values() {
      ganttMock.range = { start: this.gantt_start, end: this.gantt_end };
    }

    render() {
      ganttMock.renderCount += 1;
      // 可选注入最小甘特 DOM（条形与网格行），用于驱动真实的拖拽与双击回调测试。
      if (!ganttMock.injectInteractiveDom || !ganttMock.element) return;
      const ganttContainer = document.createElement("div");
      ganttContainer.className = "gantt-container";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "gantt");
      const barWrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
      barWrapper.setAttribute("class", "bar-wrapper");
      barWrapper.setAttribute("data-id", plan.id);
      const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bar.setAttribute("class", "bar");
      bar.setAttribute("x", "0");
      bar.setAttribute("width", "100");
      barWrapper.append(bar);
      const gridRow = document.createElementNS("http://www.w3.org/2000/svg", "g");
      gridRow.setAttribute("class", "grid-row");
      svg.append(barWrapper, gridRow);
      ganttContainer.append(svg);
      ganttMock.element.append(ganttContainer);
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
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: { owner: "lxj" },
  monthlyGoalIds: [],
  ownerAccount: null,
  ownerConflict: null,
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
  sortOrder: 0,
  defaultValue: null,
  archivedAt: null,
  version: 1,
  options: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

// Builds an ISO instant that maps back to the given local calendar date in
// every timezone, so tooltip date assertions stay deterministic.
function localIso(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 10, 0, 0, 0).toISOString();
}

beforeEach(() => {
  ganttMock.options = null;
  ganttMock.tasks = [];
  ganttMock.range = null;
  ganttMock.renderCount = 0;
  ganttMock.element = null;
  ganttMock.injectInteractiveDom = false;
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
      popup_on: "hover",
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

  it("supplies a virtual whole-day task for an empty month grid", async () => {
    const rangeStart = new Date(2026, 7, 1);
    const rangeEnd = new Date(2026, 8, 1);
    render(<GanttTimeline plans={[]} displayProperties={[]} view="month" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />);

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.id).toBe("__empty-timeline__");
    expect(ganttMock.tasks[0]?.start).toEqual(new Date(2026, 7, 1));
    expect(ganttMock.tasks[0]?.end).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
    expect(ganttMock.options).toMatchObject({ column_width: 32, scroll_to: "2026-08-01" });
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

  it("shows the work content in the bar label when selected", async () => {
    render(
      <GanttTimeline
        plans={[plan]}
        displayProperties={[{ id: "title", label: "工作内容" }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.name).toBe("设计评审");
  });

  it("marks conflict bars with gantt-conflict while non-conflict bars keep status classes", async () => {
    const conflicted: WorkPlan = {
      ...plan,
      ownerConflict: {
        owner: "lxj",
        counterparts: [{ id: "c1ee0e58-5d1c-4f0e-9b6f-0a4ac1a2b3c4", label: "现场勘查", startAt: plan.startAt, endAt: plan.endAt }],
      },
    };
    const view = render(
      <GanttTimeline plans={[plan, conflicted]} displayProperties={[]} view="week" rangeStart={new Date(2026, 7, 3)} rangeEnd={new Date(2026, 7, 10)} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(2));
    expect(ganttMock.tasks[0]?.custom_class).toBe("gantt-pending");
    expect(ganttMock.tasks[1]?.custom_class).toBe("gantt-pending gantt-conflict");

    // 冲突出现/消失必须触发甘特重渲染（ganttInputSignature 纳入 counterparts 标记）
    const rendersBefore = ganttMock.renderCount;
    view.rerender(
      <GanttTimeline plans={[{ ...plan, id: conflicted.id }]} displayProperties={[]} view="week" rangeStart={new Date(2026, 7, 3)} rangeEnd={new Date(2026, 7, 10)} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(ganttMock.renderCount).toBeGreaterThan(rendersBefore));
    expect(ganttMock.tasks[0]?.custom_class).toBe("gantt-pending");
    view.unmount();
  });

  it("truncates work content beyond 20 characters in the bar label", async () => {
    const longTitledPlan = { ...plan, title: "试".repeat(21) };
    render(
      <GanttTimeline
        plans={[longTitledPlan]}
        displayProperties={[{ id: "title", label: "工作内容" }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.name).toBe(`${"试".repeat(20)}…`);
  });

  it("keeps exactly-20-character work content intact in the bar label", async () => {
    const titledPlan = { ...plan, title: "试".repeat(20) };
    render(
      <GanttTimeline
        plans={[titledPlan]}
        displayProperties={[{ id: "title", label: "工作内容" }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.name).toBe("试".repeat(20));
  });

  it("truncates only the work content value when joining bar label properties", async () => {
    const longTitledPlan = { ...plan, title: "试".repeat(25) };
    render(
      <GanttTimeline
        plans={[longTitledPlan]}
        displayProperties={[{ id: "title", label: "工作内容" }, { id: "status", label: "状态" }, { id: "custom:owner", label: "负责人", field: ownerField }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.tasks).toHaveLength(1));
    expect(ganttMock.tasks[0]?.name).toBe(`${"试".repeat(20)}… · 待开始 · lxj`);
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

  it("feeds the custom tooltip callback while staying in hover mode", async () => {
    const tooltipPlan = {
      ...plan,
      status: "in_progress" as const,
      startAt: localIso(2026, 8, 5),
      endAt: localIso(2026, 8, 5),
    };
    render(
      <GanttTimeline
        plans={[tooltipPlan]}
        tooltipProperties={[{ id: "status", label: "状态" }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.options).toMatchObject({ popup_on: "hover" }));
    const popup = ganttMock.options?.popup as ((context: { task: { id: string } }) => string | false) | undefined;
    expect(typeof popup).toBe("function");
    const html = popup!({ task: { id: tooltipPlan.id } });
    expect(html).toContain("设计评审");
    expect(html).toContain("8月5日 - 8月5日");
    expect(html).toContain("进行中");
    expect(html).toContain("持续 1 天");
    expect(popup!({ task: { id: "missing-plan" } })).toBe(false);
  });

  it("uses the latest tooltip selection on re-render without rebuilding the Gantt", async () => {
    const view = render(
      <GanttTimeline
        plans={[plan]}
        tooltipProperties={[]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ganttMock.options).not.toBeNull());
    const renderCount = ganttMock.renderCount;
    const popup = ganttMock.options?.popup as ((context: { task: { id: string } }) => string | false) | undefined;
    expect(typeof popup).toBe("function");

    view.rerender(
      <GanttTimeline
        plans={[plan]}
        tooltipProperties={[{ id: "status", label: "状态" }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(ganttMock.renderCount).toBe(renderCount);
    const html = popup!({ task: { id: plan.id } });
    expect(html).toContain("设计评审");
    expect(html).toContain("待开始");
  });
});

describe("read-only timeline", () => {
  beforeEach(() => {
    ganttMock.injectInteractiveDom = true;
  });

  it("does not fire creation or schedule mutations from double-click or dragging", async () => {
    const onScheduleChange = vi.fn();
    const onCreateAt = vi.fn();
    const view = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
        readOnly
      />,
    );

    await waitFor(() => expect(ganttMock.options).not.toBeNull());
    const mount = view.container.querySelector<HTMLElement>(".gantt-mount")!;
    expect(mount).toBeTruthy();
    expect(mount.querySelector(".handle-group")).toBeNull();

    fireEvent.dblClick(mount.querySelector(".grid-row")!);
    fireEvent.mouseDown(mount.querySelector(".bar")!, { button: 0, clientX: 0 });
    fireEvent.mouseMove(document, { clientX: 150 });
    fireEvent.mouseUp(document, { clientX: 150 });

    expect(onCreateAt).not.toHaveBeenCalled();
    expect(onScheduleChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps bar selection working in read-only mode", async () => {
    const onSelect = vi.fn();
    const view = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={onSelect}
        readOnly
      />,
    );

    await waitFor(() => expect(ganttMock.options).not.toBeNull());
    const onClick = ganttMock.options?.on_click as ((task: { id: string }) => void) | undefined;
    expect(typeof onClick).toBe("function");
    onClick!({ id: plan.id });
    expect(onSelect).toHaveBeenCalledWith(plan);
    view.unmount();
  });

  it("still fires creation and schedule callbacks when writable", async () => {
    const onScheduleChange = vi.fn();
    const onCreateAt = vi.fn();
    const view = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
      />,
    );

    await waitFor(() => expect(ganttMock.options).not.toBeNull());
    const mount = view.container.querySelector<HTMLElement>(".gantt-mount")!;
    expect(mount.querySelector(".handle-group")).not.toBeNull();

    fireEvent.dblClick(mount.querySelector(".grid-row")!);
    expect(onCreateAt).toHaveBeenCalled();

    fireEvent.mouseDown(mount.querySelector(".bar")!, { button: 0, clientX: 0 });
    fireEvent.mouseMove(document, { clientX: 150 });
    fireEvent.mouseUp(document, { clientX: 150 });
    await waitFor(() => expect(onScheduleChange).toHaveBeenCalled());
    view.unmount();
  });
});

describe("formatGanttTooltip", () => {
  const statusProperty: GanttDisplayProperty[] = [{ id: "status", label: "状态" }];
  const ownerProperty: GanttDisplayProperty[] = [{ id: "custom:owner", label: "工作负责人", field: ownerField }];

  it("shows only the title and a Chinese date range by default", () => {
    const html = formatGanttTooltip({ ...plan, startAt: localIso(2026, 8, 1), endAt: localIso(2026, 8, 3) }, []);
    expect(html).toContain("设计评审");
    expect(html).toContain("8月1日 - 8月3日");
    expect(html).not.toContain("持续");
    expect(html.replace(/<[^>]+>/g, "")).not.toMatch(/[A-Za-z]/);
  });

  it("renders the selected status as label-prefixed Chinese text", () => {
    expect(formatGanttTooltip(plan, statusProperty)).toContain("状态：待开始");
  });

  it("renders a selected custom field with its label prefix and formatCustomFieldValue semantics", () => {
    expect(formatGanttTooltip(plan, ownerProperty)).toContain("工作负责人：lxj");
  });

  it("omits the whole line when a selected value is the placeholder", () => {
    const html = formatGanttTooltip({ ...plan, customFields: {} }, ownerProperty);
    expect(html).not.toContain("—");
    expect(html).not.toContain("lxj");
  });

  it("shows the Chinese duration for in-progress plans including both end days", () => {
    const html = formatGanttTooltip({
      ...plan,
      status: "in_progress",
      startAt: localIso(2026, 8, 1),
      endAt: localIso(2026, 8, 3),
    }, []);
    expect(html).toContain("8月1日 - 8月3日");
    expect(html).toContain("持续 3 天");
  });

  it("shows the Chinese duration for completed plans", () => {
    const html = formatGanttTooltip({
      ...plan,
      status: "completed" as const,
      startAt: localIso(2026, 8, 1),
      endAt: localIso(2026, 8, 1),
    }, []);
    expect(html).toContain("持续 1 天");
  });

  it("omits the duration for pending and cancelled plans", () => {
    expect(formatGanttTooltip(plan, [])).not.toContain("持续");
    expect(formatGanttTooltip({ ...plan, status: "cancelled" as const }, [])).not.toContain("持续");
  });

  it("does not include the year for a range within the same month", () => {
    const html = formatGanttTooltip({ ...plan, startAt: localIso(2026, 8, 1), endAt: localIso(2026, 8, 5) }, []);
    expect(html).toContain("8月1日 - 8月5日");
    expect(html).not.toContain("2026年");
  });

  it("includes the year when the range crosses months", () => {
    const html = formatGanttTooltip({ ...plan, startAt: localIso(2026, 8, 31), endAt: localIso(2026, 9, 2) }, []);
    expect(html).toContain("2026年8月31日 - 2026年9月2日");
  });

  it("includes each side's own year when the range crosses years", () => {
    const html = formatGanttTooltip({ ...plan, startAt: localIso(2026, 12, 31), endAt: localIso(2027, 1, 2) }, []);
    expect(html).toContain("2026年12月31日 - 2027年1月2日");
  });

  it("escapes HTML in the title and property values", () => {
    const html = formatGanttTooltip({ ...plan, title: "<b>设计&评审</b>" }, []);
    expect(html).toContain("&lt;b&gt;设计&amp;评审&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("renders selected properties in selection order", () => {
    const html = formatGanttTooltip(
      {
        ...plan,
        status: "in_progress",
        startAt: localIso(2026, 8, 1),
        endAt: localIso(2026, 8, 3),
        customFields: { owner: "冯铭倩" },
      },
      [...statusProperty, ...ownerProperty],
    );
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("状态：进行中");
    expect(text).toContain("工作负责人：冯铭倩");
    expect(text.indexOf("状态：进行中")).toBeLessThan(text.indexOf("工作负责人：冯铭倩"));
    expect(text.indexOf("冯铭倩")).toBeLessThan(text.indexOf("持续 3 天"));
  });

  it("escapes property labels and values in the tooltip", () => {
    const html = formatGanttTooltip(plan, [{ id: "custom:owner", label: "<b>负责人</b>", field: ownerField }]);
    expect(html).toContain("&lt;b&gt;负责人&lt;/b&gt;：lxj");
    expect(html).not.toContain("<b>");
  });
});

describe("formatGanttTooltip 冲突提示（规格 R6）", () => {
  const conflictedPlan: WorkPlan = {
    ...plan,
    ownerConflict: {
      owner: "lxj",
      counterparts: [
        { id: "c1ee0e58-5d1c-4f0e-9b6f-0a4ac1a2b3c4", label: "现场勘查", startAt: localIso(2026, 8, 6), endAt: localIso(2026, 8, 7) },
        { id: "d2ff1f69-6e2d-5a1f-8c7f-1b5bd2b3c4d5", label: "设备消缺", startAt: localIso(2026, 8, 9), endAt: localIso(2026, 8, 10) },
      ],
    },
  };

  it("冲突任务强制展示负责人行与逐条冲突清单，不管用户提示属性配置", () => {
    const html = formatGanttTooltip(conflictedPlan, [], ownerField);
    expect(html).toContain("gantt-conflict-block");
    expect(html).toContain("gantt-conflict-owner");
    expect(html).toContain("负责人：lxj");
    expect(html).toContain("与【现场勘查】8月6日 - 8月7日 时间冲突");
    expect(html).toContain("与【设备消缺】8月9日 - 8月10日 时间冲突");
  });

  it("owner 字段缺省时回退到固定文案与原始值", () => {
    const html = formatGanttTooltip(conflictedPlan, []);
    expect(html).toContain("工作负责人：lxj");
  });

  it("非冲突任务不含冲突区块，用户配置不受影响", () => {
    const html = formatGanttTooltip(plan, [{ id: "status", label: "状态" }]);
    expect(html).not.toContain("gantt-conflict");
    expect(html).toContain("状态：待开始");
  });

  it("冲突对象名称做 HTML 转义", () => {
    const html = formatGanttTooltip({
      ...plan,
      ownerConflict: {
        owner: "lxj",
        counterparts: [{ id: "e3aa2a7a-7f3e-6b2f-9d8f-2c6ce3c4d5e6", label: "<x>任务</x>", startAt: localIso(2026, 8, 6), endAt: localIso(2026, 8, 7) }],
      },
    }, []);
    expect(html).toContain("与【&lt;x&gt;任务&lt;/x&gt;】");
    expect(html).not.toContain("<x>任务</x>");
  });
});
