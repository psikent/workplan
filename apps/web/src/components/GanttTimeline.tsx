import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CustomFieldDefinition, Reminder, ReminderDay, WorkPlan } from "@workplan/contracts";
import { loadGantt } from "../lib/gantt";
import { formatCustomFieldValue, statusLabels } from "../lib/format";

export type GanttDisplayProperty =
  | { id: "status"; label: string; field?: undefined }
  | { id: "title"; label: string; field?: undefined }
  | { id: `custom:${string}`; label: string; field: CustomFieldDefinition };

export type GanttDisplayId = GanttDisplayProperty["id"];

// Bar labels are a single SVG text line with no overflow handling, so the work
// content is capped here; the hover tooltip keeps showing the full title via
// its fixed title line.
const WORK_CONTENT_LABEL_MAX_CHARS = 20;

type Props = {
  plans: WorkPlan[];
  reminders?: ReminderDay[];
  displayProperties?: GanttDisplayProperty[];
  tooltipProperties?: GanttDisplayProperty[];
  ownerField?: CustomFieldDefinition | undefined;
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
  // 变化即强制整图重建（不入签名）：拖动保存失败后父组件用它还原乐观几何。
  rebuildKey?: number;
};

type RangedGantt = {
  gantt_start: Date;
  gantt_end: Date;
  highlight_current?: () => void;
  setup_date_values: () => void;
  render: () => void;
};

const MIN_DAY_COLUMN_WIDTH = 32;
// 甘特表头总高必须等于左侧列表表头行高（styles.css .plan-grid-scroll 首行 46px），
// 否则下方每一行的计划与甘特条错位。frappe-gantt 的表头总高 =
// lower + upper + 10（库内建常量，其样式表 .grid-header 的 calc 同样写死 +10px），
// 因此 lower 需预先扣除这 10px。
const PLANNER_HEADER_HEIGHT = 46;
const FRAPPE_HEADER_HEIGHT_PADDING = 10;
// Lucide "Bell" outline path, injected as a small inline SVG so the header
// buttons match the app's 18px rounded-outline icon baseline.
const REMINDER_BELL_ICON = '<svg class="reminder-bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const EMPTY_DISPLAY_PROPERTIES: GanttDisplayProperty[] = [];
const EMPTY_REMINDER_DAYS: ReminderDay[] = [];
const EMPTY_TIMELINE_TASK_ID = "__empty-timeline__";
const BAR_DOUBLE_CLICK_WINDOW_MS = 500;

function GanttTimeline({ plans, reminders = EMPTY_REMINDER_DAYS, displayProperties = EMPTY_DISPLAY_PROPERTIES, tooltipProperties = EMPTY_DISPLAY_PROPERTIES, ownerField, view, rangeStart, rangeEnd, verticalScrollPeerRef, taskListCollapsed = false, onScheduleChange, onSelect, onReminderSelect, onCreateAt, readOnly = false, rebuildKey = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const plansByIdRef = useRef(plansById);
  const tooltipPropertiesRef = useRef(tooltipProperties);
  const ownerFieldRef = useRef(ownerField);
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
    conflictSignature(plan),
  ])), [displayProperties, plans]);
  const remindersSignature = useMemo(() => JSON.stringify(reminders), [reminders]);

  plansByIdRef.current = plansById;
  tooltipPropertiesRef.current = tooltipProperties;
  ownerFieldRef.current = ownerField;
  onScheduleChangeRef.current = onScheduleChange;
  onSelectRef.current = onSelect;
  onReminderSelectRef.current = onReminderSelect;
  onCreateAtRef.current = onCreateAt;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 拖动分隔条/窗口缩放时宽度连续变化，每次变化都会触发整图重建
    // （replaceChildren + Gantt.render + 全部 DOM 修补）：尾随去抖收敛为
    // 停止变化后一次重建；首次测量立即应用，不拖慢首屏。
    let timer: number | null = null;
    let hasWidth = false;
    const applyWidth = (nextWidth: number) => {
      setAvailableWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    const updateWidth = (width: number) => {
      const nextWidth = Math.floor(width);
      if (nextWidth <= 0) return;
      if (timer !== null) window.clearTimeout(timer);
      if (!hasWidth) {
        hasWidth = true;
        applyWidth(nextWidth);
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        hasWidth = true;
        applyWidth(nextWidth);
      }, 150);
    };

    updateWidth(container.clientWidth);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => updateWidth(entry?.contentRect.width ?? container.clientWidth));
    observer.observe(container);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
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
          // frappe 的 custom_class 只接受单 token（内部 classList.add）；
          // 冲突警示类在渲染后的 applyWholeDayBarGeometry 里统一同步
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
        // 高度归零以省出空白行，但 upper_text 标签仍须渲染（display:none 隐藏）：
        // frappe-gantt 内部按标签文字定位滚动位置，缺标签会抛错。
        upper_header_height: 0,
        lower_header_height: PLANNER_HEADER_HEIGHT - FRAPPE_HEADER_HEIGHT_PADDING,
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
          return formatGanttTooltip(plan, tooltipPropertiesRef.current, ownerFieldRef.current);
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
      removeEmptyGanttSideHeader(containerRef.current);
      disableWeekendHighlightHit(containerRef.current);
       if (plans.length === 0) {
         containerRef.current.querySelector<SVGGElement>(`.bar-wrapper[data-id="${EMPTY_TIMELINE_TASK_ID}"]`)?.remove();
       }
      ensureCurrentDateMarker(gantt, containerRef.current, exactRangeStart, exactRangeEnd);
      centerDateMarkersWithinDayColumns(containerRef.current, columnWidth);
      applyWholeDayBarGeometry(containerRef.current, plansById, exactRangeStart, columnWidth);
      alignCurrentDateMarker(containerRef.current);
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
      alignDateHeaderContentVertically(containerRef.current);
      currentMarkerFrame = window.requestAnimationFrame(() => {
        currentMarkerFrame = null;
        if (!disposed && containerRef.current) {
          alignDateHeaderContentVertically(containerRef.current);
          alignCurrentDateMarker(containerRef.current);
        }
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
  }, [columnWidth, ganttInputSignature, rebuildKey, remindersSignature, rangeEndTime, rangeStartTime, readOnly, taskListCollapsed, verticalScrollPeerRef]);

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

