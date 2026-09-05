// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReminderDay, WorkPlan } from "@workplan/contracts";
import type { ComponentProps, ComponentType, RefObject } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GanttTimeline, { alignCurrentDateMarker, alignDateHeaderContentVertically, ensureCurrentDateMarker, timelineDateAtPosition } from "./GanttTimeline";

const originalScrollTo = HTMLElement.prototype.scrollTo;
const svgElementPrototype = SVGElement.prototype as SVGElement & { getBBox?: () => DOMRect };
const originalGetBBox = svgElementPrototype.getBBox;
const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => {} });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 80, height: 14 }),
  });
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent ?? ""; },
    set(value: string) { this.textContent = value; },
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: originalScrollTo });
  else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  if (originalGetBBox) Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: originalGetBBox });
  else delete svgElementPrototype.getBBox;
  if (originalInnerText) Object.defineProperty(HTMLElement.prototype, "innerText", originalInnerText);
  else delete (HTMLElement.prototype as { innerText?: unknown }).innerText;
});

beforeEach(() => vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700));
afterEach(() => vi.restoreAllMocks());

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
  customFields: {},
  monthlyGoalIds: [],
  ownerAccount: null,
  ownerConflict: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const trailingPlanId = "cd230f99-29ae-4d04-82fc-2eb710b5c861";

function mouseEventWithOffset(type: string, offsetX: number, clientX = offsetX) {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, "offsetX", { value: offsetX });
  return event;
}

function shiftIsoByLocalDays(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

// Builds an ISO instant that maps back to the given local calendar date in
// every timezone, so hover tooltip date assertions stay deterministic.
function localIso(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 10, 0, 0, 0).toISOString();
}

