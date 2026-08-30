import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CustomFieldDefinition, Reminder, ReminderDay, WorkPlan } from "@workplan/contracts";
import { loadGantt } from "../lib/gantt";
import { formatCustomFieldValue, statusLabels } from "../lib/format";

export type GanttDisplayProperty =
  | { id: "status"; label: string; field?: undefined }
  | { id: `custom:${string}`; label: string; field: CustomFieldDefinition };

type Props = {
  plans: WorkPlan[];
  reminders?: ReminderDay[];
  displayProperties?: GanttDisplayProperty[];
  tooltipProperties?: GanttDisplayProperty[];
  view: "week" | "month";
  rangeStart: Date;
  rangeEnd: Date;
  verticalScrollPeerRef?: RefObject<HTMLElement | null>;
  taskListCollapsed?: boolean;
  onScheduleChange: (plan: WorkPlan, startAt: string, endAt: string) => void;
  onSelect: (plan: WorkPlan) => void;
  onReminderSelect?: (planId: string) => void;
  onCreateAt?: (date: Date) => void;
  readOnly?: boolean;
};

type RangedGantt = {
  gantt_start: Date;
  gantt_end: Date;
  highlight_current?: () => void;
  setup_date_values: () => void;
  render: () => void;
};

const MIN_DAY_COLUMN_WIDTH = 32;
// Lucide "Bell" outline path, injected as a small inline SVG so the header
// buttons match the app's 18px rounded-outline icon baseline.
const REMINDER_BELL_ICON = '<svg class="reminder-bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const EMPTY_DISPLAY_PROPERTIES: GanttDisplayProperty[] = [];
const EMPTY_REMINDER_DAYS: ReminderDay[] = [];
const EMPTY_TIMELINE_TASK_ID = "__empty-timeline__";
const BAR_DOUBLE_CLICK_WINDOW_MS = 500;

