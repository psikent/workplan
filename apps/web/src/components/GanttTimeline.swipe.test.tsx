// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { WorkPlan } from "@workplan/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GanttTimeline, { isSwipeStartTarget } from "./GanttTimeline";

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
  // frappe-gantt 通过 innerText 写入日期标签；jsdom 无该访问器，缺它会让标签文本为空、
  // 库内 scroll_current 按文本查找 upper-text 时拿到 undefined。
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent ?? ""; },
    set(value: string) { this.textContent = value; },
  });
});

afterAll(async () => {
  // frappe-gantt 会排入 requestAnimationFrame 回调，回调里读 getBBox；先等一帧落定再还原原型，
  // 否则还原后的回调会抛 "getBBox is not a function"（与 render 测试同一处理）。
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: originalScrollTo });
  else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  if (originalGetBBox) Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: originalGetBBox });
  else delete svgElementPrototype.getBBox;
  if (originalInnerText) Object.defineProperty(HTMLElement.prototype, "innerText", originalInnerText);
  else delete (HTMLElement.prototype as { innerText?: unknown }).innerText;
});

// 可见时间轴宽度 700 → 阈值 min(700×15%, 80) = 80 CSS px。
const TIMELINE_WIDTH = 700;
const THRESHOLD = 80;
beforeEach(() => vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(TIMELINE_WIDTH));
afterEach(() => vi.restoreAllMocks());

