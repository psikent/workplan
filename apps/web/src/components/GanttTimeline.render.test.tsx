// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { WorkPlan } from "@workplan/contracts";
import type { ComponentProps, ComponentType, RefObject } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GanttTimeline, { alignCurrentDateMarker, ensureCurrentDateMarker } from "./GanttTimeline";

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
  sortOrder: 0,
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: {},
  ownerAccount: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

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

describe("GanttTimeline rendered grid", () => {
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
            defaultValue: null,
            sortOrder: 0,
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
});
