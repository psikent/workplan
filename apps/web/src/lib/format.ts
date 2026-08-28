import type { CustomFieldDefinition, WorkPlanStatus } from "@workplan/contracts";

export const statusLabels: Record<WorkPlanStatus, string> = {
  pending: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};

export function formatDate(iso: string, withTime = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(iso));
}

export function toDateTimeLocal(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value: string) {
  return new Date(value).toISOString();
}

export function toLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfWeek(date: Date) {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + 7);
  return result;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function formatCustomFieldValue(value: unknown, field: CustomFieldDefinition): string {
  if (value == null || value === "") return "—";
  if (field.type === "boolean") return value ? "是" : "否";
  if (field.type === "date" || field.type === "datetime") {
    const timestamp = Date.parse(String(value));
    return Number.isNaN(timestamp) ? String(value) : formatDate(new Date(timestamp).toISOString(), field.type === "datetime");
  }
  if (field.type === "number" && typeof value === "number") return new Intl.NumberFormat("zh-CN").format(value);
  if (field.type === "single_select") return field.options.find((option) => option.value === value)?.label ?? String(value);
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value.map((item) => field.options.find((option) => option.value === item)?.label ?? String(item)).join("、") || "—";
  }
  return Array.isArray(value) ? value.join("、") : String(value);
}