function GanttTimeline({ plans, reminders = EMPTY_REMINDER_DAYS, displayProperties = EMPTY_DISPLAY_PROPERTIES, tooltipProperties = EMPTY_DISPLAY_PROPERTIES, view, rangeStart, rangeEnd, verticalScrollPeerRef, taskListCollapsed = false, onScheduleChange, onSelect, onReminderSelect, onCreateAt, readOnly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const plansByIdRef = useRef(plansById);
  const tooltipPropertiesRef = useRef(tooltipProperties);
  const onScheduleChangeRef = useRef(onScheduleChange);
  const onSelectRef = useRef(onSelect);
  const onReminderSelectRef = useRef(onReminderSelect);
  const onCreateAtRef = useRef(onCreateAt);
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
  const remindersSignature = useMemo(() => JSON.stringify(reminders), [reminders]);

  plansByIdRef.current = plansById;
  tooltipPropertiesRef.current = tooltipProperties;
  onScheduleChangeRef.current = onScheduleChange;
  onSelectRef.current = onSelect;
  onReminderSelectRef.current = onReminderSelect;
  onCreateAtRef.current = onCreateAt;

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
    let cleanupDateCellCreation = () => {};
    let cleanupDateCellAffordance = () => {};
    let cleanupReminderBells = () => {};
    const container = containerRef.current;
    if (!container) return;
    if (columnWidth <= 0) return;

    void loadGantt().then((Gantt) => {
      if (disposed || !containerRef.current) return;
      containerRef.current.replaceChildren();
      const tasks = plans.length > 0
        ? plans.map((plan) => ({
          id: plan.id,
          name: formatGanttLabel(plan, displayProperties),
          start: startOfLocalDay(new Date(plan.startAt)),
          end: endOfLocalDay(new Date(plan.endAt)),
          progress: plan.status === "completed" ? 100 : plan.status === "in_progress" ? 50 : 0,
          dependencies: "",
          custom_class: `gantt-${plan.status}`,
        }))
        : [{
          id: EMPTY_TIMELINE_TASK_ID,
          name: "",
          start: startOfLocalDay(new Date(rangeStartTime)),
          end: endOfLocalDay(new Date(rangeEndTime - 1)),
          progress: 0,
          dependencies: "",
          custom_class: "gantt-empty",
        }];
      const exactRangeStart = new Date(rangeStartTime);
      const exactRangeEnd = new Date(rangeEndTime);
      exactRangeEnd.setDate(exactRangeEnd.getDate() - 1);
      let lastBarClick: { planId: string; at: number } | null = null;
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
        popup: (context: { task: { id: string } }) => {
          const plan = plansByIdRef.current.get(context.task.id);
          if (!plan) return false;
          return formatGanttTooltip(plan, tooltipPropertiesRef.current);
        },
        on_click: (task: { id: string }) => {
          const plan = plansByIdRef.current.get(task.id);
          if (!plan) return;

           // Frappe emits two click callbacks before its dblclick callback. Keep the
           // first click responsive for ordinary editing, but do not reopen the same
           // drawer when the user double-clicks an existing bar.
           const now = Date.now();
           if (lastBarClick?.planId === plan.id && now - lastBarClick.at < BAR_DOUBLE_CLICK_WINDOW_MS) {
             lastBarClick = null;
             return;
           }
           lastBarClick = { planId: plan.id, at: now };
           onSelectRef.current(plan);
        },
      }) as unknown as RangedGantt;

      // Frappe Gantt derives its canvas from task dates. Override those internal
      // bounds so navigation controls, not task padding, define the visible range.
      gantt.gantt_start = exactRangeStart;
      gantt.gantt_end = exactRangeEnd;
      gantt.setup_date_values();
      gantt.render();
       if (plans.length === 0) {
         containerRef.current.querySelector<SVGGElement>(`.bar-wrapper[data-id="${EMPTY_TIMELINE_TASK_ID}"]`)?.remove();
       }
      ensureCurrentDateMarker(gantt, containerRef.current, exactRangeStart, exactRangeEnd);
      centerDateMarkersWithinDayColumns(containerRef.current, columnWidth);
      if (view === "week" && rangeSpansCalendarMonth(exactRangeStart, new Date(rangeEndTime))) {
        alignCrossMonthUpperLabel(
          containerRef.current,
          containerRef.current.closest<HTMLElement>(".planner-timeline")?.querySelector<HTMLElement>(".timeline-range-controls") ?? null,
        );
      }
      applyWholeDayBarGeometry(containerRef.current, plansById, exactRangeStart, columnWidth);
      alignCurrentDateMarker(containerRef.current);
      currentMarkerFrame = window.requestAnimationFrame(() => {
        currentMarkerFrame = null;
        if (!disposed && containerRef.current) alignCurrentDateMarker(containerRef.current);
      });
      cleanupCenteredLabels = keepGanttLabelsCentered(containerRef.current);
      trimGanttToPlanRows(containerRef.current, Math.max(plans.length, 1));
      // 收起态下任务列表不可见：不挂接双向滚动/悬停同步，展开后随图表重建恢复。
      cleanupVerticalScrollSync = taskListCollapsed ? () => {} : synchronizeVerticalScroll(
        containerRef.current.querySelector<HTMLElement>(".gantt-container"),
        verticalScrollPeerRef?.current ?? null,
      );
      cleanupPlanRowHover = taskListCollapsed ? () => {} : synchronizePlanRowHover(containerRef.current, verticalScrollPeerRef?.current ?? null, plans);
      cleanupPopupFollow = configurePopupFollow(containerRef.current);
      // 只读模式不挂接拖拽/缩放与双击新建，也不会渲染新建提示；选择与浮动提示保持可用。
      if (!readOnly) {
        cleanupScheduleInteraction = configureScheduleInteraction(containerRef.current, {
          columnWidth,
          getPlanById: (planId) => plansByIdRef.current.get(planId),
          onScheduleChange: (plan, startAt, endAt) => onScheduleChangeRef.current(plan, startAt, endAt),
        });
        cleanupDateCellAffordance = configureDateCellAffordance(containerRef.current, {
          rangeStart: exactRangeStart,
          dayCount,
          columnWidth,
        });
        cleanupDateCellCreation = configureDateCellCreation(containerRef.current, {
          rangeStart: exactRangeStart,
          dayCount,
          columnWidth,
          onCreateAt: (date) => onCreateAtRef.current?.(date),
        });
      }
      cleanupReminderBells = injectReminderBells(containerRef.current, reminders, {
        onSelectReminder: (planId) => {
          const plan = plansByIdRef.current.get(planId);
          if (plan) onSelectRef.current(plan);
          else onReminderSelectRef.current?.(planId);
        },
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
       cleanupDateCellCreation();
       cleanupDateCellAffordance();
       cleanupReminderBells();
    };
  }, [columnWidth, ganttInputSignature, remindersSignature, rangeEndTime, rangeStartTime, readOnly, taskListCollapsed, verticalScrollPeerRef]);

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

// Renders the whole hover tooltip as HTML: a title line plus a details block
// (Chinese date range, selected properties in order as "属性名：值", and the
// duration for plans that are in progress or completed). Frappe Gantt's popup callback
// replaces the .popup-wrapper innerHTML, so the class names below reuse the
// library's existing tooltip styles while keeping the positioning handled by
// configurePopupFollow untouched.
export function formatGanttTooltip(plan: WorkPlan, properties: GanttDisplayProperty[]) {
  const start = startOfLocalDay(new Date(plan.startAt));
  const end = startOfLocalDay(new Date(plan.endAt));
  const crossMonthOrYear = start.getFullYear() !== end.getFullYear() || start.getMonth() !== end.getMonth();
  const lines = [
    `${chineseDayLabel(start, crossMonthOrYear)} - ${chineseDayLabel(end, crossMonthOrYear)}`,
  ];
  for (const property of properties) {
    const value = property.id === "status"
      ? statusLabels[plan.status]
      : formatCustomFieldValue(plan.customFields[property.field.key], property.field);
    if (value === "—" || value === "") continue;
    lines.push(`${escapeHtml(property.label)}：${escapeHtml(value)}`);
  }
  if (plan.status === "in_progress" || plan.status === "completed") {
    lines.push(`持续 ${calendarDayCount(start, end)} 天`);
  }
  return `<div class="title">${escapeHtml(plan.title)}</div><div class="details">${lines.join("<br/>")}</div>`;
}

/**
 * 在时间轴表头日期数字下方注入提醒铃铛（规格 R3）。
 * - 日期在可见范围内即渲染（含未来提醒日；过期规则由服务端派生自然消失）。
 * - 一个日期最多一个铃铛：同一天的多条提醒合并展示。
 * - 单计划铃铛绑定点击打开对应 Work Plan；多计划铃铛仅展示（不绑定点击）。
 * 铃铛随 gantt 重渲染重建（容器 replaceChildren），本轮只负责本次注入的监听器与 tooltip 清理。
 */
export function injectReminderBells(
  mount: HTMLElement,
  reminders: ReminderDay[],
  options: { onSelectReminder: (planId: string) => void },
) {
  const remindersByDate = new Map<string, Reminder[]>();
  for (const day of reminders) {
    for (const reminder of day.reminders) {
      const list = remindersByDate.get(reminder.date) ?? [];
      list.push(reminder);
      remindersByDate.set(reminder.date, list);
    }
  }
  if (remindersByDate.size === 0) return () => {};

  const container = mount.querySelector<HTMLElement>(".gantt-container");
  const tooltip = document.createElement("div");
  tooltip.className = "timeline-reminder-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  container?.append(tooltip);
  const hideTooltip = () => tooltip.classList.remove("visible");
  const showTooltip = (bell: HTMLElement, content: string) => {
    if (!container) return;
    tooltip.innerHTML = content;
    positionReminderTooltip(tooltip, bell, container);
    tooltip.classList.add("visible");
  };

  const cleanups: Array<() => void> = [];
  for (const lowerText of mount.querySelectorAll<HTMLElement>(".lower-text")) {
    const dateClass = Array.from(lowerText.classList).find((name) => /^date_\d{4}-\d{2}-\d{2}$/.test(name));
    if (!dateClass) continue;
    const dayReminders = remindersByDate.get(dateClass.slice("date_".length));
    if (!dayReminders || dayReminders.length === 0) continue;

    const plans = dayReminders.flatMap((reminder) => reminder.plans);
    const content = formatReminderTooltip(dayReminders);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline-reminder-bell";
    button.dataset.reminderDate = dateClass.slice("date_".length);
    button.innerHTML = REMINDER_BELL_ICON;
    const label = plans.length === 1
      ? "提醒：" + plans[0]!.title
      : "提醒：" + plans.length + " 个工作计划";
    button.setAttribute("aria-label", label);
    button.title = label;

    const show = () => showTooltip(button, content);
    const hide = () => hideTooltip();
    button.addEventListener("mouseenter", show);
    button.addEventListener("mouseleave", hide);
    button.addEventListener("focus", show);
    button.addEventListener("blur", hide);
    cleanups.push(() => {
      button.removeEventListener("mouseenter", show);
      button.removeEventListener("mouseleave", hide);
      button.removeEventListener("focus", show);
      button.removeEventListener("blur", hide);
    });

    if (plans.length === 1) {
      const click = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        hideTooltip();
        options.onSelectReminder(plans[0]!.id);
      };
      button.addEventListener("click", click);
      cleanups.push(() => button.removeEventListener("click", click));
    } else {
      button.setAttribute("aria-disabled", "true");
    }

    lowerText.append(button);
  }

  const hideOnScroll = () => hideTooltip();
  container?.addEventListener("scroll", hideOnScroll, { passive: true });
  return () => {
    cleanups.forEach((cleanup) => cleanup());
    container?.removeEventListener("scroll", hideOnScroll);
    tooltip.remove();
  };
}

