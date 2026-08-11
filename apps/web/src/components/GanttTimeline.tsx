import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CustomFieldDefinition, WorkPlan } from "@workplan/contracts";
import { loadGantt } from "../lib/gantt";
import { formatCustomFieldValue, statusLabels } from "../lib/format";

export type GanttDisplayProperty =
  | { id: "status"; label: string; field?: undefined }
  | { id: `custom:${string}`; label: string; field: CustomFieldDefinition };

type Props = {
  plans: WorkPlan[];
  displayProperties?: GanttDisplayProperty[];
  view: "week" | "month";
  rangeStart: Date;
  rangeEnd: Date;
  verticalScrollPeerRef?: RefObject<HTMLElement | null>;
  onScheduleChange: (plan: WorkPlan, startAt: string, endAt: string) => void;
  onSelect: (plan: WorkPlan) => void;
};

type RangedGantt = {
  gantt_start: Date;
  gantt_end: Date;
  highlight_current?: () => void;
  setup_date_values: () => void;
  render: () => void;
};

const MIN_DAY_COLUMN_WIDTH = 32;
const EMPTY_DISPLAY_PROPERTIES: GanttDisplayProperty[] = [];

function GanttTimeline({ plans, displayProperties = EMPTY_DISPLAY_PROPERTIES, rangeStart, rangeEnd, verticalScrollPeerRef, onScheduleChange, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const plansByIdRef = useRef(plansById);
  const onScheduleChangeRef = useRef(onScheduleChange);
  const onSelectRef = useRef(onSelect);
  const rangeStartTime = rangeStart.getTime();
  const rangeEndTime = rangeEnd.getTime();
  const dayCount = calendarDaySpan(rangeStart, rangeEnd);
  const columnWidth = availableWidth > 0 ? Math.max(MIN_DAY_COLUMN_WIDTH, availableWidth / dayCount) : 0;
  const ganttInputSignature = useMemo(() => JSON.stringify(plans.map((plan) => [
    plan.id,
    plan.startAt,
    plan.endAt,
    plan.status,
    formatGanttLabel(plan, displayProperties),
  ])), [displayProperties, plans]);

  plansByIdRef.current = plansById;
  onScheduleChangeRef.current = onScheduleChange;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (width: number) => {
      const nextWidth = Math.floor(width);
      if (nextWidth > 0) setAvailableWidth((current) => current === nextWidth ? current : nextWidth);
    };

    updateWidth(container.clientWidth);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => updateWidth(entry?.contentRect.width ?? container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let currentMarkerFrame: number | null = null;
    let cleanupScheduleInteraction = () => {};
    let cleanupCenteredLabels = () => {};
    let cleanupVerticalScrollSync = () => {};
    let cleanupPlanRowHover = () => {};
    let cleanupPopupFollow = () => {};
    const container = containerRef.current;
    if (!container) return;
    if (plans.length === 0) {
      container.replaceChildren();
      return;
    }
    if (columnWidth <= 0) return;

    void loadGantt().then((Gantt) => {
      if (disposed || !containerRef.current) return;
      containerRef.current.replaceChildren();
      const tasks = plans.map((plan) => ({
        id: plan.id,
        name: formatGanttLabel(plan, displayProperties),
        start: startOfLocalDay(new Date(plan.startAt)),
        end: endOfLocalDay(new Date(plan.endAt)),
        progress: plan.status === "completed" ? 100 : plan.status === "in_progress" ? 50 : 0,
        dependencies: "",
        custom_class: `gantt-${plan.status}`,
      }));
      const exactRangeStart = new Date(rangeStartTime);
      const exactRangeEnd = new Date(rangeEndTime);
      exactRangeEnd.setDate(exactRangeEnd.getDate() - 1);
      const gantt = new Gantt(containerRef.current, tasks, {
        view_modes: [{
          name: "Day",
          padding: ["0d", "0d"],
          step: "1d",
          date_format: "YYYY-MM-DD",
          lower_text: (date: Date) => String(date.getDate()).padStart(2, "0"),
          upper_text: (date: Date, previousDate: Date | null) => !previousDate || date.getMonth() !== previousDate.getMonth() ? `${date.getMonth() + 1}月` : "",
          thick_line: (date: Date) => date.getDay() === 1,
        }],
        date_format: "YYYY-MM-DD",
        language: "zh",
        bar_height: 26,
        padding: 32,
        upper_header_height: 49,
        lower_header_height: 40,
        column_width: columnWidth,
        snap_at: "1d",
        infinite_padding: false,
        scroll_to: toLocalDateString(exactRangeStart),
        readonly_dates: true,
        readonly_progress: true,
        move_dependencies: false,
        today_button: false,
        popup_on: "hover",
        on_click: (task: { id: string }) => {
          const plan = plansByIdRef.current.get(task.id);
          if (plan) onSelectRef.current(plan);
        },
      }) as unknown as RangedGantt;

      // Frappe Gantt derives its canvas from task dates. Override those internal
      // bounds so navigation controls, not task padding, define the visible range.
      gantt.gantt_start = exactRangeStart;
      gantt.gantt_end = exactRangeEnd;
      gantt.setup_date_values();
      gantt.render();
      ensureCurrentDateMarker(gantt, containerRef.current, exactRangeStart, exactRangeEnd);
      centerDateMarkersWithinDayColumns(containerRef.current, columnWidth);
      applyWholeDayBarGeometry(containerRef.current, plansById, exactRangeStart, columnWidth);
      alignCurrentDateMarker(containerRef.current);
      currentMarkerFrame = window.requestAnimationFrame(() => {
        currentMarkerFrame = null;
        if (!disposed && containerRef.current) alignCurrentDateMarker(containerRef.current);
      });
      cleanupCenteredLabels = keepGanttLabelsCentered(containerRef.current);
      trimGanttToPlanRows(containerRef.current, plans.length);
      cleanupVerticalScrollSync = synchronizeVerticalScroll(
        containerRef.current.querySelector<HTMLElement>(".gantt-container"),
        verticalScrollPeerRef?.current ?? null,
      );
      cleanupPlanRowHover = synchronizePlanRowHover(containerRef.current, verticalScrollPeerRef?.current ?? null, plans);
      cleanupPopupFollow = configurePopupFollow(containerRef.current);
      cleanupScheduleInteraction = configureScheduleInteraction(containerRef.current, {
        columnWidth,
        getPlanById: (planId) => plansByIdRef.current.get(planId),
        onScheduleChange: (plan, startAt, endAt) => onScheduleChangeRef.current(plan, startAt, endAt),
      });
    });
    return () => {
      disposed = true;
      if (currentMarkerFrame !== null) window.cancelAnimationFrame(currentMarkerFrame);
      cleanupCenteredLabels();
      cleanupVerticalScrollSync();
      cleanupPlanRowHover();
      cleanupPopupFollow();
      cleanupScheduleInteraction();
    };
  }, [columnWidth, ganttInputSignature, rangeEndTime, rangeStartTime, verticalScrollPeerRef]);

  return (
    <div className="gantt-shell">
      {plans.length === 0 ? <div className="timeline-empty">当前时间范围没有工作计划</div> : null}
      <div ref={containerRef} className="gantt-mount" aria-label="工作计划甘特图" />
    </div>
  );
}

