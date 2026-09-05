// 工作计划页的浏览器偏好读写与列表几何工具：从 WorkPlansPage 拆出（纯移动，无逻辑变更）。
import type { CustomFieldDefinition, WorkPlanSortItem } from "@workplan/contracts";
import type { GanttDisplayId } from "../components/GanttTimeline";

export type BuiltInColumnId = "status" | "startAt" | "endAt";
export type ColumnId = BuiltInColumnId | `custom:${string}`;

export const columnPreferencesKey = "workplan:list-columns:v1";
export const ganttPreferencesKey = "workplan:gantt-properties:v1";
export const tooltipPreferencesKey = "workplan:gantt-tooltip:v1";
export const splitPreferencesKey = "workplan:planner-split:v1";
export const collapsePreferencesKey = "workplan:planner-collapsed:v1";
const sortPreferencesKeyPrefix = "workplan:list-sort:v1";
export const mobileViewportQuery = "(max-width: 720px)";
export const defaultColumnIds: ColumnId[] = ["status", "startAt", "endAt"];
export const defaultGanttDisplayIds: GanttDisplayId[] = [];
export const defaultTooltipDisplayIds: GanttDisplayId[] = [];
export const defaultListPercent = 44;
// 列表/分隔条几何约束（分屏百分比的定义域）。
export const minimumPaneWidth = 360;
export const dividerWidth = 8;

export const sortableBuiltInLabels: Record<string, string> = {
  title: "工作内容",
  status: "状态",
  startAt: "开始时间",
  endAt: "结束时间",
  duration: "持续时长",
  createdAt: "创建时间",
  updatedAt: "更新时间",
};
export const sortableCustomFieldTypes = new Set(["short_text", "url", "number", "boolean", "date", "datetime", "single_select"]);

export function sortPreferencesKey(accountId: string) {
  return `${sortPreferencesKeyPrefix}:${accountId}`;
}

export function loadSortPreference(accountId: string): WorkPlanSortItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(sortPreferencesKey(accountId)) ?? "null") as unknown;
    if (!saved || typeof saved !== "object") return null;
    const value = saved as { version?: unknown; sort?: unknown };
    if (value.version !== 1 || !Array.isArray(value.sort)) return null;
    const items: WorkPlanSortItem[] = [];
    const seen = new Set<string>();
    for (const raw of value.sort) {
      if (!raw || typeof raw !== "object") return null;
      const { field, direction } = raw as { field?: unknown; direction?: unknown };
      if (typeof field !== "string" || (direction !== "asc" && direction !== "desc")) return null;
      if (seen.has(field)) return null;
      seen.add(field);
      items.push({ field, direction });
    }
    return items;
  } catch {
    return null;
  }
}

export function saveSortPreference(accountId: string, items: WorkPlanSortItem[]) {
  try {
    window.localStorage.setItem(sortPreferencesKey(accountId), JSON.stringify({ version: 1, sort: items }));
  } catch {
    // 排序偏好保留到本次会话即可。
  }
}

// 逐项清理偏好：未知/归档/类型不支持的排序字段剔除，空值按缺失处理不拦截。
export function cleanSortItems(items: WorkPlanSortItem[], fields: CustomFieldDefinition[]): WorkPlanSortItem[] {
  return items.filter((item) => {
    if (item.field.startsWith("custom.")) {
      const key = item.field.slice("custom.".length);
      const field = fields.find((candidate) => candidate.key === key);
      return Boolean(field && !field.archivedAt && sortableCustomFieldTypes.has(field.type));
    }
    return item.field in sortableBuiltInLabels;
  });
}

export function loadColumnPreferences(): ColumnId[] {
  if (typeof window === "undefined") return defaultColumnIds;
  try {
    const saved = JSON.parse(window.localStorage.getItem(columnPreferencesKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object") return defaultColumnIds;
    const value = saved as { version?: unknown; visibleIds?: unknown };
    if (value.version !== 1 || !Array.isArray(value.visibleIds)) return defaultColumnIds;
    return Array.from(new Set(value.visibleIds.filter((id): id is ColumnId =>
      typeof id === "string" && (defaultColumnIds.includes(id as BuiltInColumnId) || id.startsWith("custom:")),
    )));
  } catch {
    return defaultColumnIds;
  }
}

export function loadGanttPreferences(): GanttDisplayId[] {
  if (typeof window === "undefined") return defaultGanttDisplayIds;
  try {
    const saved = JSON.parse(window.localStorage.getItem(ganttPreferencesKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object") return defaultGanttDisplayIds;
    const value = saved as { version?: unknown; visibleIds?: unknown };
    if (value.version !== 1 || !Array.isArray(value.visibleIds)) return defaultGanttDisplayIds;
    return Array.from(new Set(value.visibleIds.filter((id): id is GanttDisplayId =>
      id === "status" || id === "title" || (typeof id === "string" && id.startsWith("custom:")),
    )));
  } catch {
    return defaultGanttDisplayIds;
  }
}

export function loadTooltipPreferences(): GanttDisplayId[] {
  if (typeof window === "undefined") return defaultTooltipDisplayIds;
  try {
    const saved = JSON.parse(window.localStorage.getItem(tooltipPreferencesKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object") return defaultTooltipDisplayIds;
    const value = saved as { version?: unknown; visibleIds?: unknown };
    if (value.version !== 1 || !Array.isArray(value.visibleIds)) return defaultTooltipDisplayIds;
    return Array.from(new Set(value.visibleIds.filter((id): id is GanttDisplayId =>
      id === "status" || (typeof id === "string" && id.startsWith("custom:")),
    )));
  } catch {
    return defaultTooltipDisplayIds;
  }
}

export function loadListPercent(): number {
  if (typeof window === "undefined") return defaultListPercent;
  try {
    const saved = JSON.parse(window.localStorage.getItem(splitPreferencesKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object") return defaultListPercent;
    const value = saved as { version?: unknown; listPercent?: unknown };
    if (value.version !== 1 || typeof value.listPercent !== "number" || !Number.isFinite(value.listPercent)) return defaultListPercent;
    return clampListPercent(value.listPercent, 0);
  } catch {
    return defaultListPercent;
  }
}

export function loadCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = JSON.parse(window.localStorage.getItem(collapsePreferencesKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object") return false;
    const value = saved as { version?: unknown; collapsed?: unknown };
    if (value.version !== 1 || typeof value.collapsed !== "boolean") return false;
    return value.collapsed;
  } catch {
    return false;
  }
}

export function matchesMobileViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(mobileViewportQuery).matches;
}

export function listPercentBounds(panelWidth: number) {
  if (panelWidth <= 0) return { min: 25, max: 75 };
  const min = minimumPaneWidth / panelWidth * 100;
  const max = (panelWidth - minimumPaneWidth - dividerWidth) / panelWidth * 100;
  return min <= max ? { min, max } : { min: 50, max: 50 };
}

export function clampListPercent(percent: number, panelWidth: number) {
  const bounds = listPercentBounds(panelWidth);
  return Math.min(bounds.max, Math.max(bounds.min, percent));
}
