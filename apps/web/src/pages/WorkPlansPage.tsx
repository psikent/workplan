import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { arrayMove } from "@dnd-kit/sortable";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { CreateWorkPlan, CustomFieldDefinition, ExportTemplate, MonthlyGoal, OwnerAccountMapping, WorkPlan, WorkPlanQueryRequest, WorkPlanQueryResponse, WorkPlanSeries, WorkPlanSortItem, WorkPlanStatus } from "@workplan/contracts";
import { formatWorkPlanSortParam, parseWorkPlanSortParam } from "@workplan/contracts";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, ListFilter, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Save, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import GanttTimeline, { type GanttDisplayId, type GanttDisplayProperty } from "../components/GanttTimeline";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/ToastProvider";
import WorkPlanDrawer from "../components/WorkPlanDrawer";
import { useSession } from "../App";
import { api, downloadWorkPlansXlsCustom, fetchReminders, fileToBase64, jsonBody } from "../lib/api";
import { canWriteBusinessData } from "../lib/permissions";
import { endOfMonth, endOfWeek, formatCustomFieldValue, formatDate, startOfMonth, startOfWeek, statusLabels } from "../lib/format";

type BuiltInColumnId = "status" | "startAt" | "endAt";
type ColumnId = BuiltInColumnId | `custom:${string}`;
type PlanColumn = {
  id: ColumnId;
  label: string;
  width: number;
  field?: CustomFieldDefinition;
};
type ExportAttribute = { source: string; label: string };
type CreatedWorkPlanSeries = { series: WorkPlanSeries; generated: WorkPlan[] };
type SaveMutationResult = { created: boolean; createdPlans: WorkPlan[] };

function isTextPlanColumn(column: PlanColumn) {
  return column.field?.type === "short_text" || column.field?.type === "long_text";
}

const columnPreferencesKey = "workplan:list-columns:v1";
const ganttPreferencesKey = "workplan:gantt-properties:v1";
const tooltipPreferencesKey = "workplan:gantt-tooltip:v1";
const splitPreferencesKey = "workplan:planner-split:v1";
const collapsePreferencesKey = "workplan:planner-collapsed:v1";
const sortPreferencesKeyPrefix = "workplan:list-sort:v1";
const mobileViewportQuery = "(max-width: 720px)";
const defaultColumnIds: ColumnId[] = ["status", "startAt", "endAt"];
const defaultGanttDisplayIds: GanttDisplayId[] = [];
const defaultTooltipDisplayIds: GanttDisplayId[] = [];
const defaultListPercent = 44;
const minimumPaneWidth = 360;
const dividerWidth = 8;
const pageSize = 200;
const sortableBuiltInLabels: Record<string, string> = {
  title: "工作内容",
  status: "状态",
  startAt: "开始时间",
  endAt: "结束时间",
  duration: "持续时长",
  createdAt: "创建时间",
  updatedAt: "更新时间",
};
const sortableCustomFieldTypes = new Set(["short_text", "url", "number", "boolean", "date", "datetime", "single_select"]);
const builtInColumns: PlanColumn[] = [
  { id: "status", label: "状态", width: 89 },
  { id: "startAt", label: "开始时间", width: 96 },
  { id: "endAt", label: "结束时间", width: 96 },
];

function sortPreferencesKey(accountId: string) {
  return `${sortPreferencesKeyPrefix}:${accountId}`;
}