export function ensureCurrentDateMarker(
  gantt: Pick<RangedGantt, "gantt_end" | "highlight_current">,
  mount: HTMLElement,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
) {
  if (mount.querySelector(".current-highlight")) return;
  if (typeof gantt.highlight_current !== "function") return;
  const today = startOfLocalDay(now);
  const firstVisibleDay = startOfLocalDay(rangeStart);
  const lastVisibleDay = startOfLocalDay(rangeEnd);
  if (today < firstVisibleDay || today > lastVisibleDay) return;

  // Frappe treats gantt_end as a timestamp rather than an inclusive calendar
  // day. Temporarily extend the last visible day so a Sunday/week-end or
  // month-end "today" is not incorrectly considered outside the range.
  const originalEnd = gantt.gantt_end;
  gantt.gantt_end = endOfLocalDay(lastVisibleDay);
  try {
    gantt.highlight_current();
  } finally {
    gantt.gantt_end = originalEnd;
  }
}

function configurePopupFollow(mount: HTMLElement) {
  const popup = mount.querySelector<HTMLElement>(".popup-wrapper");
  const cleanups: Array<() => void> = [];
  if (!popup) return () => {};

  let latestPosition: { clientX: number; clientY: number } | null = null;
  const positionPopup = () => {
    if (!latestPosition) return;
    const positioningParent = popup.offsetParent instanceof HTMLElement ? popup.offsetParent : mount;
    const parentRect = positioningParent.getBoundingClientRect();
    popup.style.left = `${latestPosition.clientX - parentRect.left + positioningParent.scrollLeft + 12}px`;
    popup.style.top = `${latestPosition.clientY - parentRect.top + positioningParent.scrollTop + 12}px`;
  };
  const movePopup = (event: MouseEvent) => {
    latestPosition = { clientX: event.clientX, clientY: event.clientY };
    positionPopup();
  };

  for (const wrapper of mount.querySelectorAll<SVGGElement>(".bar-wrapper[data-id]")) {
    wrapper.addEventListener("mouseenter", movePopup);
    wrapper.addEventListener("mousemove", movePopup);
    cleanups.push(() => {
      wrapper.removeEventListener("mouseenter", movePopup);
      wrapper.removeEventListener("mousemove", movePopup);
    });
  }

  const popupObserver = new MutationObserver(positionPopup);
  popupObserver.observe(popup, { attributes: true, attributeFilter: ["class"] });
  cleanups.push(() => popupObserver.disconnect());

  return () => cleanups.forEach((cleanup) => cleanup());
}