const plan: WorkPlan = {
  id: "b70cff45-b93c-4dff-ab87-e15ef3d2494f",
  title: "设计评审",
  description: "",
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

function pointer(type: string, init: { pointerId?: number; pointerType?: string; clientX?: number; clientY?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "touch",
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  return event;
}

async function renderGantt(onRangeNavigate: (direction: "previous" | "next") => void, overrides: Record<string, unknown> = {}) {
  const view = render(
    <GanttTimeline
      plans={[plan]}
      view="week"
      rangeStart={new Date(2026, 7, 3)}
      rangeEnd={new Date(2026, 7, 10)}
      onScheduleChange={vi.fn()}
      onSelect={vi.fn()}
      onRangeNavigate={onRangeNavigate}
      {...overrides}
    />,
  );
  await waitFor(() => expect(view.container.querySelector(".grid-row")).not.toBeNull());
  return view;
}

describe("timeline swipe wiring", () => {
  it("commits a single range navigation when a touch swipe on the grid passes the threshold", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).toHaveBeenCalledTimes(1);
    expect(onRangeNavigate).toHaveBeenCalledWith("previous");
  });

  it("maps a leftward swipe to the next range", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 500, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 500 - THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 500 - THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).toHaveBeenCalledWith("next");
  });

  it("shows and clears the edge direction feedback around a committed swipe", async () => {
    const { container } = await renderGantt(vi.fn());
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));

    // 原生事件驱动的状态更新不在 React act 内，用 waitFor 等待反馈挂载。
    const hint = await waitFor(() => {
      const element = container.querySelector(".timeline-swipe-hint");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(hint.classList.contains("edge-left")).toBe(true);
    expect(hint.textContent).toContain("上一周");

    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));
    await waitFor(() => expect(container.querySelector(".timeline-swipe-hint")).toBeNull());
  });

  it("does not navigate when the action is released below the threshold", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    // 松手前反向拉回阈值以内 → 取消。
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + 10, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + 10, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("leaves vertical and non-touch input to native behavior", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;

    // 明显纵向动作
    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 410, clientY: 380 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 410, clientY: 380 }));
    // 鼠标横向拖动
    row.dispatchEvent(pointer("pointerdown", { pointerType: "mouse", clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { pointerType: "mouse", clientX: 400 - THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { pointerType: "mouse", clientX: 400 - THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("cancels the gesture on pointercancel without navigating", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointercancel", { clientX: 400 + THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("suspends recognition while a drawer or overlay is open", async () => {
    const onRangeNavigate = vi.fn();
    const first = await renderGantt(onRangeNavigate);
    first.unmount();

    const { container } = await renderGantt(onRangeNavigate, { swipeSuspended: true });
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("can still start a swipe while the target range is loading", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate, { plans: [], rangeLoading: true });
    // 加载覆盖层存在时不显示空态文案。
    expect(container.querySelector(".timeline-range-loading")).not.toBeNull();
    expect(container.querySelector(".timeline-empty")).toBeNull();

    // 加载期起手于日期表头空白（始终存在）：加载覆盖层不得阻断手势。
    const header = container.querySelector(".grid-header")!;
    header.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    header.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    header.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).toHaveBeenCalledWith("previous");
  });

  it("suppresses the compatibility click produced by a committed swipe", async () => {
    const onCreateAt = vi.fn();
    const { container } = await renderGantt(vi.fn(), { onCreateAt });
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    // 成立手势后浏览器派发的兼容 click 必须被拦截：否则与同位置轻点合成 dblclick 会打开新建。
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    row.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("still suppresses compatibility clicks when a locked candidate is reversed below the threshold", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    // 反向拉回阈值以内：不提交导航，但候选已成立，兼容点击仍须抑制（spec R4）。
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + 4, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + 4, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    row.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("does not swallow real clicks outside the timeline, nor after the window expires", async () => {
    const { container } = await renderGantt(vi.fn());
    const row = container.querySelector(".grid-row")!;
    const outside = document.createElement("button");
    document.body.append(outside);

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    // 时间轴之外的点击（工具栏等）不受抑制。
    const outsideClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    outside.dispatchEvent(outsideClick);
    expect(outsideClick.defaultPrevented).toBe(false);

    // 窗口到期后时间轴内的点击也不再被抑制。
    await new Promise((resolve) => setTimeout(resolve, 400));
    const lateClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    row.dispatchEvent(lateClick);
    expect(lateClick.defaultPrevented).toBe(false);
    outside.remove();
  });

  it("cancels a tracked gesture when a second touch lands on an interactive target", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;
    const bar = container.querySelector(".bar-wrapper")!;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    // 第二根手指落在甘特条上：整次手势必须取消（spec D16），第一根手指抬手不导航。
    bar.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 500, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("ignores gestures that do not start on a valid timeline surface", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const bar = container.querySelector(".bar-wrapper")!;

    // 起手落在甘特条上（起手目标无效）→ 不接管。
    bar.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    bar.dispatchEvent(pointer("pointermove", { clientX: 400 + THRESHOLD, clientY: 300 }));
    bar.dispatchEvent(pointer("pointerup", { clientX: 400 + THRESHOLD, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("pans the canvas in range instead of navigating when the gesture starts inside", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;
    const ganttContainer = container.querySelector<HTMLElement>(".gantt-container")!;
    // 范围内有横向余量：起手位置因此既非左边界也非右边界。
    Object.defineProperty(ganttContainer, "scrollWidth", { configurable: true, value: TIMELINE_WIDTH * 2 });
    Object.defineProperty(ganttContainer, "clientWidth", { configurable: true, value: TIMELINE_WIDTH });
    ganttContainer.scrollLeft = 200;

    row.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 300 }));
    row.dispatchEvent(pointer("pointermove", { clientX: 400 - 120, clientY: 300 }));

    // 画布按手指位移平移，且不产生范围导航。
    expect(ganttContainer.scrollLeft).toBe(320);
    expect(onRangeNavigate).not.toHaveBeenCalled();
    row.dispatchEvent(pointer("pointerup", { clientX: 400 - 120, clientY: 300 }));
    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("turns the page when an in-range drag keeps going past the edge", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;
    const ganttContainer = container.querySelector<HTMLElement>(".gantt-container")!;
    Object.defineProperty(ganttContainer, "scrollWidth", { configurable: true, value: TIMELINE_WIDTH * 2 });
    Object.defineProperty(ganttContainer, "clientWidth", { configurable: true, value: TIMELINE_WIDTH });
    // 起手在范围内（右侧 100px 余量），随后一路左滑越过右边界。
    ganttContainer.scrollLeft = TIMELINE_WIDTH - 100;

    row.dispatchEvent(pointer("pointerdown", { clientX: 800, clientY: 300 }));
    // 前 100px 只滚动到右边界，仍是范围内浏览。
    row.dispatchEvent(pointer("pointermove", { clientX: 700, clientY: 300 }));
    expect(onRangeNavigate).not.toHaveBeenCalled();
    expect(ganttContainer.scrollLeft).toBe(TIMELINE_WIDTH);
    // 继续左滑、越界超过阈值 → 同一次手势接力翻到下一月。
    row.dispatchEvent(pointer("pointermove", { clientX: 800 - 200, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 800 - 200, clientY: 300 }));
    expect(onRangeNavigate).toHaveBeenCalledWith("next");
  });

  it("does not turn the page from a brief overshoot below the threshold", async () => {
    const onRangeNavigate = vi.fn();
    const { container } = await renderGantt(onRangeNavigate);
    const row = container.querySelector(".grid-row")!;
    const ganttContainer = container.querySelector<HTMLElement>(".gantt-container")!;
    Object.defineProperty(ganttContainer, "scrollWidth", { configurable: true, value: TIMELINE_WIDTH * 2 });
    Object.defineProperty(ganttContainer, "clientWidth", { configurable: true, value: TIMELINE_WIDTH });
    ganttContainer.scrollLeft = TIMELINE_WIDTH - 100;

    row.dispatchEvent(pointer("pointerdown", { clientX: 800, clientY: 300 }));
    // 越界仅 20px（< 48px 阈值）：不足以翻页。
    row.dispatchEvent(pointer("pointermove", { clientX: 800 - 120, clientY: 300 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 800 - 120, clientY: 300 }));

    expect(onRangeNavigate).not.toHaveBeenCalled();
  });

  it("keeps a bar double-click working (no compat-click suppression without a committed swipe)", async () => {
    const onCreateAt = vi.fn();
    const { container } = await renderGantt(vi.fn(), { onCreateAt });
    const row = container.querySelector(".grid-row")!;
    const svg = container.querySelector("svg.gantt")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 0, left: 100, right: 900, top: 0, bottom: 300, width: 800, height: 300, toJSON: () => ({}),
    });

    fireEvent.doubleClick(row, { clientX: 501 });
    expect(onCreateAt).toHaveBeenCalledOnce();
  });
});

describe("isSwipeStartTarget", () => {
  it("accepts header gaps and grid background only", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="gantt-container">
        <svg class="gantt">
          <g class="grid-header"><text class="lower-text">01</text></g>
          <g class="grid-row"></g>
          <g class="bar-wrapper"><rect class="bar"></rect><g class="handle-group"><rect class="handle"></rect></g></g>
        </svg>
        <button class="timeline-reminder-bell"></button>
        <div class="popup-wrapper"></div>
      </div>`;
    const q = (selector: string) => root.querySelector(selector);

    expect(isSwipeStartTarget(q(".grid-header"))).toBe(true);
    expect(isSwipeStartTarget(q(".grid-row"))).toBe(true);
    expect(isSwipeStartTarget(q(".bar-wrapper"))).toBe(false);
    expect(isSwipeStartTarget(q(".bar"))).toBe(false);
    expect(isSwipeStartTarget(q(".handle"))).toBe(false);
    expect(isSwipeStartTarget(q(".timeline-reminder-bell"))).toBe(false);
    expect(isSwipeStartTarget(q(".popup-wrapper"))).toBe(false);
    expect(isSwipeStartTarget(null)).toBe(false);
  });
});