function positionReminderTooltip(tooltip: HTMLElement, bell: HTMLElement, container: HTMLElement) {
  const bellRect = bell.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const width = tooltip.offsetWidth > 0 ? tooltip.offsetWidth : 220;
  const targetLeft = bellRect.left - containerRect.left + container.scrollLeft + bellRect.width / 2 - width / 2;
  const maxLeft = Math.max(8, container.clientWidth - width - 8);
  tooltip.style.left = `${Math.max(8, Math.min(targetLeft, maxLeft))}px`;
  tooltip.style.top = `${bellRect.bottom - containerRect.top + container.scrollTop + 6}px`;
}

export function formatReminderTooltip(reminders: Reminder[]): string {
  return reminders
    .map((reminder) => {
      const title = reminder.type === "work-order"
        ? "起检修单提醒"
        : "下周有中风险作业，今天提交作业计划";
      const reminderDate = new Date(reminder.date + "T00:00:00");
      const lines = reminder.plans.map((plan) => {
        const start = new Date(plan.startAt);
        const withYear = start.getFullYear() !== reminderDate.getFullYear();
        return escapeHtml(plan.title) + " · 开始 " + chineseDayLabel(start, withYear);
      });
      return '<div class="title">' + title + '</div><div class="details">' + lines.join("<br/>") + "</div>";
    })
    .join("");
}