function synchronizePlanRowHover(mount: HTMLElement, planRows: HTMLElement | null, plans: WorkPlan[]) {
  if (!planRows) return () => {};
  const rowsById = new Map(
    Array.from(planRows.querySelectorAll<HTMLElement>(".plan-row[data-plan-id]"), (row) => [row.dataset.planId!, row]),
  );
  const cleanups: Array<() => void> = [];
  let highlightedRow: HTMLElement | null = null;

  const highlight = (planId: string | null) => {
    const nextRow = planId ? rowsById.get(planId) ?? null : null;
    if (highlightedRow === nextRow) return;
    highlightedRow?.classList.remove("gantt-row-hovered");
    highlightedRow = nextRow;
    highlightedRow?.classList.add("gantt-row-hovered");
  };
  const bind = (target: Element, planId: string) => {
    const enter = () => highlight(planId);
    const leave = () => highlight(null);
    target.addEventListener("pointerenter", enter);
    target.addEventListener("pointerleave", leave);
    cleanups.push(() => {
      target.removeEventListener("pointerenter", enter);
      target.removeEventListener("pointerleave", leave);
    });
  };

  mount.querySelectorAll<SVGRectElement>(".grid-row").forEach((row, index) => {
    const plan = plans[index];
    if (plan) bind(row, plan.id);
  });
  mount.querySelectorAll<SVGGElement>(".bar-wrapper[data-id]").forEach((wrapper) => {
    const planId = wrapper.dataset.id;
    if (planId && rowsById.has(planId)) bind(wrapper, planId);
  });

  return () => {
    cleanups.forEach((cleanup) => cleanup());
    highlight(null);
  };
}

function synchronizeVerticalScroll(ganttContainer: HTMLElement | null, planRows: HTMLElement | null) {
  if (!ganttContainer || !planRows || ganttContainer === planRows) return () => {};
  const rowOffset = verticalRowOffset(ganttContainer, planRows);

  const syncPlanRows = () => {
    const expectedPlanRowsTop = ganttContainer.scrollTop - rowOffset;
    if (planRows.scrollTop !== expectedPlanRowsTop) planRows.scrollTop = expectedPlanRowsTop;
    const clampedGanttTop = planRows.scrollTop + rowOffset;
    if (ganttContainer.scrollTop !== clampedGanttTop) ganttContainer.scrollTop = clampedGanttTop;
  };
  const syncGantt = () => {
    const expectedGanttTop = planRows.scrollTop + rowOffset;
    if (ganttContainer.scrollTop !== expectedGanttTop) ganttContainer.scrollTop = expectedGanttTop;
    const clampedPlanRowsTop = ganttContainer.scrollTop - rowOffset;
    if (planRows.scrollTop !== clampedPlanRowsTop) planRows.scrollTop = clampedPlanRowsTop;
  };

  // Preserve the list position when Frappe Gantt replaces its internal container.
  syncGantt();
  ganttContainer.addEventListener("scroll", syncPlanRows, { passive: true });
  planRows.addEventListener("scroll", syncGantt, { passive: true });
  return () => {
    ganttContainer.removeEventListener("scroll", syncPlanRows);
    planRows.removeEventListener("scroll", syncGantt);
  };
}