function truncateWorkContent(value: string) {
  const chars = Array.from(value);
  return chars.length > WORK_CONTENT_LABEL_MAX_CHARS
    ? `${chars.slice(0, WORK_CONTENT_LABEL_MAX_CHARS).join("")}…`
    : value;
}

function ganttPropertyValue(plan: WorkPlan, property: GanttDisplayProperty, options?: { truncateTitle?: boolean }) {
  return property.id === "status"
    ? statusLabels[plan.status]
    : property.id === "title"
      ? options?.truncateTitle ? truncateWorkContent(plan.title) : plan.title
      : formatCustomFieldValue(plan.customFields[property.field.key], property.field);
}

function formatGanttLabel(plan: WorkPlan, properties: GanttDisplayProperty[]) {
  const details = properties.flatMap((property) => {
    const value = ganttPropertyValue(plan, property, { truncateTitle: true });
    return value === "—" ? [] : [value];
  });
  return details.join(" · ");
}

// Renders the whole hover tooltip as HTML: a title line plus a details block
// (Chinese date range, selected properties in order as "属性名：值", and the
// duration for plans that are in progress or completed). Conflict plans (规格 R6)
// additionally force an amber owner line plus a counterpart list, regardless of
// the user's tooltip property configuration; non-conflict tooltips stay as-is.
// Frappe Gantt's popup callback replaces the .popup-wrapper innerHTML, so the
// class names below reuse the library's existing tooltip styles while keeping
// the positioning handled by configurePopupFollow untouched.
export function formatGanttTooltip(plan: WorkPlan, properties: GanttDisplayProperty[], ownerField?: CustomFieldDefinition) {
  const start = startOfLocalDay(new Date(plan.startAt));
  const end = startOfLocalDay(new Date(plan.endAt));
  const crossMonthOrYear = start.getFullYear() !== end.getFullYear() || start.getMonth() !== end.getMonth();
  const lines = [
    `${chineseDayLabel(start, crossMonthOrYear)} - ${chineseDayLabel(end, crossMonthOrYear)}`,
  ];
  for (const property of properties) {
    const value = ganttPropertyValue(plan, property);
    if (value === "—" || value === "") continue;
    lines.push(`${escapeHtml(property.label)}：${escapeHtml(value)}`);
  }
  if (plan.status === "in_progress" || plan.status === "completed") {
    lines.push(`持续 ${calendarDayCount(start, end)} 天`);
  }
  let html = `<div class="title">${escapeHtml(plan.title)}</div><div class="details">${lines.join("<br/>")}</div>`;
  if (plan.ownerConflict) {
    const ownerLabel = ownerField?.label ?? "工作负责人";
    const ownerValue = ownerField
      ? formatCustomFieldValue(plan.customFields.owner, ownerField)
      : String(plan.customFields.owner ?? "");
    const items = plan.ownerConflict.counterparts.map((counterpart) => {
      const counterpartStart = startOfLocalDay(new Date(counterpart.startAt));
      const counterpartEnd = startOfLocalDay(new Date(counterpart.endAt));
      const counterpartCross = counterpartStart.getFullYear() !== counterpartEnd.getFullYear()
        || counterpartStart.getMonth() !== counterpartEnd.getMonth();
      return escapeHtml(`与【${counterpart.label}】${chineseDayLabel(counterpartStart, counterpartCross)} - ${chineseDayLabel(counterpartEnd, counterpartCross)} 时间冲突`);
    });
    html += `<div class="details gantt-conflict-block"><span class="gantt-conflict-owner">${escapeHtml(`${ownerLabel}：${ownerValue}`)}</span><br/>${items.join("<br/>")}</div>`;
  }
  return html;
}

