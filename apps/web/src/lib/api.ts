import type { ExportTemplateColumn } from "@workplan/contracts";

export type ApiProblem = {
  status: number;
  code: string;
  detail: string;
  errors?: Record<string, string[]>;
};

export class ApiError extends Error {
  constructor(public readonly problem: ApiProblem) {
    super(problem.detail);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(value: string | null) {
  csrfToken = value;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase())) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const fallback: ApiProblem = { status: response.status, code: "REQUEST_FAILED", detail: `请求失败（${response.status}）` };
    const problem = (await response.json().catch(() => fallback)) as ApiProblem;
    throw new ApiError(problem);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const jsonBody = (value: unknown): Pick<RequestInit, "body"> => ({ body: JSON.stringify(value) });

export async function downloadExport() {
  const response = await fetch("/api/v1/export", { credentials: "include" });
  if (!response.ok) throw new Error("导出失败");
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `workplan-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(href);
}

export async function downloadWorkPlansXlsCustom(
  columns: ExportTemplateColumn[],
  sheetName: string,
  filters: { q?: string; status?: string; from?: string; to?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch("/api/v1/work-plans/export.xls", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ columns, sheetName, ...filters }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as ApiProblem | null;
    throw new Error(problem?.detail ?? "导出 XLS 失败");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = encodedName ? decodeURIComponent(encodedName) : `workplan-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(href);
}

export async function fileToBase64(file: File): Promise<string> {
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  return result.slice(result.indexOf(",") + 1);
}