function verticalRowOffset(ganttContainer: HTMLElement, planRows: HTMLElement) {
  const ganttRow = ganttContainer.querySelector<SVGGraphicsElement>(".grid-row");
  const planRow = planRows.querySelector<HTMLElement>(".plan-row");
  if (!ganttRow || !planRow) return 0;

  const ganttRect = ganttRow.getBoundingClientRect();
  const planRect = planRow.getBoundingClientRect();
  const offset = Math.round(
    ganttRect.top + ganttRect.height / 2 + ganttContainer.scrollTop
    - planRect.top - planRect.height / 2 - planRows.scrollTop,
  );
  return Number.isFinite(offset) && Math.abs(offset) > 1 ? offset : 0;
}

function formatGanttLabel(plan: WorkPlan, properties: GanttDisplayProperty[]) {
  const details = properties.flatMap((property) => {
    const value = property.id === "status"
      ? statusLabels[plan.status]
      : formatCustomFieldValue(plan.customFields[property.field.key], property.field);
    return value === "—" ? [] : [value];
  });
  return details.join(" · ");
}

function keepGanttLabelsCentered(mount: HTMLElement) {
  const observers: MutationObserver[] = [];

  for (const wrapper of mount.querySelectorAll<SVGGElement>(".bar-wrapper")) {
    const bar = wrapper.querySelector<SVGRectElement>(".bar");
    const label = wrapper.querySelector<SVGTextElement>(".bar-label");
    if (!bar || !label) continue;

    const centerLabel = () => {
      const x = Number(bar.getAttribute("x"));
      const width = Number(bar.getAttribute("width"));
      if (!Number.isFinite(x) || !Number.isFinite(width)) return;
      const centeredX = String(x + width / 2);
      if (label.getAttribute("x") !== centeredX) label.setAttribute("x", centeredX);
      if (label.getAttribute("text-anchor") !== "middle") label.setAttribute("text-anchor", "middle");
      if (label.classList.contains("big")) label.classList.remove("big");
    };

    centerLabel();
    if (typeof MutationObserver === "undefined") continue;
    const observer = new MutationObserver(centerLabel);
    observer.observe(bar, { attributes: true, attributeFilter: ["x", "width"] });
    observer.observe(label, { attributes: true, attributeFilter: ["x", "class", "text-anchor"] });
    observers.push(observer);
  }

  return () => observers.forEach((observer) => observer.disconnect());
}

function calendarDaySpan(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endUtc - startUtc) / 86_400_000));
}

function toLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function centerDateMarkersWithinDayColumns(mount: HTMLElement, columnWidth: number) {
  for (const marker of mount.querySelectorAll<HTMLElement>(".lower-text")) {
    marker.style.width = `${columnWidth}px`;
    marker.style.marginLeft = "0px";
    marker.style.marginRight = "0px";
    marker.style.textAlign = "center";
  }
}

function shiftIsoByLocalDays(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function trimGanttToPlanRows(mount: HTMLElement, planCount: number) {
  const ganttContainer = mount.querySelector<HTMLElement>(".gantt-container");
  const svg = ganttContainer?.querySelector<SVGSVGElement>("svg.gantt");
  const finalPlanRow = svg?.querySelectorAll<SVGRectElement>(".grid-row").item(planCount - 1);
  if (!ganttContainer || !svg || !finalPlanRow) return;

  const rowTop = Number(finalPlanRow.getAttribute("y"));
  const rowHeight = Number(finalPlanRow.getAttribute("height"));
  const contentHeight = rowTop + rowHeight;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return;

  ganttContainer.style.height = "100%";
  svg.setAttribute("height", String(contentHeight));
}

function timelineDayPosition(date: Date, rangeStart: Date, columnWidth: number) {
  const dayOffset = Math.round((
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate())
  ) / 86_400_000);
  return dayOffset * columnWidth;
}

function isStartOfLocalDay(date: Date) {
  return date.getHours() === 0
    && date.getMinutes() === 0
    && date.getSeconds() === 0
    && date.getMilliseconds() === 0;
}