function chineseDayLabel(date: Date, withYear: boolean) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return withYear ? `${date.getFullYear()}年${month}月${day}日` : `${month}月${day}日`;
}

function calendarDayCount(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endUtc - startUtc) / 86_400_000) + 1);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

export function alignCrossMonthUpperLabel(mount: HTMLElement, controls: HTMLElement | null) {
  const labels = [...mount.querySelectorAll<HTMLElement>(".upper-header > .upper-text")];
  if (labels.length < 2 || !controls) return;

  const firstLabelRect = labels[0]!.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  const nextLabel = labels[1]!;
  const nextLabelRect = nextLabel.getBoundingClientRect();
  const leadingGap = controlsRect.left - firstLabelRect.right;
  const targetLeft = controlsRect.right + leadingGap;
  const shift = Math.round(targetLeft - nextLabelRect.left);
  if (shift !== 0) nextLabel.style.marginLeft = `${shift}px`;
}

function rangeSpansCalendarMonth(start: Date, exclusiveEnd: Date) {
  const lastVisibleDay = new Date(exclusiveEnd);
  lastVisibleDay.setDate(lastVisibleDay.getDate() - 1);
  return start.getFullYear() !== lastVisibleDay.getFullYear() || start.getMonth() !== lastVisibleDay.getMonth();
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

export function timelineDateAtPosition(position: number, rangeStart: Date, columnWidth: number, dayCount: number) {
  if (!Number.isFinite(position) || !Number.isFinite(columnWidth) || columnWidth <= 0 || dayCount <= 0) return null;
  const dayIndex = Math.floor(position / columnWidth);
  if (dayIndex < 0 || dayIndex >= dayCount) return null;
  return new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + dayIndex);
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

function configureDateCellAffordance(mount: HTMLElement, options: {
  rangeStart: Date;
  dayCount: number;
  columnWidth: number;
}) {
  const scrollContainer = mount.querySelector<HTMLElement>(".gantt-container");
  const svg = mount.querySelector<SVGSVGElement>("svg.gantt");
  const shell = mount.parentElement;
  if (!scrollContainer || !svg || !shell) return () => {};

  const cell = document.createElement("div");
  cell.className = "timeline-create-hover-cell";
  cell.setAttribute("aria-hidden", "true");
  const hint = document.createElement("div");
  hint.className = "timeline-create-hover-hint";
  hint.textContent = "双击新建工作计划";
  hint.setAttribute("aria-hidden", "true");
  cell.append(hint);
  shell.append(cell);

  const hide = () => {
    cell.classList.remove("visible");
  };
  const showAt = (row: SVGRectElement, event: PointerEvent) => {
    const svgRect = svg.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const position = event.clientX - svgRect.left + scrollContainer.scrollLeft;
    const date = timelineDateAtPosition(position, options.rangeStart, options.columnWidth, options.dayCount);
    if (!date) {
      hide();
      return;
    }

    const dayIndex = Math.floor(position / options.columnWidth);
    const left = svgRect.left - shellRect.left + dayIndex * options.columnWidth - scrollContainer.scrollLeft;
    const top = rowRect.top - shellRect.top;
    cell.style.left = `${left}px`;
    cell.style.top = `${top}px`;
    cell.style.width = `${options.columnWidth}px`;
    cell.style.height = `${Math.max(1, rowRect.height)}px`;
    hint.style.left = `${Math.max(4, Math.min(left + 8, shell.clientWidth - 160)) - left}px`;
    hint.style.top = "6px";
    cell.classList.add("visible");
  };

  const cleanups: Array<() => void> = [];
  for (const row of mount.querySelectorAll<SVGRectElement>(".grid-row")) {
    const enter = (event: PointerEvent) => showAt(row, event);
    const move = (event: PointerEvent) => showAt(row, event);
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerleave", hide);
    cleanups.push(() => {
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerleave", hide);
    });
  }

  const hideOnScroll = () => hide();
  scrollContainer.addEventListener("scroll", hideOnScroll, { passive: true });
  return () => {
    cleanups.forEach((cleanup) => cleanup());
    scrollContainer.removeEventListener("scroll", hideOnScroll);
    cell.remove();
  };
}

function configureDateCellCreation(mount: HTMLElement, options: {
  rangeStart: Date;
  dayCount: number;
  columnWidth: number;
  onCreateAt: (date: Date) => void;
}) {
  const scrollContainer = mount.querySelector<HTMLElement>(".gantt-container");
  const svg = mount.querySelector<SVGSVGElement>("svg.gantt");
  if (!scrollContainer || !svg) return () => {};

  const handleDoubleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".bar-wrapper, .handle, .grid-header, .popup-wrapper")) return;
    if (!target.closest(".grid-row")) return;

    const svgRect = svg.getBoundingClientRect();
    const position = event.clientX - svgRect.left + scrollContainer.scrollLeft;
    const date = timelineDateAtPosition(position, options.rangeStart, options.columnWidth, options.dayCount);
    if (!date) return;

    event.preventDefault();
    event.stopPropagation();
    options.onCreateAt(date);
  };

  mount.addEventListener("dblclick", handleDoubleClick);
  return () => mount.removeEventListener("dblclick", handleDoubleClick);
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