describe("GanttTimeline rendered grid", () => {
  it("maps adaptive week positions to the first, middle and final local dates", () => {
    const rangeStart = new Date(2026, 7, 3);

    expect(timelineDateAtPosition(0, rangeStart, 100, 7)).toEqual(new Date(2026, 7, 3));
    expect(timelineDateAtPosition(250, rangeStart, 100, 7)).toEqual(new Date(2026, 7, 5));
    expect(timelineDateAtPosition(699.99, rangeStart, 100, 7)).toEqual(new Date(2026, 7, 9));
  });

  it("maps the minimum-width month columns without using the viewport width", () => {
    const rangeStart = new Date(2026, 1, 1);

    expect(timelineDateAtPosition(0, rangeStart, 32, 28)).toEqual(new Date(2026, 1, 1));
    expect(timelineDateAtPosition(32 * 14 + 1, rangeStart, 32, 28)).toEqual(new Date(2026, 1, 15));
    expect(timelineDateAtPosition(32 * 28 - 0.01, rangeStart, 32, 28)).toEqual(new Date(2026, 1, 28));
  });

  it("starts gantt rows at the 46px planner list header height so both sides align", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    // frappe-gantt 表头总高 = lower + upper + 10（库内建常量，写死在其样式表）。
    // 首个 .grid-row 的 y 即表头总高，必须等于列表表头行高 46px（styles.css），
    // 否则每一行计划与甘特条都会错位。
    const row = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".grid-row");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(Number(row.getAttribute("y"))).toBe(46);
  });

  it("renders today's marker when today is the final day of the weekly range", () => {
    const mount = document.createElement("div");
    const originalEnd = new Date(2026, 7, 9);
    let endSeenByGantt: Date | null = null;
    const gantt = {
      gantt_end: originalEnd,
      highlight_current() {
        endSeenByGantt = this.gantt_end;
      },
    };

    ensureCurrentDateMarker(
      gantt,
      mount,
      new Date(2026, 7, 3),
      new Date(2026, 7, 9),
      new Date(2026, 7, 9, 18),
    );

    expect(endSeenByGantt).toEqual(new Date(2026, 7, 9, 23, 59, 59, 999));
    expect(gantt.gantt_end).toBe(originalEnd);
  });

  it("opens the new-plan callback once for a date-grid double click and ignores a single click", async () => {
    const onCreateAt = vi.fn();
    const rangeStart = new Date(2026, 7, 3);
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={rangeStart}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
      />,
    );

    const row = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".grid-row");
      expect(element).not.toBeNull();
      return element!;
    });
    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 0, left: 100, right: 800, top: 0, bottom: 300, width: 700, height: 300, toJSON: () => ({}),
    });

    fireEvent.click(row, { clientX: 501 });
    expect(onCreateAt).not.toHaveBeenCalled();
    fireEvent.doubleClick(row, { clientX: 501 });

    expect(onCreateAt).toHaveBeenCalledOnce();
    expect(onCreateAt).toHaveBeenCalledWith(new Date(2026, 7, 7));
  });

  it("keeps weekend holiday highlights from intercepting double clicks", async () => {
    const onCreateAt = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
      />,
    );

    const holiday = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".holiday-highlight");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(holiday.style.pointerEvents).toBe("none");

    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 0, left: 100, right: 800, top: 0, bottom: 300, width: 700, height: 300, toJSON: () => ({}),
    });

    // Saturday 2026-08-08 occupies the sixth day column (x = 500, width 100).
    fireEvent.doubleClick(holiday, { clientX: 100 + Number(holiday.getAttribute("x")) + 50 });

    expect(onCreateAt).toHaveBeenCalledOnce();
    expect(onCreateAt).toHaveBeenCalledWith(new Date(2026, 7, 8));
  });

  it("maps a double click on the Saturday grid column to that local date", async () => {
    const onCreateAt = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
      />,
    );

    const row = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".grid-row");
      expect(element).not.toBeNull();
      return element!;
    });
    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 0, left: 100, right: 800, top: 0, bottom: 300, width: 700, height: 300, toJSON: () => ({}),
    });

    fireEvent.doubleClick(row, { clientX: 650 });

    expect(onCreateAt).toHaveBeenCalledOnce();
    expect(onCreateAt).toHaveBeenCalledWith(new Date(2026, 7, 8));
  });

  it("opens an existing bar once on double click without creating a plan", async () => {
    const onCreateAt = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={onSelect}
        onCreateAt={onCreateAt}
      />,
    );

    const bar = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });

    fireEvent.click(bar);
    fireEvent.click(bar);
    fireEvent.doubleClick(bar);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(plan);
    expect(onCreateAt).not.toHaveBeenCalled();
  });

  it("does not create from date headers, bar handles, or the popup", async () => {
    const onCreateAt = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
      />,
    );

    const { header, lowerText, upperText, handles, popup } = await waitFor(() => {
      const header = container.querySelector<SVGGElement>(".grid-header");
      const lowerText = container.querySelector<SVGTextElement>(".lower-text");
      const upperText = container.querySelector<SVGTextElement>(".upper-text");
      const handles = [...container.querySelectorAll<SVGRectElement>(".handle")];
      const popup = container.querySelector<HTMLElement>(".popup-wrapper");
      expect(header).not.toBeNull();
      expect(lowerText).not.toBeNull();
      expect(upperText).not.toBeNull();
      expect(handles).toHaveLength(2);
      expect(popup).not.toBeNull();
      return { header: header!, lowerText: lowerText!, upperText: upperText!, handles, popup: popup! };
    });

    for (const target of [header, lowerText, upperText, ...handles, popup]) {
      fireEvent.doubleClick(target);
    }

    expect(onCreateAt).not.toHaveBeenCalled();
  });

  it("does not create while moving or resizing a bar", async () => {
    const onCreateAt = vi.fn();
    const onScheduleChange = vi.fn();
    const { container } = render(
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

    const bar = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });
    const wrapper = bar.closest<SVGGElement>(".bar-wrapper")!;
    const centerX = Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2;

    fireEvent(wrapper, mouseEventWithOffset("mousedown", centerX, 1_000));
    fireEvent(document, mouseEventWithOffset("mousemove", centerX + 100, 1_100));
    fireEvent(document, mouseEventWithOffset("mouseup", centerX + 100, 1_100));
    fireEvent.doubleClick(bar);

    const rightHandle = container.querySelector<SVGRectElement>(".handle.right")!;
    const handleX = Number(rightHandle.getAttribute("x"));
    fireEvent(rightHandle, mouseEventWithOffset("mousedown", handleX, 1_000));
    fireEvent(document, mouseEventWithOffset("mousemove", handleX + 100, 1_100));
    fireEvent(document, mouseEventWithOffset("mouseup", handleX + 100, 1_100));
    fireEvent.doubleClick(rightHandle);

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledTimes(2));
    expect(onCreateAt).not.toHaveBeenCalled();
  });

  it("keeps an interactive virtual date grid in an empty weekly range", async () => {
    const onCreateAt = vi.fn();
    const rangeStart = new Date(2026, 7, 3);
    const { container } = render(
      <GanttTimeline
        plans={[]}
        view="week"
        rangeStart={rangeStart}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
        onCreateAt={onCreateAt}
      />,
    );

    const row = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".grid-row");
      expect(element).not.toBeNull();
      expect(container.querySelector(".timeline-empty")).not.toBeNull();
      expect(container.querySelectorAll(".bar-wrapper")).toHaveLength(0);
      return element!;
    });
    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 0, left: 100, right: 800, top: 0, bottom: 300, width: 700, height: 300, toJSON: () => ({}),
    });

    fireEvent.doubleClick(row, { clientX: 501 });
    expect(onCreateAt).toHaveBeenCalledWith(new Date(2026, 7, 7));
  });

  it("shows the new-plan affordance only for the hovered grid cell", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[]}
        view="month"
        rangeStart={new Date(2026, 1, 1)}
        rangeEnd={new Date(2026, 2, 1)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const { row, bar } = await waitFor(() => {
      const row = container.querySelector<SVGRectElement>(".grid-row");
      const bar = container.querySelector<SVGGElement>(".bar-wrapper");
      expect(row).not.toBeNull();
      expect(bar).toBeNull();
      return { row: row!, bar };
    });
    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, right: 896, top: 0, bottom: 300, width: 896, height: 300, toJSON: () => ({}),
    });
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 89, left: 0, right: 896, top: 89, bottom: 147, width: 896, height: 58, toJSON: () => ({}),
    });

    const cell = container.querySelector<HTMLElement>(".timeline-create-hover-cell")!;
    expect(cell.classList.contains("visible")).toBe(false);
    fireEvent.pointerEnter(row, { clientX: 33 });
    expect(cell.classList.contains("visible")).toBe(true);
    expect(container.querySelector(".timeline-create-hover-hint")?.textContent).toBe("双击新建工作计划");
    fireEvent.pointerLeave(row);
    expect(cell.classList.contains("visible")).toBe(false);
  });

  it("does not show the new-plan affordance over the date header", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const header = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".grid-header");
      expect(element).not.toBeNull();
      return element!;
    });
    const cell = container.querySelector<HTMLElement>(".timeline-create-hover-cell")!;
    fireEvent.pointerEnter(header, { clientX: 100 });
    expect(cell.classList.contains("visible")).toBe(false);
  });

  it("clears the new-plan affordance before entering an existing Gantt bar", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const row = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".grid-row");
      expect(element).not.toBeNull();
      expect(container.querySelector(".bar-wrapper")).not.toBeNull();
      return element!;
    });
    const bar = container.querySelector<SVGGElement>(".bar-wrapper")!;
    const cell = container.querySelector<HTMLElement>(".timeline-create-hover-cell")!;
    fireEvent.pointerEnter(row, { clientX: 501 });
    expect(cell.classList.contains("visible")).toBe(true);
    fireEvent.pointerLeave(row);
    fireEvent.pointerEnter(bar, { clientX: 501 });
    expect(cell.classList.contains("visible")).toBe(false);
  });

  it("does not render today's marker outside the visible weekly range", () => {
    const gantt = {
      gantt_end: new Date(2026, 7, 9),
      highlight_current: vi.fn(),
    };

    ensureCurrentDateMarker(
      gantt,
      document.createElement("div"),
      new Date(2026, 7, 3),
      new Date(2026, 7, 9),
      new Date(2026, 7, 10, 8),
    );

    expect(gantt.highlight_current).not.toHaveBeenCalled();
  });

  it("caps the today marker at the trimmed row bottom so the gantt scroll extent matches the plan list", async () => {
    // frappe 的 grid-background 高度公式（表头 + padding + 行高×行数 − 10）比实际行底
    // 多出 padding−10 = 22px；.current-highlight 按该内部值定高且直接挂在滚动容器上，
    // 会把甘特侧最大滚动量撑得比左侧列表长。到底后继续滚动时 scroll 同步会把甘特
    // 拽回列表的钳制位置，滚轮每个刻度抖动一次。标记底边必须钳在裁剪后的行底。
    const today = new Date();
    const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
    const rangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
    const dayIso = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10).toISOString();
    const plans = [0, 1, 2].map((index) => ({
      ...plan,
      id: `today-marker-plan-${index}`,
      startAt: dayIso(rangeStart),
      endAt: dayIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2)),
    }));
    const { container } = render(
      <GanttTimeline
        plans={plans}
        view="week"
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const svg = await waitFor(() => {
      const element = container.querySelector<SVGSVGElement>("svg.gantt");
      expect(element?.getAttribute("height")).toBeTruthy();
      return element!;
    });
    const marker = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".current-highlight");
      expect(element).not.toBeNull();
      return element!;
    });
    const svgHeight = Number(svg.getAttribute("height"));
    const markerBottom = Number.parseFloat(marker.style.top) + Number.parseFloat(marker.style.height);
    expect(markerBottom).toBeLessThanOrEqual(svgHeight);
  });

  it("centers each date number inside its matching day column", async () => {
    const midnightPlan = {
      ...plan,
      startAt: "2026-08-09T16:00:00.000Z",
      endAt: "2026-08-12T16:00:00.000Z",
    };
    const { container } = render(
      <GanttTimeline
        plans={[midnightPlan]}
        view="week"
        rangeStart={new Date(2026, 7, 10)}
        rangeEnd={new Date(2026, 7, 17)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const { bar, dateMarker } = await waitFor(() => {
      const bar = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      const dateMarker = [...container.querySelectorAll<SVGTextElement>(".lower-text")]
        .find((element) => element.textContent === "10");
      expect(bar).not.toBeNull();
      expect(dateMarker).toBeDefined();
      return { bar: bar!, dateMarker: dateMarker! };
    });

    expect(Number(bar.getAttribute("x"))).toBeCloseTo(Number.parseFloat(dateMarker.style.left));
    const markerStyle = getComputedStyle(dateMarker);
    expect(markerStyle.width).toBe("100px");
    expect(markerStyle.textAlign).toBe("center");
    expect(markerStyle.marginLeft).toBe("0px");
    expect(markerStyle.marginRight).toBe("0px");
    expect(Number.parseFloat(dateMarker.style.left) + Number.parseFloat(markerStyle.width) / 2)
      .toBeCloseTo(Number(bar.getAttribute("x")) + Number.parseFloat(markerStyle.width) / 2);
  });

  it("renders an intraday plan as one complete calendar day", async () => {
    const intradayPlan = {
      ...plan,
      startAt: "2026-08-04T00:30:00.000Z",
      endAt: "2026-08-04T10:00:00.000Z",
    };
    const rangeStart = new Date(2026, 7, 3);
    const { container } = render(
      <GanttTimeline
        plans={[intradayPlan]}
        view="week"
        rangeStart={rangeStart}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const bar = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });

    expect(Number(bar.getAttribute("x"))).toBeCloseTo(100);
    expect(Number(bar.getAttribute("width"))).toBeCloseTo(100);
  });

  it("includes every complete day through the plan end date", async () => {
    const multiDayPlan = {
      ...plan,
      startAt: "2026-08-04T00:30:00.000Z",
      endAt: "2026-08-06T10:00:00.000Z",
    };
    const { container } = render(
      <GanttTimeline
        plans={[multiDayPlan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const bar = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });

    expect(Number(bar.getAttribute("x"))).toBeCloseTo(100);
    expect(Number(bar.getAttribute("width"))).toBeCloseTo(300);
  });

  it("keeps a short bar label centered inside the bar", async () => {
    const labeledPlan = { ...plan, customFields: { owner: "冯铭倩" } };
    const { container } = render(
      <GanttTimeline
        plans={[labeledPlan]}
        displayProperties={[{
          id: "custom:owner",
          label: "工作负责人",
          field: {
            id: "f9a9dc48-e819-4b1b-89a3-ee680649e842",
            key: "owner",
            label: "工作负责人",
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
          },
        }]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const { bar, label } = await waitFor(() => {
      const bar = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      const label = container.querySelector<SVGTextElement>(".bar-wrapper .bar-label");
      expect(bar).not.toBeNull();
      expect(label).not.toBeNull();
      return { bar: bar!, label: label! };
    });
    const expectedX = Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2;

    expect(label.textContent).toBe("冯铭倩");
    expect(Number(label.getAttribute("x"))).toBeCloseTo(expectedX);
    expect(label.getAttribute("text-anchor")).toBe("middle");
    expect(label.classList.contains("big")).toBe(false);
  });

  it("renders the work content bar label truncated to 20 characters", async () => {
    const titledPlan = { ...plan, title: "试".repeat(21) };
    const { container } = render(
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

    const label = await waitFor(() => {
      const element = container.querySelector<SVGTextElement>(".bar-wrapper .bar-label");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(label.textContent).toBe(`${"试".repeat(20)}…`);
  });

  it("keeps resize hit areas out of the bar wrapper geometry", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const handles = await waitFor(() => {
      const elements = [...container.querySelectorAll<SVGRectElement>(".handle.left, .handle.right")];
      expect(elements).toHaveLength(2);
      return elements;
    });

    const bar = handles[0]!.closest(".bar-wrapper")!.querySelector<SVGRectElement>(".bar")!;
    const barX = Number(bar.getAttribute("x"));
    const barWidth = Number(bar.getAttribute("width"));

    for (const handle of handles) {
      expect(handle.getAttribute("width")).toBe("3");
      expect(handle.getAttribute("height")).toBe("26");
      expect(handle.hasAttribute("transform")).toBe(false);
      expect(handle.style.pointerEvents).toBe("all");
    }
    expect(Number(handles.find((handle) => handle.classList.contains("left"))!.getAttribute("x"))).toBeCloseTo(barX - 1.5);
    expect(Number(handles.find((handle) => handle.classList.contains("right"))!.getAttribute("x"))).toBeCloseTo(barX + barWidth - 1.5);
  });

  it("keeps moving a bar outside the SVG without changing either time of day", async () => {
    const onScheduleChange = vi.fn();
    const precisePlan = {
      ...plan,
      startAt: "2026-08-05T02:17:23.456Z",
      endAt: "2026-08-05T04:49:57.890Z",
    };
    const { container } = render(
      <GanttTimeline
        plans={[precisePlan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    const bar = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });
    const wrapper = bar.closest<SVGGElement>(".bar-wrapper")!;
    const centerX = Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2;

    fireEvent(wrapper, mouseEventWithOffset("mousedown", centerX, 1_000));
    fireEvent(document, mouseEventWithOffset("mousemove", centerX + 100, 1_100));
    fireEvent(document, mouseEventWithOffset("mouseup", centerX + 100, 1_100));

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange).toHaveBeenCalledWith(
      precisePlan,
      shiftIsoByLocalDays(precisePlan.startAt, 1),
      shiftIsoByLocalDays(precisePlan.endAt, 1),
    );
  });

  it("keeps the existing SVG while using the latest refreshed plan and schedule callback", async () => {
    const firstScheduleChange = vi.fn();
    const latestScheduleChange = vi.fn();
    const rangeStart = new Date(2026, 7, 3);
    const rangeEnd = new Date(2026, 7, 10);
    const view = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onScheduleChange={firstScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    const bar = await waitFor(() => {
      const element = view.container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });
    const originalSvg = view.container.querySelector("svg.gantt");
    const refreshedPlan = { ...plan, version: plan.version + 1, updatedAt: "2026-08-10T00:00:00.000Z" };

    view.rerender(
      <GanttTimeline
        plans={[refreshedPlan]}
        view="week"
        rangeStart={new Date(rangeStart)}
        rangeEnd={new Date(rangeEnd)}
        onScheduleChange={latestScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    expect(view.container.querySelector("svg.gantt")).toBe(originalSvg);
    const wrapper = bar.closest<SVGGElement>(".bar-wrapper")!;
    const centerX = Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2;
    fireEvent(wrapper, mouseEventWithOffset("mousedown", centerX, 1_000));
    fireEvent(document, mouseEventWithOffset("mousemove", centerX + 100, 1_100));
    fireEvent(document, mouseEventWithOffset("mouseup", centerX + 100, 1_100));

    await waitFor(() => expect(latestScheduleChange).toHaveBeenCalledOnce());
    expect(firstScheduleChange).not.toHaveBeenCalled();
    expect(latestScheduleChange.mock.calls[0]?.[0]).toBe(refreshedPlan);
  });

  it("rerenders a resized midnight end at the selected date boundary", async () => {
    const onScheduleChange = vi.fn();
    const midnightPlan = {
      ...plan,
      startAt: "2026-08-09T16:00:00.000Z",
      endAt: "2026-08-11T16:00:00.000Z",
    };
    const props = {
      view: "week" as const,
      rangeStart: new Date(2026, 7, 10),
      rangeEnd: new Date(2026, 7, 17),
      onScheduleChange,
      onSelect: vi.fn(),
    };
    const { container, rerender } = render(<GanttTimeline plans={[midnightPlan]} {...props} />);

    const rightHandle = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".handle.right");
      expect(element).not.toBeNull();
      return element!;
    });
    const startX = Number(rightHandle.getAttribute("x"));
    fireEvent(rightHandle, mouseEventWithOffset("mousedown", startX));
    fireEvent(document, mouseEventWithOffset("mousemove", startX - 100));
    fireEvent(document, mouseEventWithOffset("mouseup", startX - 100));

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    const resizedEndAt = onScheduleChange.mock.calls[0]?.[2];
    expect(resizedEndAt).toBe("2026-08-10T16:00:00.000Z");

    rerender(<GanttTimeline plans={[{ ...midnightPlan, endAt: resizedEndAt! }]} {...props} />);
    const { bar, endMarker } = await waitFor(() => {
      const bar = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      const endMarker = [...container.querySelectorAll<HTMLElement>(".lower-text")]
        .find((element) => element.textContent === "11");
      expect(bar).not.toBeNull();
      expect(endMarker).toBeDefined();
      return { bar: bar!, endMarker: endMarker! };
    });

    expect(Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")))
      .toBeCloseTo(Number.parseFloat(endMarker.style.left));
  });

  it("resizes from the logical edge hit area without expanding SVG geometry", async () => {
    const onScheduleChange = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    const bar = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".bar-wrapper .bar");
      expect(element).not.toBeNull();
      return element!;
    });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 100, left: 100, right: 200, top: 100, bottom: 126, width: 100, height: 26, toJSON: () => ({}),
    });

    fireEvent.mouseDown(bar, { button: 0, clientX: 104 });
    fireEvent.mouseMove(document, { clientX: 4 });
    fireEvent.mouseUp(document, { clientX: 4 });

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange.mock.calls[0]?.[1]).not.toBe(plan.startAt);
    expect(onScheduleChange.mock.calls[0]?.[2]).toBe(plan.endAt);
  });

  it("resizes an end date with the real Gantt mouse event flow", async () => {
    const onScheduleChange = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    const rightHandle = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".handle.right");
      expect(element).not.toBeNull();
      return element!;
    });
    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    const bar = rightHandle.closest(".bar-wrapper")!.querySelector<SVGRectElement>(".bar")!;
    const startX = Number(rightHandle.getAttribute("x"));
    const initialWidth = Number(bar.getAttribute("width"));

    fireEvent(rightHandle, mouseEventWithOffset("mousedown", startX));
    fireEvent(svg, mouseEventWithOffset("mousemove", startX + 100));
    expect(Number(bar.getAttribute("width"))).toBeGreaterThan(initialWidth + 90);
    expect(onScheduleChange).not.toHaveBeenCalled();
    fireEvent(svg, mouseEventWithOffset("mouseup", startX + 100));

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange.mock.calls[0]?.[1]).toBe(plan.startAt);
    expect(onScheduleChange.mock.calls[0]?.[2]).toBe(shiftIsoByLocalDays(plan.endAt, 1));
  });

  it("resizes a start date without changing the existing end time", async () => {
    const onScheduleChange = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    const leftHandle = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".handle.left");
      expect(element).not.toBeNull();
      return element!;
    });
    const svg = container.querySelector<SVGSVGElement>("svg.gantt")!;
    const startX = Number(leftHandle.getAttribute("x"));

    fireEvent(leftHandle, mouseEventWithOffset("mousedown", startX));
    fireEvent(svg, mouseEventWithOffset("mousemove", startX - 100));
    fireEvent(svg, mouseEventWithOffset("mouseup", startX - 100));

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange.mock.calls[0]?.[1]).toBe(shiftIsoByLocalDays(plan.startAt, -1));
    expect(onScheduleChange.mock.calls[0]?.[2]).toBe(plan.endAt);
  });

  it("uses viewport mouse distance when Safari reports unchanged SVG offsets", async () => {
    const onScheduleChange = vi.fn();
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={onScheduleChange}
        onSelect={vi.fn()}
      />,
    );

    const rightHandle = await waitFor(() => {
      const element = container.querySelector<SVGRectElement>(".handle.right");
      expect(element).not.toBeNull();
      return element!;
    });
    const bar = rightHandle.closest(".bar-wrapper")!.querySelector<SVGRectElement>(".bar")!;
    const initialWidth = Number(bar.getAttribute("width"));

    fireEvent(rightHandle, mouseEventWithOffset("mousedown", 500, 1_000));
    fireEvent(document, mouseEventWithOffset("mousemove", 500, 1_100));
    expect(Number(bar.getAttribute("width"))).toBeGreaterThan(initialWidth + 90);
    fireEvent(document, mouseEventWithOffset("mouseup", 500, 1_100));

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange.mock.calls[0]?.[1]).toBe(plan.startAt);
    expect(onScheduleChange.mock.calls[0]?.[2]).toBe(shiftIsoByLocalDays(plan.endAt, 1));
  });

  it("ends the grid at the final work plan row without expanding the scroll viewport", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const ganttContainer = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".gantt-container");
      expect(element).not.toBeNull();
      return element!;
    });
    const firstRow = ganttContainer.querySelector<SVGRectElement>(".grid-row");
    expect(firstRow).not.toBeNull();
    const expectedBottom = Number(firstRow!.getAttribute("y")) + Number(firstRow!.getAttribute("height"));

    expect(ganttContainer.style.height).toBe("100%");
    expect(Number(ganttContainer.querySelector("svg.gantt")?.getAttribute("height"))).toBe(expectedBottom);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  it("keeps the work plan titles aligned with vertical Gantt scrolling", async () => {
    const planRows = document.createElement("div");
    const planRowsRef: RefObject<HTMLElement | null> = { current: planRows };
    const ScrollSyncedGantt = GanttTimeline as ComponentType<ComponentProps<typeof GanttTimeline> & {
      verticalScrollPeerRef: RefObject<HTMLElement | null>;
    }>;
    const { container } = render(
      <ScrollSyncedGantt
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        verticalScrollPeerRef={planRowsRef}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const ganttContainer = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".gantt-container");
      expect(element).not.toBeNull();
      return element!;
    });

    ganttContainer.scrollTop = 116;
    fireEvent.scroll(ganttContainer);
    expect(planRows.scrollTop).toBe(116);

    planRows.scrollTop = 58;
    fireEvent.scroll(planRows);
    expect(ganttContainer.scrollTop).toBe(58);

    let clampedGanttScrollTop = ganttContainer.scrollTop;
    Object.defineProperty(ganttContainer, "scrollTop", {
      configurable: true,
      get: () => clampedGanttScrollTop,
      set: (value: number) => { clampedGanttScrollTop = Math.min(value, 90); },
    });
    planRows.scrollTop = 116;
    fireEvent.scroll(planRows);
    expect(ganttContainer.scrollTop).toBe(90);
    expect(planRows.scrollTop).toBe(90);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  it("stops syncing vertical scroll while the task list is collapsed", async () => {
    const planRows = document.createElement("div");
    const planRowsRef: RefObject<HTMLElement | null> = { current: planRows };
    const CollapsedGantt = GanttTimeline as ComponentType<ComponentProps<typeof GanttTimeline> & {
      verticalScrollPeerRef: RefObject<HTMLElement | null>;
      taskListCollapsed: boolean;
    }>;
    const { container } = render(
      <CollapsedGantt
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        verticalScrollPeerRef={planRowsRef}
        taskListCollapsed
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const ganttContainer = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".gantt-container");
      expect(element).not.toBeNull();
      return element!;
    });

    ganttContainer.scrollTop = 116;
    fireEvent.scroll(ganttContainer);
    expect(planRows.scrollTop).toBe(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  it("highlights the matching work plan row while hovering a Gantt row or bar", async () => {
    const planRows = document.createElement("div");
    const planRow = document.createElement("div");
    planRow.className = "plan-row";
    planRow.dataset.planId = plan.id;
    planRows.append(planRow);
    const planRowsRef: RefObject<HTMLElement | null> = { current: planRows };
    const HoverSyncedGantt = GanttTimeline as ComponentType<ComponentProps<typeof GanttTimeline> & {
      verticalScrollPeerRef: RefObject<HTMLElement | null>;
    }>;
    const { container } = render(
      <HoverSyncedGantt
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        verticalScrollPeerRef={planRowsRef}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const { ganttRow, barWrapper } = await waitFor(() => {
      const ganttRow = container.querySelector<SVGRectElement>(".grid-row");
      const barWrapper = container.querySelector<SVGGElement>(".bar-wrapper");
      expect(ganttRow).not.toBeNull();
      expect(barWrapper).not.toBeNull();
      return { ganttRow: ganttRow!, barWrapper: barWrapper! };
    });

    fireEvent.pointerEnter(ganttRow);
    expect(planRow.classList.contains("gantt-row-hovered")).toBe(true);
    fireEvent.pointerLeave(ganttRow);
    expect(planRow.classList.contains("gantt-row-hovered")).toBe(false);
    fireEvent.pointerEnter(barWrapper);
    expect(planRow.classList.contains("gantt-row-hovered")).toBe(true);
    fireEvent.pointerLeave(barWrapper);
    expect(planRow.classList.contains("gantt-row-hovered")).toBe(false);
  });

  it("moves the hover popup with the pointer over a Gantt bar", async () => {
    const { container } = render(
      <GanttTimeline
        plans={[plan]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const { barWrapper, popup } = await waitFor(() => {
      const barWrapper = container.querySelector<SVGGElement>(".bar-wrapper");
      const popup = container.querySelector<HTMLElement>(".popup-wrapper");
      expect(barWrapper).not.toBeNull();
      expect(popup).not.toBeNull();
      return { barWrapper: barWrapper!, popup: popup! };
    });

    fireEvent.mouseMove(barWrapper, { clientX: 140, clientY: 90 });
    expect(popup.style.left).toBe("152px");
    expect(popup.style.top).toBe("102px");

    fireEvent.mouseMove(barWrapper, { clientX: 180, clientY: 120 });
    expect(popup.style.left).toBe("192px");
    expect(popup.style.top).toBe("132px");
  });

  it("shows the Chinese tooltip content on hover and keeps following the pointer", async () => {
    const hoverPlan = {
      ...plan,
      status: "in_progress" as const,
      startAt: localIso(2026, 8, 5),
      endAt: localIso(2026, 8, 5),
      customFields: { owner: "冯铭倩" },
    };
    const { container } = render(
      <GanttTimeline
        plans={[hoverPlan]}
        tooltipProperties={[
          { id: "status", label: "状态" },
          {
            id: "custom:owner",
            label: "负责人",
            field: {
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
            },
          },
        ]}
        view="week"
        rangeStart={new Date(2026, 7, 3)}
        rangeEnd={new Date(2026, 7, 10)}
        onScheduleChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const barWrapper = await waitFor(() => {
      const element = container.querySelector<SVGGElement>(".bar-wrapper");
      expect(element).not.toBeNull();
      return element!;
    });

    // Frappe Gantt reveals the hover popup after a 200ms mouseenter delay.
    fireEvent.mouseEnter(barWrapper);

    // Frappe Gantt lazily builds the Popup on the first hover, so wait for the
    // custom content to appear inside the wrapper instead of tracking its class.
    const popup = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".popup-wrapper");
      expect(element).not.toBeNull();
      expect(element!.innerHTML).toContain("设计评审");
      return element!;
    });

    expect(popup.innerHTML).toContain("设计评审");
    expect(popup.innerHTML).toContain("8月5日 - 8月5日");
    expect(popup.innerHTML).toContain("状态：进行中");
    expect(popup.innerHTML).toContain("负责人：冯铭倩");
    expect(popup.innerHTML).toContain("持续 1 天");
    expect(popup.textContent).not.toMatch(/[A-Za-z]/);

    // Replacing the popup content must not break configurePopupFollow.
    fireEvent.mouseMove(barWrapper, { clientX: 140, clientY: 90 });
    expect(popup.style.left).toBe("152px");
    expect(popup.style.top).toBe("102px");
  });

  it("centers the today line and ball under the current date block", () => {
    const mount = document.createElement("div");
    const header = document.createElement("div");
    const date = document.createElement("div");
    const line = document.createElement("div");
    const ball = document.createElement("div");
    date.className = "current-date-highlight";
    line.className = "current-highlight";
    ball.className = "current-ball-highlight";
    header.append(date, ball);
    mount.append(header, line);

    vi.spyOn(date, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 0, left: 100, right: 140, top: 0, bottom: 20, width: 40, height: 20, toJSON: () => ({}),
    });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      x: 30, y: 0, left: 30, right: 230, top: 0, bottom: 40, width: 200, height: 40, toJSON: () => ({}),
    });
    vi.spyOn(mount, "getBoundingClientRect").mockReturnValue({
      x: 20, y: 0, left: 20, right: 240, top: 0, bottom: 100, width: 220, height: 100, toJSON: () => ({}),
    });
    vi.spyOn(line, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, right: 1, top: 0, bottom: 80, width: 1, height: 80, toJSON: () => ({}),
    });
    vi.spyOn(ball, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, right: 6, top: 0, bottom: 6, width: 6, height: 6, toJSON: () => ({}),
    });
    Object.defineProperty(line, "offsetParent", { configurable: true, value: mount });
    Object.defineProperty(ball, "offsetParent", { configurable: true, value: header });

    alignCurrentDateMarker(mount);

    expect(line.style.left).toBe("99.5px");
    expect(ball.style.left).toBe("87px");
  });

  it("centers every date layer within the visible header content without accumulating drift", () => {
    const mount = document.createElement("div");
    const header = document.createElement("div");
    const firstDate = document.createElement("div");
    const secondDate = document.createElement("div");
    header.className = "grid-header";
    firstDate.className = "lower-text";
    secondDate.className = "lower-text current-date-highlight";
    header.append(firstDate, secondDate);
    mount.append(header);

    Object.defineProperty(header, "clientHeight", { configurable: true, value: 49 });
    Object.defineProperty(header, "clientTop", { configurable: true, value: 0 });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 100, left: 0, right: 700, top: 100, bottom: 150, width: 700, height: 50, toJSON: () => ({}),
    });
    for (const date of [firstDate, secondDate]) {
      vi.spyOn(date, "getBoundingClientRect").mockReturnValue({
        x: 0, y: 105, left: 0, right: 80, top: 105, bottom: 137, width: 80, height: 32, toJSON: () => ({}),
      });
      Object.defineProperty(date, "offsetParent", { configurable: true, value: header });
    }

    alignDateHeaderContentVertically(mount);
    const firstTop = Number.parseFloat(firstDate.style.top);
    const secondTop = Number.parseFloat(secondDate.style.top);
    const contentCenter = header.clientHeight / 2;
    expect(Math.abs(firstTop + 16 - contentCenter)).toBeLessThanOrEqual(1);
    expect(secondTop).toBe(firstTop);

    alignDateHeaderContentVertically(mount);
    expect(Number.parseFloat(firstDate.style.top)).toBe(firstTop);
    expect(Number.parseFloat(secondDate.style.top)).toBe(secondTop);
  });

  it("centers the task date range highlight with the date layers, including while hidden", () => {
    const mount = document.createElement("div");
    const header = document.createElement("div");
    const date = document.createElement("div");
    const range = document.createElement("div");
    header.className = "grid-header";
    date.className = "lower-text";
    range.className = "date-range-highlight hide";
    header.append(range, date);
    mount.append(header);

    Object.defineProperty(header, "clientHeight", { configurable: true, value: 49 });
    Object.defineProperty(header, "clientTop", { configurable: true, value: 0 });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 100, left: 0, right: 700, top: 100, bottom: 150, width: 700, height: 50, toJSON: () => ({}),
    });
    for (const el of [date, range]) {
      Object.defineProperty(el, "offsetParent", { configurable: true, value: header });
    }
    vi.spyOn(date, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 105, left: 0, right: 80, top: 105, bottom: 137, width: 80, height: 32, toJSON: () => ({}),
    });
    vi.spyOn(range, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
    });
    const computedSpy = vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element) => (
      el === range ? { height: "34px" } : { height: "" }
    ) as unknown as CSSStyleDeclaration) as typeof window.getComputedStyle);

    alignDateHeaderContentVertically(mount);
    expect(Number.parseFloat(date.style.top)).toBe(8.5);
    expect(Number.parseFloat(range.style.top)).toBe(7.5);
    expect(Math.abs(Number.parseFloat(range.style.top) + 17 - header.clientHeight / 2)).toBeLessThanOrEqual(1);

    alignDateHeaderContentVertically(mount);
    expect(Number.parseFloat(range.style.top)).toBe(7.5);
    expect(Number.parseFloat(date.style.top)).toBe(8.5);
    computedSpy.mockRestore();
  });

  it("safely skips missing or unmeasurable date header content", () => {
    expect(() => alignDateHeaderContentVertically(document.createElement("div"))).not.toThrow();

    const headerOnlyMount = document.createElement("div");
    const headerOnly = document.createElement("div");
    headerOnly.className = "grid-header";
    headerOnlyMount.append(headerOnly);
    Object.defineProperty(headerOnly, "clientHeight", { configurable: true, value: 49 });
    expect(() => alignDateHeaderContentVertically(headerOnlyMount)).not.toThrow();

    const mount = document.createElement("div");
    const header = document.createElement("div");
    const date = document.createElement("div");
    header.className = "grid-header";
    date.className = "lower-text";
    header.append(date);
    mount.append(header);
    Object.defineProperty(header, "clientHeight", { configurable: true, value: 0 });

    expect(() => alignDateHeaderContentVertically(mount)).not.toThrow();
    expect(date.style.top).toBe("");

    Object.defineProperty(header, "clientHeight", { configurable: true, value: 49 });
    vi.spyOn(date, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
    });
    expect(() => alignDateHeaderContentVertically(mount)).not.toThrow();
    expect(date.style.top).toBe("");
  });
});