function applyWholeDayBarGeometry(mount: HTMLElement, plansById: Map<string, WorkPlan>, rangeStart: Date, columnWidth: number) {
  for (const wrapper of mount.querySelectorAll<SVGGElement>(".bar-wrapper")) {
    const plan = plansById.get(wrapper.dataset.id ?? "");
    const bar = wrapper.querySelector<SVGRectElement>(".bar");
    if (!plan || !bar) continue;

    const x = timelineDayPosition(new Date(plan.startAt), rangeStart, columnWidth);
    const end = new Date(plan.endAt);
    const endX = timelineDayPosition(end, rangeStart, columnWidth)
      + (isStartOfLocalDay(end) ? 0 : columnWidth);
    const width = Math.max(columnWidth, endX - x);
    bar.querySelectorAll("animate").forEach((animation) => animation.remove());
    bar.setAttribute("x", String(x));
    bar.setAttribute("width", String(width));

    const progress = wrapper.querySelector<SVGRectElement>(".bar-progress");
    if (progress) {
      progress.querySelectorAll("animate").forEach((animation) => animation.remove());
      const ratio = plan.status === "completed" ? 1 : plan.status === "in_progress" ? 0.5 : 0;
      progress.setAttribute("x", String(x));
      progress.setAttribute("width", String(width * ratio));
    }

    const label = wrapper.querySelector<SVGTextElement>(".bar-label");
    if (label) label.setAttribute("x", String(x + width / 2));
    const highlight = mount.querySelector<HTMLElement>(`.date-range-highlight.highlight-${plan.id}`);
    if (highlight) {
      highlight.style.left = `${x}px`;
      highlight.style.width = `${width}px`;
    }
  }
}

export function alignCurrentDateMarker(mount: HTMLElement) {
  const date = mount.querySelector<HTMLElement>(".current-date-highlight");
  if (!date) return;
  const dateRect = date.getBoundingClientRect();
  if (dateRect.width <= 0) return;
  const centerX = dateRect.left + dateRect.width / 2;

  for (const marker of mount.querySelectorAll<HTMLElement>(".current-highlight, .current-ball-highlight")) {
    const parent = marker.offsetParent instanceof HTMLElement ? marker.offsetParent : marker.parentElement;
    if (!parent) continue;
    const parentRect = parent.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const markerWidth = markerRect.width || Number.parseFloat(marker.style.width) || (marker.classList.contains("current-ball-highlight") ? 6 : 1);
    marker.style.left = `${centerX - parentRect.left - markerWidth / 2}px`;
  }
}