// 冲突标记参与 ganttInputSignature：冲突出现/消失（counterparts 增减）必须触发甘特重渲染（规格 R4）。
function conflictSignature(plan: WorkPlan) {
  return plan.ownerConflict ? plan.ownerConflict.counterparts.map((counterpart) => counterpart.id).join(",") : "";
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
  // frappe 的 grid-background 高度公式（表头 + padding + 行高×行数 − 10）比实际行底
  // 多出 padding−10 的残差；.current-highlight 按该内部值定高且直接挂在滚动容器上，
  // 会把甘特侧最大滚动量撑得比左侧计划列表长，到底后滚动同步每刻度回拽抖动。
  // 这里把标记底边钳到裁剪后的行底，保证两侧可滚动高度一致。
  const currentHighlight = ganttContainer.querySelector<HTMLElement>(".current-highlight");
  if (currentHighlight) {
    currentHighlight.style.height = `${Math.max(0, contentHeight - PLANNER_HEADER_HEIGHT)}px`;
  }
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

    // 冲突警示类（规格 R4）：随甘特重渲染同步，冲突出现/消失即生效
    wrapper.classList.toggle("gantt-conflict", Boolean(plan.ownerConflict));

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
    // frappe-gantt paints weekend highlight rects above .grid-row, so a
    // double click on a weekend column lands on .holiday-highlight.
    if (!target.closest(".grid-row, .holiday-highlight")) return;

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

// frappe-gantt paints weekend highlight rects above .grid-row; without this the
// overlay swallows the hover hint and double-click create on weekend columns.
function disableWeekendHighlightHit(mount: HTMLElement) {
  for (const rect of mount.querySelectorAll<SVGRectElement>(".holiday-highlight")) {
    rect.style.pointerEvents = "none";
  }
}

// Frappe always creates the side-header shell, even when today/view controls
// are disabled. Its padding and sticky background can cover the top-right of
// the final date cell, so keep only a side header that contains a real control.
function removeEmptyGanttSideHeader(mount: HTMLElement) {
  const sideHeader = mount.querySelector<HTMLElement>(".side-header");
  if (!sideHeader || sideHeader.childElementCount > 0 || sideHeader.textContent?.trim()) return;
  sideHeader.remove();
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

export function alignDateHeaderContentVertically(mount: HTMLElement) {
  const header = mount.querySelector<HTMLElement>(".grid-header");
  if (!header || header.clientHeight <= 0) return;

  const headerRect = header.getBoundingClientRect();
  const contentTop = headerRect.top + header.clientTop;
  // .date-range-highlight（悬停任务时表头显示的日期范围块）平时带 .hide（display:none），
  // rect 高度为 0，但 CSS 的 calc 高度仍可解析；据此参与居中，避免显示时回落到 frappe 固定的 top。
  for (const block of mount.querySelectorAll<HTMLElement>(".lower-text, .date-range-highlight")) {
    let height = block.getBoundingClientRect().height;
    if (height <= 0) height = Number.parseFloat(getComputedStyle(block).height);
    if (!(height > 0)) continue;
    const parent = block.offsetParent instanceof HTMLElement ? block.offsetParent : block.parentElement;
    if (!parent) continue;
    const parentRect = parent.getBoundingClientRect();
    const top = contentTop - parentRect.top + (header.clientHeight - height) / 2;
    block.style.top = `${top}px`;
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