describe("timeline reminder bells", () => {
  const rangeStart = new Date(2026, 7, 3);
  const rangeEnd = new Date(2026, 7, 10);

  function bellIn(container: HTMLElement, date: string) {
    return container.querySelector<HTMLButtonElement>(`.lower-text.date_${date} .timeline-reminder-bell`);
  }

  it("injects a bell under the date number for each reminder day", async () => {
    const reminderDays: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [{ type: "work-order", date: "2026-08-05", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: plan.startAt, endAt: plan.startAt, createdAt: plan.createdAt, risk: null }] }],
    }];
    const { container } = render(
      <GanttTimeline plans={[plan]} reminders={reminderDays} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    await waitFor(() => expect(bellIn(container, "2026-08-05")).not.toBeNull());
    expect(container.querySelectorAll(".timeline-reminder-bell")).toHaveLength(1);
    expect(bellIn(container, "2026-08-06")).toBeNull();
  });

  it("merges same-day reminders into one bell and shows both groups on hover", async () => {
    const reminderDays: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [
        { type: "work-order", date: "2026-08-05", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: plan.startAt, endAt: plan.startAt, createdAt: plan.createdAt, risk: null }] },
        { type: "plan-submission", date: "2026-08-05", originalDate: null, plans: [{ id: trailingPlanId, title: "下周计划", startAt: localIso(2026, 8, 13), endAt: localIso(2026, 8, 13), createdAt: plan.createdAt, risk: "高" }] },
      ],
    }];
    const { container } = render(
      <GanttTimeline plans={[plan]} reminders={reminderDays} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    const bell = await waitFor(() => {
      const element = bellIn(container, "2026-08-05");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(container.querySelectorAll(".timeline-reminder-bell")).toHaveLength(1);

    fireEvent.mouseEnter(bell);
    const tooltip = container.querySelector<HTMLElement>(".timeline-reminder-tooltip")!;
    expect(tooltip.classList.contains("visible")).toBe(true);
    expect(tooltip.textContent).toContain("起检修单提醒");
    expect(tooltip.textContent).toContain("下周有中风险作业，今天提交作业计划");
    expect(tooltip.textContent).toContain("下周计划");
    fireEvent.mouseLeave(bell);
    expect(tooltip.classList.contains("visible")).toBe(false);
  });

  it("shows the plan title and start date for a work-order reminder", async () => {
    const reminderDays: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [{ type: "work-order", date: "2026-08-05", originalDate: null, plans: [{ id: plan.id, title: "设计评审", startAt: localIso(2026, 8, 12), endAt: localIso(2026, 8, 12), createdAt: plan.createdAt, risk: null }] }],
    }];
    const { container } = render(
      <GanttTimeline plans={[plan]} reminders={reminderDays} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    const bell = await waitFor(() => {
      const element = bellIn(container, "2026-08-05");
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.mouseEnter(bell);
    const tooltip = container.querySelector<HTMLElement>(".timeline-reminder-tooltip")!;
    expect(tooltip.textContent).toContain("起检修单提醒");
    expect(tooltip.textContent).toContain("设计评审");
    expect(tooltip.textContent).toContain("8月12日");
  });

  it("lists every triggered plan for a plan-submission reminder", async () => {
    const reminderDays: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [{
        type: "plan-submission",
        date: "2026-08-05",
        originalDate: null,
        plans: [
          { id: plan.id, title: "设计评审", startAt: localIso(2026, 8, 12), endAt: localIso(2026, 8, 12), createdAt: plan.createdAt, risk: "高" },
          { id: trailingPlanId, title: "下周计划", startAt: localIso(2026, 8, 13), endAt: localIso(2026, 8, 13), createdAt: plan.createdAt, risk: "中" },
        ],
      }],
    }];
    const { container } = render(
      <GanttTimeline plans={[plan]} reminders={reminderDays} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );

    const bell = await waitFor(() => {
      const element = bellIn(container, "2026-08-05");
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.mouseEnter(bell);
    const tooltip = container.querySelector<HTMLElement>(".timeline-reminder-tooltip")!;
    expect(tooltip.textContent).toContain("下周有中风险作业，今天提交作业计划");
    expect(tooltip.textContent).toContain("设计评审");
    expect(tooltip.textContent).toContain("下周计划");
    expect(tooltip.textContent).toContain("8月12日");
    expect(tooltip.textContent).toContain("8月13日");
  });

  it("opens the drawer for a single-plan reminder and ignores multi-plan bells", async () => {
    const onSelect = vi.fn();
    const single: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [{ type: "work-order", date: "2026-08-05", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: plan.startAt, endAt: plan.startAt, createdAt: plan.createdAt, risk: null }] }],
    }];
    const { container, unmount } = render(
      <GanttTimeline plans={[plan]} reminders={single} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={onSelect} />,
    );

    const bell = await waitFor(() => {
      const element = bellIn(container, "2026-08-05");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(bell.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(bell);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(plan);
    unmount();

    const multi: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [{
        type: "plan-submission",
        date: "2026-08-05",
        originalDate: null,
        plans: [
          { id: plan.id, title: "设计评审", startAt: localIso(2026, 8, 12), endAt: localIso(2026, 8, 12), createdAt: plan.createdAt, risk: "高" },
          { id: trailingPlanId, title: "下周计划", startAt: localIso(2026, 8, 13), endAt: localIso(2026, 8, 13), createdAt: plan.createdAt, risk: "中" },
        ],
      }],
    }];
    const multiSelect = vi.fn();
    const secondView = render(
      <GanttTimeline plans={[plan]} reminders={multi} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={multiSelect} />,
    );
    const multiBell = await waitFor(() => {
      const element = bellIn(secondView.container, "2026-08-05");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(multiBell.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(multiBell);
    expect(multiSelect).not.toHaveBeenCalled();
  });

  it("replays bells after the range changes and skips reminder days outside the range", async () => {
    const firstDays: ReminderDay[] = [{
      date: "2026-08-05",
      reminders: [{ type: "work-order", date: "2026-08-05", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: plan.startAt, endAt: plan.startAt, createdAt: plan.createdAt, risk: null }] }],
    }];
    const { container, rerender } = render(
      <GanttTimeline plans={[plan]} reminders={firstDays} view="week" rangeStart={rangeStart} rangeEnd={rangeEnd} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(bellIn(container, "2026-08-05")).not.toBeNull());

    const secondDays: ReminderDay[] = [{
      date: "2026-08-12",
      reminders: [{ type: "work-order", date: "2026-08-12", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: localIso(2026, 8, 19), endAt: localIso(2026, 8, 19), createdAt: plan.createdAt, risk: null }] }],
    }];
    rerender(
      <GanttTimeline plans={[plan]} reminders={secondDays} view="week" rangeStart={new Date(2026, 7, 10)} rangeEnd={new Date(2026, 7, 17)} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(bellIn(container, "2026-08-12")).not.toBeNull());
    expect(bellIn(container, "2026-08-05")).toBeNull();

    rerender(
      <GanttTimeline plans={[plan]} reminders={[{ date: "2026-08-20", reminders: [{ type: "work-order", date: "2026-08-20", originalDate: null, plans: [{ id: plan.id, title: plan.title, startAt: plan.startAt, endAt: plan.startAt, createdAt: plan.createdAt, risk: null }] }] }]} view="week" rangeStart={new Date(2026, 7, 10)} rangeEnd={new Date(2026, 7, 17)} onScheduleChange={vi.fn()} onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(container.querySelectorAll(".timeline-reminder-bell")).toHaveLength(0));
  });
});