function configureScheduleInteraction(mount: HTMLElement, options: {
  columnWidth: number;
  getPlanById: (planId: string) => WorkPlan | undefined;
  onScheduleChange: Props["onScheduleChange"];
}) {
  const cleanups: Array<() => void> = [];
  const snapPixels = options.columnWidth;
  const handleWidth = 3;
  const edgeHitWidth = 10;

  for (const wrapper of mount.querySelectorAll<SVGGElement>(".bar-wrapper")) {
    const bar = wrapper.querySelector<SVGRectElement>(".bar");
    const planId = wrapper.dataset.id;
    if (!bar || !planId) continue;
    let handleGroup = wrapper.querySelector<SVGGElement>(".handle-group");
    if (!handleGroup) {
      handleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      handleGroup.classList.add("handle-group");
      wrapper.append(handleGroup);
    }
    const createHandle = (edge: "left" | "right") => {
      const handle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      handle.classList.add("handle", edge);
      handleGroup.append(handle);
      return handle;
    };
    const leftHandle = createHandle("left");
    const rightHandle = createHandle("right");
    const handles = { start: leftHandle, end: rightHandle } as const;

    const positionHandles = () => {
      const barX = Number(bar.getAttribute("x"));
      const barWidth = Number(bar.getAttribute("width"));
      for (const [edge, handle] of Object.entries(handles) as Array<[keyof typeof handles, SVGRectElement]>) {
        handle.setAttribute("y", bar.getAttribute("y") ?? "0");
        handle.setAttribute("x", String((edge === "start" ? barX : barX + barWidth) - handleWidth / 2));
        handle.setAttribute("width", String(handleWidth));
        handle.setAttribute("height", bar.getAttribute("height") ?? "26");
        handle.setAttribute("rx", "2");
        handle.setAttribute("ry", "2");
        handle.removeAttribute("transform");
        handle.style.pointerEvents = "all";
        handle.style.vectorEffect = "non-scaling-stroke";
      }
    };
    positionHandles();

    let removeDocumentListeners = () => {};
    let suppressNextClick = false;
    let suppressClickTimer: number | null = null;
    const suppressScheduleClick = (event: MouseEvent) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
      suppressClickTimer = null;
      event.preventDefault();
      event.stopPropagation();
    };
    const startScheduleChange = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const plan = options.getPlanById(planId);
      if (!plan) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const rect = bar.getBoundingClientRect();
      const startDistance = rect.width > 0 ? Math.abs(event.clientX - rect.left) : Number.POSITIVE_INFINITY;
      const endDistance = rect.width > 0 ? Math.abs(event.clientX - rect.right) : Number.POSITIVE_INFINITY;
      const mode = target.closest(".handle.left") || startDistance <= edgeHitWidth
        ? "start"
        : target.closest(".handle.right") || endDistance <= edgeHitWidth
          ? "end"
          : "move";
      event.preventDefault();
      event.stopPropagation();

      const initialClientX = event.clientX;
      const initialX = Number(bar.getAttribute("x"));
      const initialWidth = Number(bar.getAttribute("width"));
      const label = wrapper.querySelector<SVGTextElement>(".bar-label");
      const progress = wrapper.querySelector<SVGRectElement>(".bar-progress");
      const initialProgressWidth = Number(progress?.getAttribute("width") ?? 0);
      const progressRatio = initialWidth > 0 ? initialProgressWidth / initialWidth : 0;
      const highlight = mount.querySelector<HTMLElement>(`.date-range-highlight.highlight-${plan.id}`);
      let snappedDelta = 0;

      const renderScheduleGeometry = (nextX: number, nextWidth: number) => {
        bar.setAttribute("x", String(nextX));
        bar.setAttribute("width", String(nextWidth));
        positionHandles();
        if (label) label.setAttribute("x", String(nextX + nextWidth / 2));
        if (progress) {
          progress.setAttribute("x", String(nextX));
          progress.setAttribute("width", String(nextWidth * progressRatio));
        }
        if (highlight) {
          highlight.style.left = `${nextX}px`;
          highlight.style.width = `${nextWidth}px`;
        }
      };
      const moveSchedule = (moveEvent: MouseEvent) => {
        const rawDelta = moveEvent.clientX - initialClientX;
        const roundedDelta = Math.round(rawDelta / snapPixels) * snapPixels;
        snappedDelta = mode === "start"
          ? Math.min(roundedDelta, initialWidth - snapPixels)
          : mode === "end"
            ? Math.max(roundedDelta, snapPixels - initialWidth)
            : roundedDelta;
        const nextX = mode === "start" || mode === "move" ? initialX + snappedDelta : initialX;
        const nextWidth = mode === "start" ? initialWidth - snappedDelta : mode === "end" ? initialWidth + snappedDelta : initialWidth;
        renderScheduleGeometry(nextX, nextWidth);
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
      };
      const finishSchedule = (upEvent: MouseEvent) => {
        removeDocumentListeners();
        wrapper.classList.remove("schedule-dragging");
        if (snappedDelta === 0) return;
        upEvent.preventDefault();
        upEvent.stopPropagation();
        suppressNextClick = true;
        suppressClickTimer = window.setTimeout(() => {
          suppressNextClick = false;
          suppressClickTimer = null;
        }, 250);

        const deltaDays = Math.round(snappedDelta / options.columnWidth);
        const startAt = mode === "start" || mode === "move"
          ? shiftIsoByLocalDays(plan.startAt, deltaDays)
          : plan.startAt;
        const endAt = mode === "end" || mode === "move"
          ? shiftIsoByLocalDays(plan.endAt, deltaDays)
          : plan.endAt;
        window.setTimeout(() => options.onScheduleChange(plan, startAt, endAt), 0);
      };

      wrapper.classList.add("schedule-dragging");
      document.addEventListener("mousemove", moveSchedule, true);
      document.addEventListener("mouseup", finishSchedule, true);
      removeDocumentListeners = () => {
        document.removeEventListener("mousemove", moveSchedule, true);
        document.removeEventListener("mouseup", finishSchedule, true);
      };
    };

    wrapper.addEventListener("mousedown", startScheduleChange, true);
    wrapper.addEventListener("click", suppressScheduleClick, true);
    cleanups.push(() => {
      removeDocumentListeners();
      wrapper.classList.remove("schedule-dragging");
      if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
      wrapper.removeEventListener("mousedown", startScheduleChange, true);
      wrapper.removeEventListener("click", suppressScheduleClick, true);
      leftHandle.remove();
      rightHandle.remove();
    });
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

export default memo(GanttTimeline);