function loadSortPreference(accountId: string): WorkPlanSortItem[] | null {
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

function saveSortPreference(accountId: string, items: WorkPlanSortItem[]) {
  try {
    window.localStorage.setItem(sortPreferencesKey(accountId), JSON.stringify({ version: 1, sort: items }));
  } catch {
    // 排序偏好保留到本次会话即可。
  }
}

// 逐项清理偏好：未知/归档/类型不支持的排序字段剔除，空值按缺失处理不拦截。
function cleanSortItems(items: WorkPlanSortItem[], fields: CustomFieldDefinition[]): WorkPlanSortItem[] {
  return items.filter((item) => {
    if (item.field.startsWith("custom.")) {
      const key = item.field.slice("custom.".length);
      const field = fields.find((candidate) => candidate.key === key);
      return Boolean(field && !field.archivedAt && sortableCustomFieldTypes.has(field.type));
    }
    return item.field in sortableBuiltInLabels;
  });
}

function loadColumnPreferences(): ColumnId[] {
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

function loadGanttPreferences(): GanttDisplayId[] {
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

function loadTooltipPreferences(): GanttDisplayId[] {
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

function loadListPercent(): number {
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

function loadCollapsedPreference(): boolean {
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

function matchesMobileViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(mobileViewportQuery).matches;
}

function listPercentBounds(panelWidth: number) {
  if (panelWidth <= 0) return { min: 25, max: 75 };
  const min = minimumPaneWidth / panelWidth * 100;
  const max = (panelWidth - minimumPaneWidth - dividerWidth) / panelWidth * 100;
  return min <= max ? { min, max } : { min: 50, max: 50 };
}

function clampListPercent(percent: number, panelWidth: number) {
  const bounds = listPercentBounds(panelWidth);
  return Math.min(bounds.max, Math.max(bounds.min, percent));
}

function duplicateTitle(title: string) {
  const suffix = "（副本）";
  return `${title.slice(0, 200 - suffix.length)}${suffix}`;
}

function duplicateWorkPlanInput(plan: WorkPlan): CreateWorkPlan {
  return {
    title: duplicateTitle(plan.title),
    description: plan.description,
    ...(plan.statusMode === "manual" ? { status: plan.status, statusMode: "manual" as const } : { statusMode: "automatic" as const }),
    startAt: plan.startAt,
    endAt: plan.endAt,
    customFields: { ...plan.customFields },
    monthlyGoalIds: [...plan.monthlyGoalIds],
  };
}

function toLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function customFilterToQueryFilter(customFilterKey: string, customFilterValue: string, fields: CustomFieldDefinition[]): WorkPlanQueryRequest["filters"][number] | null {
  if (!customFilterKey || !customFilterValue) return null;
  const field = fields.find((candidate) => candidate.key === customFilterKey);
  if (!field) return null;
  if (field.type === "multi_select") return { field: `custom.${customFilterKey}`, op: "any", value: [customFilterValue] };
  if (field.type === "boolean") return { field: `custom.${customFilterKey}`, op: "eq", value: customFilterValue === "true" };
  if (field.type === "number") return Number.isFinite(Number(customFilterValue)) ? { field: `custom.${customFilterKey}`, op: "eq", value: Number(customFilterValue) } : null;
  return { field: `custom.${customFilterKey}`, op: "contains", value: customFilterValue };
}

function initialTimelineView(value: string | null): "week" | "month" {
  return value === "month" ? "month" : "week";
}

function initialTimelineAnchor(value: string | null) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export default function WorkPlansPage() {
  const { user } = useSession();
  const canWrite = canWriteBusinessData(user.role);
  const { showSuccess } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPlanId = searchParams.get("plan");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<WorkPlanStatus | "all">("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [customFilterKey, setCustomFilterKey] = useState("");
  const [customFilterValue, setCustomFilterValue] = useState("");
  const [view, setView] = useState<"week" | "month">(() => initialTimelineView(searchParams.get("view")));
  const [anchor, setAnchor] = useState(() => initialTimelineAnchor(searchParams.get("date")));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<WorkPlan | null>(null);
  const [newPlanDate, setNewPlanDate] = useState<Date | null>(null);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [showGanttSettings, setShowGanttSettings] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnId[]>(loadColumnPreferences);
  const [ganttDisplayIds, setGanttDisplayIds] = useState<GanttDisplayId[]>(loadGanttPreferences);
  const [tooltipDisplayIds, setTooltipDisplayIds] = useState<GanttDisplayId[]>(loadTooltipPreferences);
  const [listPercent, setListPercent] = useState(loadListPercent);
  const [resizing, setResizing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => matchesMobileViewport() || loadCollapsedPreference());
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [spreadsheetMessage, setSpreadsheetMessage] = useState("");
  const [exportPopoverOpen, setExportPopoverOpen] = useState(false);
  const [exportSources, setExportSources] = useState<string[] | null>(null);
  const [saveAsName, setSaveAsName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [showSortSettings, setShowSortSettings] = useState(false);
  const [pageCursors, setPageCursors] = useState<string[]>([]);
  const [sortNotice, setSortNotice] = useState("");
  const [preferenceItems, setPreferenceItems] = useState<WorkPlanSortItem[] | null>(null);
  const sortNoticeShownRef = useRef(false);
  const plannerPanelRef = useRef<HTMLDivElement>(null);
  const planRowsRef = useRef<HTMLDivElement>(null);
  const openedRequestedPlanIdRef = useRef<string | null>(null);

  const fieldsQuery = useQuery({ queryKey: ["custom-fields"], queryFn: () => api<CustomFieldDefinition[]>("/custom-fields") });
  // ---------- 排序状态：合法 URL → 当前账户浏览器偏好 → 默认排期顺序 ----------
  const accountId = user.id;
  const sortParam = searchParams.get("sort");
  const parsedUrlSort = useMemo(() => (sortParam === null ? undefined : parseWorkPlanSortParam(sortParam)), [sortParam]);
  const urlSortInvalid = sortParam !== null && parsedUrlSort === null;

  useEffect(() => {
    setPreferenceItems(loadSortPreference(accountId));
  }, [accountId]);

  const cleanedPreference = useMemo(
    () => (preferenceItems ? cleanSortItems(preferenceItems, fieldsQuery.data ?? []) : null),
    [fieldsQuery.data, preferenceItems],
  );
  useEffect(() => {
    // 本地偏好逐项清理失效字段：写回并只提示一次。
    if (!preferenceItems || !cleanedPreference) return;
    if (cleanedPreference.length === preferenceItems.length) return;
    saveSortPreference(accountId, cleanedPreference);
    setPreferenceItems(cleanedPreference);
    if (!sortNoticeShownRef.current) {
      sortNoticeShownRef.current = true;
      setSortNotice("浏览器偏好中的失效排序字段已清理");
    }
  }, [accountId, cleanedPreference, preferenceItems]);

  useEffect(() => {
    // 非法 URL 整体回退到排期顺序：移除参数并说明。
    if (!urlSortInvalid) return;
    const params = new URLSearchParams(searchParams);
    params.delete("sort");
    setSearchParams(params, { replace: true });
    setSortNotice("链接中的排序参数无效，已恢复默认排期顺序");
  }, [searchParams, setSearchParams, urlSortInvalid]);

  const sortItems: WorkPlanSortItem[] = parsedUrlSort ?? cleanedPreference ?? [];

  const applySort = useCallback((next: WorkPlanSortItem[]) => {
    const unique = next.filter((item, index) => next.findIndex((candidate) => candidate.field === item.field) === index);
    saveSortPreference(accountId, unique);
    setPreferenceItems(unique);
    setSortNotice("");
    const params = new URLSearchParams(searchParams);
    if (unique.length === 0) params.delete("sort");
    else params.set("sort", formatWorkPlanSortParam(unique));
    setSearchParams(params);
  }, [accountId, searchParams, setSearchParams]);

  const monthlyGoalsQuery = useQuery({ queryKey: ["monthly-goals"], queryFn: () => api<MonthlyGoal[]>("/monthly-goals") });
  const ownerAccountMappingsQuery = useQuery({ queryKey: ["owner-account-mappings"], queryFn: () => api<OwnerAccountMapping[]>("/owner-account-mappings") });
  const seriesQuery = useQuery({ queryKey: ["work-plan-series"], queryFn: () => api<WorkPlanSeries[]>("/work-plan-series") });
  const templatesQuery = useQuery({ queryKey: ["export-templates"], queryFn: () => api<ExportTemplate[]>("/export-templates") });
  const goalsById = useMemo(() => new Map((monthlyGoalsQuery.data ?? []).map((goal) => [goal.id, goal])), [monthlyGoalsQuery.data]);
  const selectedSeries = selected?.seriesId ? seriesQuery.data?.find((series) => series.id === selected.seriesId) : null;
  const availableColumns = useMemo<PlanColumn[]>(() => [
    ...builtInColumns,
    ...(fieldsQuery.data ?? []).slice()
      .filter((field) => !field.archivedAt)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((field) => ({ id: `custom:${field.key}` as const, label: field.label, width: 120, field })),
  ], [fieldsQuery.data]);
  const visibleColumns = useMemo(() => {
    const columnsById = new Map(availableColumns.map((column) => [column.id, column]));
    return visibleColumnIds.flatMap((id) => {
      const column = columnsById.get(id);
      return column ? [column] : [];
    });
  }, [availableColumns, visibleColumnIds]);
  const availableGanttProperties = useMemo<GanttDisplayProperty[]>(() => [
    { id: "title", label: "工作内容" },
    { id: "status", label: "状态" },
    ...(fieldsQuery.data ?? []).slice()
      .filter((field) => !field.archivedAt)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((field) => ({ id: `custom:${field.key}` as const, label: field.label, field })),
  ], [fieldsQuery.data]);
  // 工作内容已固定为浮动提示首行，不进入浮动提示可选项，避免重复显示。
  const availableTooltipProperties = useMemo<GanttDisplayProperty[]>(
    () => availableGanttProperties.filter((property) => property.id !== "title"),
    [availableGanttProperties],
  );
  const visibleGanttProperties = useMemo(() => {
    const propertiesById = new Map(availableGanttProperties.map((property) => [property.id, property]));
    return ganttDisplayIds.flatMap((id) => {
      const property = propertiesById.get(id);
      return property ? [property] : [];
    });
  }, [availableGanttProperties, ganttDisplayIds]);
  const visibleTooltipProperties = useMemo(() => {
    const propertiesById = new Map(availableTooltipProperties.map((property) => [property.id, property]));
    return tooltipDisplayIds.flatMap((id) => {
      const property = propertiesById.get(id);
      return property ? [property] : [];
    });
  }, [availableTooltipProperties, tooltipDisplayIds]);
  const planGridStyle = useMemo(() => ({
    "--plan-grid-template": ["minmax(180px, 1.5fr)", ...visibleColumns.map((column) => `${column.width}px`)].join(" "),
    "--plan-grid-min-width": `${180 + visibleColumns.reduce((total, column) => total + column.width, 0)}px`,
  }) as CSSProperties, [visibleColumns]);
  const range = useMemo(() => view === "week" ? [startOfWeek(anchor), endOfWeek(anchor)] : [startOfMonth(anchor), endOfMonth(anchor)], [anchor, view]);
  const rangeTitle = view === "week" ? formatWeekOfMonth(range[0]!) : `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`;
  const remindersRange = useMemo(() => {
    const lastVisibleDay = new Date(range[1]!);
    lastVisibleDay.setDate(lastVisibleDay.getDate() - 1);
    return { from: toLocalDateString(range[0]!), to: toLocalDateString(lastVisibleDay) };
  }, [range]);
  const remindersQuery = useQuery({
    queryKey: ["reminders", remindersRange.from, remindersRange.to],
    queryFn: () => fetchReminders(remindersRange.from, remindersRange.to),
    refetchInterval: 30_000,
  });
  // 服务端统一查询：搜索、筛选、半开时间范围、排序与游标分页全部交给引擎；
  // 表格与甘特共享同一份 items，前端不再二次排列。
  const queryFilters = useMemo(() => {
    const filters: WorkPlanQueryRequest["filters"] = [];
    if (status !== "all") filters.push({ field: "status", op: "eq", value: status });
    const customFilter = customFilterToQueryFilter(customFilterKey, customFilterValue, fieldsQuery.data ?? []);
    if (customFilter) filters.push(customFilter);
    return filters;
  }, [customFilterKey, customFilterValue, fieldsQuery.data, status]);
  const requestRange = useMemo(() => ({ from: range[0]!.toISOString(), to: range[1]!.toISOString() }), [range]);
  const queryRequest = useMemo<WorkPlanQueryRequest>(() => {
    const request: WorkPlanQueryRequest = {
      filters: queryFilters,
      range: requestRange,
      sort: sortItems,
      limit: pageSize,
    };
    if (deferredSearch) request.q = deferredSearch;
    const cursor = pageCursors.at(-1);
    if (cursor) request.cursor = cursor;
    return request;
  }, [deferredSearch, pageCursors, queryFilters, requestRange, sortItems]);
  const querySignature = JSON.stringify({ ...queryRequest, cursor: null });
  useEffect(() => {
    // 查询条件变化时回到第一页重新同步实时结果。
    setPageCursors([]);
  }, [querySignature]);
  const plansQuery = useQuery({
    queryKey: ["work-plans", "query", queryRequest],
    queryFn: () => api<WorkPlanQueryResponse>("/work-plans/query", { method: "POST", ...jsonBody(queryRequest) }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  // 已经成功应用的查询：仅由最近一次成功查询固化，导出与展示使用它，失败不污染。
  const appliedQueryRef = useRef<WorkPlanQueryRequest | null>(null);
  if (plansQuery.isSuccess) appliedQueryRef.current = queryRequest;
  const appliedQuery = appliedQueryRef.current;
  const appliedSort = appliedQuery?.sort ?? [];
  const plans = plansQuery.data?.items ?? [];
  const canExportPlans = plansQuery.isSuccess && !plansQuery.isFetching;
  const templates = templatesQuery.data ?? [];
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;
  const selectedTemplateCanImport = selectedTemplate
    ? ["title", "startAt", "endAt"].every((source) => selectedTemplate.columns.some((column) => column.source === source))
    : false;
  const exportAttributes = useMemo<ExportAttribute[]>(() => [
    { source: "title", label: "工作内容" },
    { source: "description", label: "说明" },
    { source: "status", label: "状态" },
    { source: "startAt", label: "开始时间" },
    { source: "endAt", label: "结束时间" },
    ...(fieldsQuery.data ?? []).slice()
      .filter((field) => !field.archivedAt)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .flatMap((field) => [
        { source: `custom:${field.key}` as const, label: field.label },
        ...(field.key === "owner" ? [{ source: "ownerAccount", label: "工作负责人账号" }] : []),
      ]),
  ], [fieldsQuery.data]);
  const selectedExportSources = exportSources ?? exportAttributes.map((attribute) => attribute.source);
  const orderedExportAttributes = useMemo(() => {
    const bySource = new Map(exportAttributes.map((attribute) => [attribute.source, attribute]));
    return [
      ...selectedExportSources.flatMap((source) => {
        const attribute = bySource.get(source);
        return attribute ? [attribute] : [];
      }),
      ...exportAttributes.filter((attribute) => !selectedExportSources.includes(attribute.source)),
    ];
  }, [exportAttributes, selectedExportSources]);

  useEffect(() => {
    if (!requestedPlanId || openedRequestedPlanIdRef.current === requestedPlanId) return;
    const requestedPlan = plans.find((plan) => plan.id === requestedPlanId);
    if (!requestedPlan) {
      // 服务端按条件分页，深链计划可能不在当前页：直接按 id 打开。
      if (!plansQuery.isSuccess) return;
      openedRequestedPlanIdRef.current = requestedPlanId;
      void api<WorkPlan>(`/work-plans/${requestedPlanId}`).then((plan) => {
        setAnchor(new Date(plan.startAt));
        setSelected(plan);
        setDrawerOpen(true);
      }).catch(() => undefined);
      return;
    }
    openedRequestedPlanIdRef.current = requestedPlanId;
    setAnchor(new Date(requestedPlan.startAt));
    setSelected(requestedPlan);
    setDrawerOpen(true);
  }, [plans, plansQuery.isSuccess, requestedPlanId]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id !== selectedTemplateId) setSelectedTemplateId(selectedTemplate.id);
  }, [selectedTemplate?.id, selectedTemplateId]);

  useEffect(() => {
    if (!exportPopoverOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportPopoverOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [exportPopoverOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(columnPreferencesKey, JSON.stringify({ version: 1, visibleIds: visibleColumnIds }));
    } catch {
      // Column preferences remain usable for this session when storage is unavailable.
    }
  }, [visibleColumnIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ganttPreferencesKey, JSON.stringify({ version: 1, visibleIds: ganttDisplayIds }));
    } catch {
      // Gantt display preferences remain usable for this session when storage is unavailable.
    }
  }, [ganttDisplayIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(splitPreferencesKey, JSON.stringify({ version: 1, listPercent }));
    } catch {
      // The adjusted layout remains usable for this session when storage is unavailable.
    }
  }, [listPercent]);

  useEffect(() => {
    if (matchesMobileViewport()) return;
    try {
      window.localStorage.setItem(collapsePreferencesKey, JSON.stringify({ version: 1, collapsed }));
    } catch {
      // The collapsed layout remains usable for this session when storage is unavailable.
    }
  }, [collapsed]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(mobileViewportQuery);
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setCollapsed(event.matches || loadCollapsedPreference());
    };
    query.addEventListener("change", handleViewportChange);
    return () => query.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(tooltipPreferencesKey, JSON.stringify({ version: 1, visibleIds: tooltipDisplayIds }));
    } catch {
      // Tooltip preferences remain usable for this session when storage is unavailable.
    }
  }, [tooltipDisplayIds]);

  useEffect(() => {
    const panel = plannerPanelRef.current;
    if (!panel) return;
    const fitToPanel = (width: number) => {
      setListPercent((current) => {
        const next = clampListPercent(current, width);
        return Math.abs(next - current) < 0.01 ? current : next;
      });
    };
    fitToPanel(panel.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => fitToPanel(entry?.contentRect.width ?? panel.getBoundingClientRect().width));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const saveMutation = useMutation<SaveMutationResult, Error, { input: CreateWorkPlan & { version?: number }; recurrence: { frequency: "daily" | "weekly" | "monthly"; interval: number; timeZone: string } | null }>({
    mutationFn: async ({ input, recurrence }) => {
      const { version: _version, ...workPlan } = input;
      if (!selected) {
        if (recurrence) {
          const result = await api<CreatedWorkPlanSeries>("/work-plan-series", { method: "POST", ...jsonBody({ workPlan, recurrence }) });
          return { created: true, createdPlans: result.generated };
        }
        const created = await api<WorkPlan>("/work-plans", { method: "POST", ...jsonBody(workPlan) });
        return { created: true, createdPlans: [created] };
      }
      if (!selected.seriesId) {
        if (recurrence) {
          await api(`/work-plans/${selected.id}/series`, { method: "POST", ...jsonBody({ workPlan, recurrence, version: selected.version }) });
          return { created: false, createdPlans: [] };
        }
        await api<WorkPlan>(`/work-plans/${selected.id}`, { method: "PATCH", ...jsonBody(input) });
        return { created: false, createdPlans: [] };
      }
      if (!selectedSeries) throw new Error("计划周期信息尚未加载，请稍后重试");
      await api<WorkPlan>(`/work-plans/${selected.id}`, { method: "PATCH", ...jsonBody(input) });
      if (recurrence) {
        await api(`/work-plan-series/${selectedSeries.id}`, { method: "PATCH", ...jsonBody({ workPlan, recurrence, version: selectedSeries.version }) });
      } else if (selectedSeries.active) {
        await api(`/work-plan-series/${selectedSeries.id}?version=${selectedSeries.version}`, { method: "DELETE" });
      }
      return { created: false, createdPlans: [] };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["work-plans"] });
      await queryClient.invalidateQueries({ queryKey: ["workbench-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["work-plan-series"] });
      await queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
      setDrawerOpen(false);
      setSelected(null);
      setNewPlanDate(null);
      const createdPlanVisible = result.createdPlans.some((plan) => {
        const searchHit = !deferredSearch || `${plan.title} ${plan.description}`.toLocaleLowerCase().includes(deferredSearch.toLocaleLowerCase());
        const statusHit = status === "all" || plan.status === status;
        const rangeHit = Date.parse(plan.endAt) > range[0]!.getTime() && Date.parse(plan.startAt) < range[1]!.getTime();
        const customHit = !customFilterKey || !customFilterValue || (() => {
          const field = (fieldsQuery.data ?? []).find((candidate) => candidate.key === customFilterKey);
          const actual = plan.customFields[customFilterKey];
          if (field?.type === "multi_select") return Array.isArray(actual) && actual.includes(customFilterValue);
          if (field?.type === "boolean") return String(actual) === customFilterValue;
          if (field?.type === "number") return Number(actual) === Number(customFilterValue);
          return String(actual ?? "").toLocaleLowerCase().includes(customFilterValue.toLocaleLowerCase());
        })();
        return searchHit && statusHit && rangeHit && customHit;
      });
      showSuccess(result.created && !createdPlanVisible
        ? "工作计划已创建，但在当前时间范围或筛选条件下不可见"
        : "工作计划已保存");
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ plan, startAt, endAt }: { plan: WorkPlan; startAt: string; endAt: string }) =>
      api<WorkPlan>(`/work-plans/${plan.id}/schedule`, { method: "PATCH", ...jsonBody({ startAt, endAt, version: plan.version }) }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-plans"] });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (plan: WorkPlan) => api<WorkPlan>("/work-plans", { method: "POST", ...jsonBody(duplicateWorkPlanInput(plan)) }),
    onSuccess: async (copied) => {
      await queryClient.invalidateQueries({ queryKey: ["work-plans"] });
      setSelected(copied);
      setDrawerOpen(true);
      showSuccess("工作计划已复制");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (plan: WorkPlan) => api(`/work-plans/${plan.id}?version=${plan.version}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-plans"] });
      setDrawerOpen(false);
      setSelected(null);
      showSuccess("工作计划已删除");
    },
  });

  const handleScheduleChange = useCallback((plan: WorkPlan, startAt: string, endAt: string) => {
    if (!canWrite) return;
    scheduleMutation.mutate({ plan, startAt, endAt });
  }, [canWrite, scheduleMutation.mutate]);
  const handleSelect = useCallback((plan: WorkPlan) => {
    setNewPlanDate(null);
    setSelected(plan);
    setDrawerOpen(true);
  }, []);
  const handleReminderSelect = useCallback((planId: string) => {
    const plan = plans.find((item) => item.id === planId);
    if (plan) {
      handleSelect(plan);
      return;
    }
    void api<WorkPlan>(`/work-plans/${planId}`).then(handleSelect).catch(() => undefined);
  }, [handleSelect, plans]);
  const handleCreateAt = useCallback((date: Date) => {
    if (!canWrite) return;
    setSelected(null);
    setNewPlanDate(date);
    setDrawerOpen(true);
  }, [canWrite]);

  function toggleTaskList() {
    setCollapsed((current) => !current);
  }

  function shiftRange(direction: -1 | 1) {
    setAnchor((current) => {
      const next = new Date(current);
      if (view === "week") next.setDate(next.getDate() + 7 * direction);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  }

  function openExportPopover() {
    if (!selectedTemplate) return;
    const seeded = selectedTemplate.columns
      .map((column) => column.source)
      .filter((source) => exportAttributes.some((attribute) => attribute.source === source));
    setExportSources(seeded);
    setSaveAsName(`${selectedTemplate.name}（副本）`);
    setExportPopoverOpen(true);
  }

  function toggleExportSource(source: string) {
    setExportSources((current) => {
      const base = current ?? exportAttributes.map((attribute) => attribute.source);
      return base.includes(source) ? base.filter((item) => item !== source) : [...base, source];
    });
  }

  function moveExportSource(source: string, direction: -1 | 1) {
    setExportSources((current) => {
      const base = current ?? exportAttributes.map((attribute) => attribute.source);
      const index = base.indexOf(source);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= base.length) return base;
      const next = [...base];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  }

  function buildSelectedExportColumns() {
    const attributesBySource = new Map(exportAttributes.map((attribute) => [attribute.source, attribute]));
    const templateHeadersBySource = new Map(selectedTemplate?.columns.map((column) => [column.source, column.header]));
    return (exportSources ?? []).flatMap((source) => {
      const attribute = attributesBySource.get(source);
      return attribute ? [{ source, header: templateHeadersBySource.get(source) ?? attribute.label }] : [];
    });
  }

  async function exportXls() {
    const sources = exportSources ?? [];
    if (sources.length === 0) return;
    if (!appliedQuery) {
      setSpreadsheetMessage("当前查询尚未成功应用，暂不能导出");
      return;
    }
    const { limit: _limit, cursor: _cursor, ...exportQuery } = appliedQuery;
    setExporting(true);
    setSpreadsheetMessage("正在生成 XLS…");
    try {
      const columns = buildSelectedExportColumns();
      await downloadWorkPlansXlsCustom(columns, selectedTemplate?.sheetName ?? "工作计划", selectedTemplate?.name ?? "导出", {
        query: exportQuery,
      });
      setSpreadsheetMessage("已导出当前时间范围");
      setExportPopoverOpen(false);
      showSuccess("XLS 已导出");
    } catch (caught) {
      setSpreadsheetMessage(caught instanceof Error ? caught.message : "导出 XLS 失败");
    } finally {
      setExporting(false);
    }
  }

  const saveAsTemplate = useMutation({
    mutationFn: () => {
      const sources = exportSources ?? [];
      if (sources.length === 0) throw new Error("请至少选择一个导出属性");
      const columns = buildSelectedExportColumns();
      return api<ExportTemplate>("/export-templates", {
        method: "POST",
        ...jsonBody({ name: saveAsName.trim(), sheetName: selectedTemplate?.sheetName ?? "工作计划", columns }),
      });
    },
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setSelectedTemplateId(template.id);
      setSpreadsheetMessage(`已另存为模板“${template.name}”`);
      showSuccess("模板已保存");
    },
  });

  async function importXls(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedTemplate) return;
    if (file.size > 6_000_000) {
      setSpreadsheetMessage("XLS 文件不能超过 6 MB");
      event.target.value = "";
      return;
    }
    if (!window.confirm(`将按“${selectedTemplate.name}”把 ${file.name} 中的工作计划新增到当前数据，任意一行有误时整批不会导入。继续吗？`)) {
      setSpreadsheetMessage("已取消导入");
      event.target.value = "";
      return;
    }
    setSpreadsheetMessage("正在校验并导入 XLS…");
    try {
      const result = await api<{ imported: number }>("/work-plans/import.xls", {
        method: "POST",
        ...jsonBody({ templateId: selectedTemplate.id, fileName: file.name, dataBase64: await fileToBase64(file) }),
      });
      await queryClient.invalidateQueries({ queryKey: ["work-plans"] });
      setSpreadsheetMessage(`导入完成，共新增 ${result.imported} 条工作计划`);
      showSuccess("XLS 导入成功");
    } catch (caught) {
      setSpreadsheetMessage(caught instanceof Error ? caught.message : "导入 XLS 失败");
    } finally {
      event.target.value = "";
    }
  }

  function toggleColumn(id: ColumnId) {
    setVisibleColumnIds((current) => current.includes(id) ? current.filter((columnId) => columnId !== id) : [...current, id]);
  }

  function moveColumn(id: ColumnId, direction: -1 | 1) {
    setVisibleColumnIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      return arrayMove(current, index, nextIndex);
    });
  }

  function toggleGanttProperty(id: GanttDisplayId) {
    setGanttDisplayIds((current) => current.includes(id) ? current.filter((propertyId) => propertyId !== id) : [...current, id]);
  }

  function moveGanttProperty(id: GanttDisplayId, direction: -1 | 1) {
    setGanttDisplayIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      return arrayMove(current, index, nextIndex);
    });
  }

  function toggleTooltipProperty(id: GanttDisplayId) {
    setTooltipDisplayIds((current) => current.includes(id) ? current.filter((propertyId) => propertyId !== id) : [...current, id]);
  }

  function moveTooltipProperty(id: GanttDisplayId, direction: -1 | 1) {
    setTooltipDisplayIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      return arrayMove(current, index, nextIndex);
    });
  }

  const updateListWidth = useCallback((clientX: number) => {
    const rect = plannerPanelRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setListPercent(clampListPercent((clientX - rect.left) / rect.width * 100, rect.width));
  }, []);

  function handleDividerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
    updateListWidth(event.clientX);
  }

  function handleDividerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateListWidth(event.clientX);
  }

  function handleDividerPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      updateListWidth(event.clientX);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
  }

  function handleDividerPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setResizing(false);
  }

  function handleDividerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const panelWidth = plannerPanelRef.current?.getBoundingClientRect().width ?? 0;
    const bounds = listPercentBounds(panelWidth);
    let next: number | undefined;
    if (event.key === "ArrowLeft") next = listPercent - 2;
    if (event.key === "ArrowRight") next = listPercent + 2;
    if (event.key === "Home") next = bounds.min;
    if (event.key === "End") next = bounds.max;
    if (next === undefined) return;
    event.preventDefault();
    setListPercent(clampListPercent(next, panelWidth));
  }

  return (
    <section className="work-plans-page">
      <header className="page-header">
        <div><h1>工作计划</h1><p>安排时间，拖动调整，持续跟进。</p></div>
        <div className="header-actions work-plan-header-actions">
          <select aria-label="Excel 导入导出模板" value={selectedTemplate?.id ?? ""} disabled={templatesQuery.isLoading || templates.length === 0} onChange={(event) => setSelectedTemplateId(event.target.value)}>
            {templates.length === 0 ? <option value="">正在载入模板</option> : templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <div className="export-popover-wrap">
            <button className="secondary-button" type="button" disabled={!selectedTemplate} aria-haspopup="dialog" aria-expanded={exportPopoverOpen} onClick={() => (exportPopoverOpen ? setExportPopoverOpen(false) : openExportPopover())} title={user.role === "admin" ? "选择要导出的属性，可另存为模板" : "选择要导出的属性"}><Download />导出 XLS</button>
            {exportPopoverOpen ? (
              <>
                <div className="export-popover-backdrop" onClick={() => setExportPopoverOpen(false)} />
                <div className="export-popover" role="dialog" aria-label="导出 XLS">
                  <header><strong>导出 XLS</strong><small>当前时间范围、搜索词与状态筛选结果</small></header>
                  <div className="export-attribute-list">
                    {orderedExportAttributes.map((attribute) => {
                      const index = selectedExportSources.indexOf(attribute.source);
                      const checked = index >= 0;
                      return (
                        <div className="export-attribute-row" key={attribute.source}>
                          <label>
                            <input type="checkbox" aria-label={`导出 ${attribute.label}`} checked={checked} onChange={() => toggleExportSource(attribute.source)} />
                            <span>{attribute.label}</span>
                          </label>
                          <span className="export-column-actions">
                            <button type="button" aria-label={`上移导出列 ${attribute.label}`} disabled={!checked || index <= 0} onClick={() => moveExportSource(attribute.source, -1)}><ArrowUp /></button>
                            <button type="button" aria-label={`下移导出列 ${attribute.label}`} disabled={!checked || index === selectedExportSources.length - 1} onClick={() => moveExportSource(attribute.source, 1)}><ArrowDown /></button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <footer>
                    {user.role === "admin" ? (
                      <span className="export-save-as">
                        <input value={saveAsName} onChange={(event) => setSaveAsName(event.target.value)} placeholder="新模板名称" aria-label="另存为模板名称" />
                        <button className="secondary-button" type="button" disabled={!saveAsName.trim() || saveAsTemplate.isPending} onClick={() => saveAsTemplate.mutate()}><Save />另存为模板</button>
                      </span>
                    ) : <span />}
                    <button className="primary-button" type="button" disabled={(exportSources ?? []).length === 0 || exporting || !canExportPlans} title={canExportPlans ? undefined : "当前查询尚未成功应用"} onClick={() => void exportXls()}>导出</button>
                  </footer>
                  {saveAsTemplate.error ? <div className="form-error">{saveAsTemplate.error.message}</div> : null}
                </div>
              </>
            ) : null}
          </div>
          {user.role === "admin" ? <label className={`secondary-button file-button ${!selectedTemplateCanImport ? "disabled" : ""}`} title={selectedTemplateCanImport ? "按所选模板新增工作计划" : "导入模板必须包含工作内容、开始时间和结束时间"}><Upload />导入 XLS<input type="file" accept="application/vnd.ms-excel,.xls" disabled={!selectedTemplateCanImport} onChange={(event) => void importXls(event)} /></label> : null}
          {canWrite ? <button className="primary-button" type="button" onClick={() => { setSelected(null); setNewPlanDate(null); setDrawerOpen(true); }}><Plus />新建工作计划</button> : null}
        </div>
      </header>
      {canWrite ? null : <p className="read-only-hint" role="note">当前账户为只读账户：可查询、筛选、查看详情和导出，不能新建或修改工作计划。</p>}
      {spreadsheetMessage ? <div className="spreadsheet-transfer-message" role="status">{spreadsheetMessage}</div> : null}
      <div className="filter-toolbar">
        <label className="search-control"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工作计划" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className={`secondary-button compact-button ${showAdvancedFilters ? "selected" : ""}`} type="button" onClick={() => setShowAdvancedFilters((value) => !value)}><SlidersHorizontal />筛选</button>
        <button className="text-button" type="button" onClick={() => { setSearch(""); setStatus("all"); setCustomFilterKey(""); setCustomFilterValue(""); }}>重置</button>
        <div className="column-settings-wrap sort-settings-wrap">
          <button className={`secondary-button compact-button ${showSortSettings ? "selected" : ""}`} type="button" aria-label="排序设置" aria-haspopup="dialog" aria-expanded={showSortSettings} onClick={() => setShowSortSettings((value) => !value)}><ArrowUpDown />排序</button>
        </div>
      </div>
      {sortNotice ? <div className="spreadsheet-transfer-message" role="status">{sortNotice}</div> : null}
      {plansQuery.isError ? (
        <div className="spreadsheet-transfer-message" role="alert">
          加载工作计划失败，当前显示的是最近一次成功结果。
          <button className="text-button" type="button" onClick={() => void plansQuery.refetch()}>重试</button>
        </div>
      ) : null}
      {showSortSettings ? (
        <SortSettings
          items={sortItems}
          fields={fieldsQuery.data ?? []}
          appliedItems={appliedSort}
          queryFailed={plansQuery.isError}
          onChange={applySort}
          onClose={() => setShowSortSettings(false)}
        />
      ) : null}
      {showAdvancedFilters ? (
        <div className="advanced-filter-panel">
          <strong>自定义字段筛选</strong>
          <select value={customFilterKey} onChange={(event) => { setCustomFilterKey(event.target.value); setCustomFilterValue(""); }}><option value="">选择字段</option>{fieldsQuery.data?.filter((field) => !field.archivedAt).map((field) => <option key={field.id} value={field.key}>{field.label}</option>)}</select>
          <CustomFilterValue field={fieldsQuery.data?.find((field) => field.key === customFilterKey)} value={customFilterValue} onChange={setCustomFilterValue} />
        </div>
      ) : null}

      <div
        ref={plannerPanelRef}
        className={`planner-panel view-${view} ${collapsed ? "planner-collapsed" : ""} ${resizing ? "resizing" : ""}`}
        style={{ "--planner-list-width": `${listPercent}%` } as CSSProperties}
      >
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <button className="icon-button planner-collapse-button" type="button" aria-label={collapsed ? "展开任务列表" : "收起任务列表"} aria-expanded={!collapsed} title={collapsed ? "展开任务列表" : "收起任务列表"} onClick={toggleTaskList}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
            <div className="range-controls"><button className="icon-button" type="button" aria-label="上一时间范围" onClick={() => shiftRange(-1)}><ChevronLeft /></button><button className="secondary-button today-button" type="button" onClick={() => setAnchor(new Date())}>今天</button><button className="icon-button" type="button" aria-label="下一时间范围" onClick={() => shiftRange(1)}><ChevronRight /></button></div>
          </div>
          <strong>{rangeTitle}</strong>
          <div className="table-toolbar-actions">
            <div className="column-settings-wrap list-column-settings">
              <button className={`icon-button column-settings-button ${showColumnSettings ? "selected" : ""}`} type="button" aria-label="列设置" aria-expanded={showColumnSettings} onClick={() => setShowColumnSettings((value) => !value)}><Columns3 /></button>
              {showColumnSettings ? <ColumnSettings columns={availableColumns} visibleIds={visibleColumnIds} onToggle={toggleColumn} onMove={moveColumn} onReset={() => setVisibleColumnIds(defaultColumnIds)} /> : null}
            </div>
            <div className="view-switch" role="tablist" aria-label="时间轴视图">
              <button className={view === "week" ? "active" : ""} type="button" role="tab" aria-selected={view === "week"} onClick={() => setView("week")}>周视图</button>
              <button className={view === "month" ? "active" : ""} type="button" role="tab" aria-selected={view === "month"} onClick={() => setView("month")}>月视图</button>
            </div>
            <div className="column-settings-wrap">
              <button className={`icon-button column-settings-button ${showGanttSettings ? "selected" : ""}`} type="button" aria-label="甘特条属性" aria-expanded={showGanttSettings} title="甘特图显示设置" onClick={() => setShowGanttSettings((value) => !value)}><ListFilter /></button>
              {showGanttSettings ? <GanttPropertySettings properties={availableGanttProperties} tooltipProperties={availableTooltipProperties} visibleIds={ganttDisplayIds} onToggle={toggleGanttProperty} onMove={moveGanttProperty} onReset={() => setGanttDisplayIds(defaultGanttDisplayIds)} tooltipVisibleIds={tooltipDisplayIds} onToggleTooltip={toggleTooltipProperty} onMoveTooltip={moveTooltipProperty} onResetTooltip={() => setTooltipDisplayIds(defaultTooltipDisplayIds)} /> : null}
            </div>
          </div>
        </div>
        <div className="planner-table">
          <div className="plan-grid-scroll" style={planGridStyle}>
            <div className="planner-columns"><span>工作内容</span>{visibleColumns.map((column) => <span key={column.id}>{column.label}</span>)}</div>
            <div ref={planRowsRef} className="plan-rows">
              {plans.map((plan) => <PlanRow key={plan.id} plan={plan} columns={visibleColumns} goalsById={goalsById} onSelect={handleSelect} />)}
              {!plansQuery.isLoading && plans.length === 0 ? <div className="plan-list-empty">这个时间范围还没有工作计划</div> : null}
            </div>
          </div>
          <footer className="table-footer">
            <span>共 {plansQuery.data ? plansQuery.data.total : "…"} 条</span>
            <span className="table-pagination">
              <button className="text-button" type="button" disabled={pageCursors.length === 0 || plansQuery.isFetching} onClick={() => setPageCursors((current) => current.slice(0, -1))}>上一页</button>
              <button className="text-button" type="button" disabled={!plansQuery.data?.nextCursor || plansQuery.isFetching} onClick={() => setPageCursors((current) => (plansQuery.data?.nextCursor ? [...current, plansQuery.data.nextCursor] : current))}>下一页</button>
            </span>
            <span>{plansQuery.isFetching ? "正在加载…" : plansQuery.isError ? "加载失败" : scheduleMutation.isPending ? "正在保存排程…" : "所有更改已保存"}</span>
          </footer>
        </div>
        <div
          className="planner-divider"
          role="separator"
          aria-label="调整列表和时间轴宽度"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(listPercent)}
          aria-valuetext={`列表宽度 ${Math.round(listPercent)}%`}
          tabIndex={0}
          title="拖动调整宽度，双击恢复默认"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerEnd}
          onPointerCancel={handleDividerPointerCancel}
          onKeyDown={handleDividerKeyDown}
          onDoubleClick={() => setListPercent(defaultListPercent)}
        />
        <div className="planner-timeline">
          <GanttTimeline plans={plans} reminders={remindersQuery.data?.days ?? []} displayProperties={visibleGanttProperties} tooltipProperties={visibleTooltipProperties} view={view} rangeStart={range[0]!} rangeEnd={range[1]!} verticalScrollPeerRef={planRowsRef} taskListCollapsed={collapsed} onScheduleChange={handleScheduleChange} onSelect={handleSelect} onReminderSelect={handleReminderSelect} onCreateAt={handleCreateAt} readOnly={!canWrite} />
        </div>
      </div>

      <WorkPlanDrawer
        plan={selected}
        series={selected?.seriesId ? (seriesQuery.isLoading ? undefined : selectedSeries ?? null) : null}
        fields={fieldsQuery.data ?? []}
        monthlyGoals={monthlyGoalsQuery.data ?? []}
        monthlyGoalsLoading={monthlyGoalsQuery.isLoading}
        initialDate={newPlanDate}
        ownerAccountMappings={ownerAccountMappingsQuery.data ?? []}
        ownerAccountMappingsLoading={ownerAccountMappingsQuery.isLoading}
        ownerAccountMappingsError={ownerAccountMappingsQuery.isError}
        open={drawerOpen}
        saving={saveMutation.isPending || duplicateMutation.isPending}
        readOnly={!canWrite}
        onClose={() => { setDrawerOpen(false); setSelected(null); setNewPlanDate(null); }}
        onSave={async (input, recurrence) => {
          if (!canWrite) return;
          await saveMutation.mutateAsync({ input, recurrence });
        }}
        onDuplicate={canWrite ? async (plan) => {
          await duplicateMutation.mutateAsync(plan);
        } : undefined}
        onDelete={canWrite ? async (plan) => {
          if (window.confirm(`确定删除“${plan.title}”吗？`)) await deleteMutation.mutateAsync(plan);
        } : undefined}
      />
    </section>
  );
}

function PlanRow({ plan, columns, goalsById, onSelect }: { plan: WorkPlan; columns: PlanColumn[]; goalsById: Map<string, MonthlyGoal>; onSelect: (plan: WorkPlan) => void }) {
  const chips = plan.monthlyGoalIds.flatMap((id) => {
    const goal = goalsById.get(id);
    return goal ? [goal] : [];
  });
  return (
    <div className="plan-row" data-plan-id={plan.id}>
      <div className="plan-row-title-cell">
        <button className="plan-title-button" type="button" onClick={() => onSelect(plan)}><strong>{plan.title}</strong></button>
        {chips.length > 0 ? (
          <div className="plan-row-goal-chips">
            {chips.map((goal) => <Link key={goal.id} className="goal-chip" to="/monthly-goals" title={`${goal.year} 年 ${goal.month} 月 · ${goal.title}`}>{goal.title}</Link>)}
          </div>
        ) : null}
      </div>
      {columns.map((column) => <PlanColumnValue key={column.id} column={column} plan={plan} />)}
    </div>
  );
}

function SortSettings({ items, fields, appliedItems, queryFailed, onChange, onClose }: {
  items: WorkPlanSortItem[];
  fields: CustomFieldDefinition[];
  appliedItems: WorkPlanSortItem[];
  queryFailed: boolean;
  onChange: (items: WorkPlanSortItem[]) => void;
  onClose: () => void;
}) {
  const labelOf = (field: string) => {
    if (field.startsWith("custom.")) {
      const definition = fields.find((candidate) => candidate.key === field.slice("custom.".length));
      return definition ? `${definition.label}（自定义）` : field;
    }
    return sortableBuiltInLabels[field] ?? field;
  };
  const availableFieldKeys = [
    ...Object.keys(sortableBuiltInLabels),
    ...fields
      .filter((field) => !field.archivedAt && sortableCustomFieldTypes.has(field.type))
      .map((field) => `custom.${field.key}`),
  ];
  const addable = availableFieldKeys.filter((key) => !items.some((item) => item.field === key));
  const sameSort = (left: WorkPlanSortItem[], right: WorkPlanSortItem[]) =>
    left.length === right.length && left.every((item, index) => item.field === right[index]?.field && item.direction === right[index]?.direction);
  const defaultActive = items.length === 0;

  return (
    <div className="advanced-filter-panel sort-panel" role="dialog" aria-label="排序设置">
      <header className="sort-panel-head">
        <div>
          <strong>排序</strong>
          <small>{defaultActive ? "当前：排期顺序（默认）" : `当前按 ${items.map((item) => labelOf(item.field)).join(" → ")} 排序`}</small>
        </div>
        <span className="sort-panel-actions">
          {defaultActive ? null : <button className="text-button" type="button" onClick={() => onChange([])}><RotateCcw />恢复默认</button>}
          <button className="text-button" type="button" onClick={onClose}>关闭</button>
        </span>
      </header>
      {queryFailed && !sameSort(items, appliedItems) ? <div className="form-error" role="status">最近一次排序未应用成功，表格仍按之前的顺序显示。</div> : null}
      {items.length === 0 ? <p className="sort-panel-hint">未添加排序项时，表格与甘特图按默认排期顺序显示。</p> : null}
      <ol className="sort-item-list">
        {items.map((item, index) => (
          <li className="sort-item-row" key={item.field}>
            <span className="sort-item-rank" aria-hidden>{index + 1}</span>
            <span className="sort-item-label">{labelOf(item.field)}</span>
            <button
              type="button"
              aria-label={`${labelOf(item.field)} 方向 ${item.direction === "asc" ? "升序，点击改为降序" : "降序，点击改为升序"}`}
              onClick={() => onChange(items.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, direction: candidate.direction === "asc" ? "desc" as const : "asc" as const } : candidate)))}
            >
              {item.direction === "asc" ? <ArrowUp /> : <ArrowDown />}{item.direction === "asc" ? "升序" : "降序"}
            </button>
            <span className="column-order-actions">
              <button type="button" aria-label={`上移 ${labelOf(item.field)}`} disabled={index <= 0} onClick={() => onChange(arrayMove(items, index, index - 1))}><ArrowUp /></button>
              <button type="button" aria-label={`下移 ${labelOf(item.field)}`} disabled={index < 0 || index === items.length - 1} onClick={() => onChange(arrayMove(items, index, index + 1))}><ArrowDown /></button>
              <button type="button" aria-label={`移除 ${labelOf(item.field)}`} onClick={() => onChange(items.filter((_, candidateIndex) => candidateIndex !== index))}>移除</button>
            </span>
          </li>
        ))}
      </ol>
      <div className="sort-add-row">
        <select
          aria-label="添加排序字段"
          value=""
          disabled={items.length >= 5 || addable.length === 0}
          onChange={(event) => {
            if (!event.target.value) return;
            onChange([...items, { field: event.target.value, direction: "asc" }]);
            event.target.value = "";
          }}
        >
          <option value="">{items.length >= 5 ? "最多五项排序" : "添加排序字段"}</option>
          {addable.map((key) => <option key={key} value={key}>{labelOf(key)}</option>)}
        </select>
        <small>最多五项，从上到下是优先级；并列时按默认排期顺序兜底。</small>
      </div>
    </div>
  );
}

function ColumnSettings({ columns, visibleIds, onToggle, onMove, onReset }: {
  columns: PlanColumn[];
  visibleIds: ColumnId[];
  onToggle: (id: ColumnId) => void;
  onMove: (id: ColumnId, direction: -1 | 1) => void;
  onReset: () => void;
}) {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const orderedColumns = [
    ...visibleIds.flatMap((id) => {
      const column = columnsById.get(id);
      return column ? [column] : [];
    }),
    ...columns.filter((column) => !visibleIds.includes(column.id)),
  ];
  return (
    <div className="column-settings-popover" role="dialog" aria-label="列设置">
      <header><div><strong>列设置</strong><small>选择显示内容并调整顺序</small></div><button className="text-button" type="button" onClick={onReset}><RotateCcw />恢复默认</button></header>
      <div className="column-settings-list">
        <label className="column-setting-row fixed"><input type="checkbox" checked disabled /><span>工作内容</span><small>固定</small></label>
        {orderedColumns.map((column) => {
          const checked = visibleIds.includes(column.id);
          const visibleIndex = visibleIds.indexOf(column.id);
          return (
            <div className="column-setting-row" key={column.id}>
              <label><input type="checkbox" checked={checked} onChange={() => onToggle(column.id)} /><span>{column.label}</span></label>
              {column.field ? <small>自定义字段</small> : null}
              <div className="column-order-actions">
                <button type="button" aria-label={`上移 ${column.label}`} disabled={!checked || visibleIndex <= 0} onClick={() => onMove(column.id, -1)}><ArrowUp /></button>
                <button type="button" aria-label={`下移 ${column.label}`} disabled={!checked || visibleIndex < 0 || visibleIndex === visibleIds.length - 1} onClick={() => onMove(column.id, 1)}><ArrowDown /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GanttPropertySettings({ properties, tooltipProperties, visibleIds, onToggle, onMove, onReset, tooltipVisibleIds, onToggleTooltip, onMoveTooltip, onResetTooltip }: {
  properties: GanttDisplayProperty[];
  tooltipProperties: GanttDisplayProperty[];
  visibleIds: GanttDisplayId[];
  onToggle: (id: GanttDisplayId) => void;
  onMove: (id: GanttDisplayId, direction: -1 | 1) => void;
  onReset: () => void;
  tooltipVisibleIds: GanttDisplayId[];
  onToggleTooltip: (id: GanttDisplayId) => void;
  onMoveTooltip: (id: GanttDisplayId, direction: -1 | 1) => void;
  onResetTooltip: () => void;
}) {
  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const tooltipPropertiesById = new Map(tooltipProperties.map((property) => [property.id, property]));
  const orderedProperties = [
    ...visibleIds.flatMap((id) => {
      const property = propertiesById.get(id);
      return property ? [property] : [];
    }),
    ...properties.filter((property) => !visibleIds.includes(property.id)),
  ];
  const orderedTooltipProperties = [
    ...tooltipVisibleIds.flatMap((id) => {
      const property = tooltipPropertiesById.get(id);
      return property ? [property] : [];
    }),
    ...tooltipProperties.filter((property) => !tooltipVisibleIds.includes(property.id)),
  ];
  return (
    <div className="column-settings-popover gantt-property-popover" role="dialog" aria-label="甘特条属性">
      <header><div><strong>甘特条属性</strong><small>选择并排序甘特条内显示的内容</small></div><button className="text-button" type="button" onClick={onReset}><RotateCcw />清空</button></header>
      <div className="column-settings-list">
        {orderedProperties.map((property) => {
          const checked = visibleIds.includes(property.id);
          const visibleIndex = visibleIds.indexOf(property.id);
          return (
            <div className="column-setting-row" key={property.id}>
              <label><input type="checkbox" checked={checked} onChange={() => onToggle(property.id)} /><span>{property.label}</span></label>
              {property.field ? <small>自定义字段</small> : <small>内置属性</small>}
              <div className="column-order-actions">
                <button type="button" aria-label={`上移甘特属性 ${property.label}`} disabled={!checked || visibleIndex <= 0} onClick={() => onMove(property.id, -1)}><ArrowUp /></button>
                <button type="button" aria-label={`下移甘特属性 ${property.label}`} disabled={!checked || visibleIndex < 0 || visibleIndex === visibleIds.length - 1} onClick={() => onMove(property.id, 1)}><ArrowDown /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="gantt-popover-section">
        <div className="gantt-popover-section-head">
          <div><strong>甘特条浮动提示</strong><small>选择并排序悬停提示内显示的内容</small></div>
          <button className="text-button" type="button" onClick={onResetTooltip}><RotateCcw />清空</button>
        </div>
        <div className="column-settings-list">
          {orderedTooltipProperties.map((property) => {
            const checked = tooltipVisibleIds.includes(property.id);
            const visibleIndex = tooltipVisibleIds.indexOf(property.id);
            return (
              <div className="column-setting-row" key={property.id}>
                <label><input type="checkbox" aria-label={`浮动提示 ${property.label}`} checked={checked} onChange={() => onToggleTooltip(property.id)} /><span>{property.label}</span></label>
                {property.field ? <small>自定义字段</small> : <small>内置属性</small>}
                <div className="column-order-actions">
                  <button type="button" aria-label={`上移浮动提示 ${property.label}`} disabled={!checked || visibleIndex <= 0} onClick={() => onMoveTooltip(property.id, -1)}><ArrowUp /></button>
                  <button type="button" aria-label={`下移浮动提示 ${property.label}`} disabled={!checked || visibleIndex < 0 || visibleIndex === tooltipVisibleIds.length - 1} onClick={() => onMoveTooltip(property.id, 1)}><ArrowDown /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlanColumnValue({ column, plan }: { column: PlanColumn; plan: WorkPlan }) {
  if (column.id === "status") return <span className="plan-cell-centered"><StatusBadge status={plan.status} /></span>;
  if (column.id === "startAt") return <time className="plan-cell-centered">{formatDate(plan.startAt)}</time>;
  if (column.id === "endAt") return <time className="plan-cell-centered">{formatDate(plan.endAt)}</time>;
  const value = formatCustomFieldValue(plan.customFields[column.field!.key], column.field!);
  return <span className={isTextPlanColumn(column) ? "plan-cell" : "plan-cell plan-cell-centered"} title={value}>{value}</span>;
}

function formatWeekOfMonth(weekStart: Date) {
  const ordinal = Math.floor((weekStart.getDate() - 1) / 7) + 1;
  return `${weekStart.getMonth() + 1}月第${ordinal}周`;
}

function CustomFilterValue({ field, value, onChange }: { field: CustomFieldDefinition | undefined; value: string; onChange: (value: string) => void }) {
  if (!field) return <input value="" disabled placeholder="先选择字段" />;
  if (["single_select", "multi_select"].includes(field.type)) return <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">选择值</option>{field.options.filter((option) => !option.archivedAt).map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select>;
  if (field.type === "boolean") return <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">选择值</option><option value="true">是</option><option value="false">否</option></select>;
  return <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={value} onChange={(event) => onChange(event.target.value)} placeholder="输入筛选值" />;
}
