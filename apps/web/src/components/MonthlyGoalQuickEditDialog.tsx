import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MonthlyGoal, MonthlyGoalQuickEdit, MonthlyGoalQuickEditResult } from "@workplan/contracts";
import { Minus, Plus, Table2, X } from "lucide-react";
import { useToast } from "./ToastProvider";
import { type ApiError, api, jsonBody } from "../lib/api";

const yearRange = Array.from({ length: 101 }, (_, index) => 2000 + index);
const months = Array.from({ length: 12 }, (_, index) => index + 1);

type QuickEditRow = {
  id: string;
  originalTitle: string | null;
  title: string;
  activeMonths: number[];
  initialTitle: string;
  initialActiveMonths: number[];
};

type Props = {
  initialYear: number;
  onClose: () => void;
  onSaved: (year: number) => void;
};

function newRow(id: string): QuickEditRow {
  return { id, originalTitle: null, title: "", activeMonths: [], initialTitle: "", initialActiveMonths: [] };
}

function aggregateGoals(goals: MonthlyGoal[], makeNewRowId: () => string): { rows: QuickEditRow[]; baseline: Array<{ id: string; version: number }> } {
  const groups = new Map<string, MonthlyGoal[]>();
  for (const goal of goals) {
    const title = goal.title.trim();
    const group = groups.get(title) ?? [];
    group.push(goal);
    groups.set(title, group);
  }

  const rows = [...groups.entries()]
    .map(([title, group]) => {
      const activeMonths = [...new Set(group.filter((goal) => !goal.archivedAt).map((goal) => goal.month))].sort((left, right) => left - right);
      return {
        id: `existing-${title}`,
        originalTitle: title,
        title,
        activeMonths,
        initialTitle: title,
        initialActiveMonths: activeMonths,
        createdAt: group.reduce((earliest, goal) => Math.min(earliest, Date.parse(goal.createdAt)), Number.POSITIVE_INFINITY),
      };
    })
    .sort((left, right) => left.createdAt - right.createdAt || left.title.localeCompare(right.title));

  const quickRows: QuickEditRow[] = rows.map(({ createdAt: _createdAt, ...row }) => row);
  if (quickRows.length === 0) quickRows.push(newRow(makeNewRowId()));
  return {
    rows: quickRows,
    baseline: goals.map(({ id, version }) => ({ id, version })),
  };
}

function meaningfulRows(rows: QuickEditRow[]): QuickEditRow[] {
  return rows.filter((row) => row.originalTitle !== null || row.title.trim() !== "" || row.activeMonths.length > 0);
}

function sameMonths(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((month, index) => month === right[index]);
}

function rowsAreDirty(rows: QuickEditRow[]): boolean {
  return meaningfulRows(rows).some((row) => (
    row.originalTitle === null
      || row.title.trim() !== row.initialTitle
      || !sameMonths([...row.activeMonths].sort((left, right) => left - right), row.initialActiveMonths)
  ));
}

function validateRows(rows: QuickEditRow[]): Map<string, string> {
  const errors = new Map<string, string>();
  const submitted = meaningfulRows(rows);
  const titleCounts = new Map<string, number>();
  for (const row of submitted) {
    const title = row.title.trim();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    if (!title) errors.set(row.id, "目标名称不能为空");
    else if (title.length > 200) errors.set(row.id, "目标名称不能超过 200 个字符");
    else if (row.originalTitle === null && row.activeMonths.length === 0) errors.set(row.id, "新行至少选择一个月份");
  }
  for (const row of submitted) {
    if (!errors.has(row.id) && titleCounts.get(row.title.trim())! > 1) errors.set(row.id, "目标名称不能重复");
  }
  return errors;
}

function payloadRows(rows: QuickEditRow[]): MonthlyGoalQuickEdit["rows"] {
  return meaningfulRows(rows).map((row) => ({
    originalTitle: row.originalTitle,
    title: row.title.trim(),
    activeMonths: [...new Set(row.activeMonths)].sort((left, right) => left - right),
  }));
}

export default function MonthlyGoalQuickEditDialog({ initialYear, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const nextRowId = useRef(0);
  const [year, setYear] = useState(initialYear);
  const [rows, setRows] = useState<QuickEditRow[]>([]);
  const [baseline, setBaseline] = useState<Array<{ id: string; version: number }>>([]);
  const [loadedYear, setLoadedYear] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const goalsQuery = useQuery({
    queryKey: ["monthly-goals", "quick-edit", year],
    queryFn: () => api<MonthlyGoal[]>(`/monthly-goals?year=${year}&includeArchived=true`),
  });

  const makeNewRowId = () => {
    nextRowId.current += 1;
    return `new-${nextRowId.current}`;
  };

  function applySnapshot(goals: MonthlyGoal[], snapshotYear: number) {
    const snapshot = aggregateGoals(goals, makeNewRowId);
    setRows(snapshot.rows);
    setBaseline(snapshot.baseline);
    setLoadedYear(snapshotYear);
    setError("");
    setConflict(false);
  }

  useEffect(() => {
    if (goalsQuery.data === undefined || goalsQuery.isFetching || loadedYear === year) return;
    applySnapshot(goalsQuery.data, year);
  }, [goalsQuery.data, goalsQuery.isFetching, loadedYear, year]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const saveMutation = useMutation({
    mutationFn: (input: MonthlyGoalQuickEdit) => api<MonthlyGoalQuickEditResult>("/monthly-goals/quick-edit", { method: "PUT", ...jsonBody(input) }),
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["monthly-goals"] }),
        queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["monthly-goal-series"] }),
      ]);
      showSuccess("年度月目标已保存");
      onSaved(input.year);
    },
    onError: (saveError) => {
      if ((saveError as ApiError).problem?.code === "VERSION_CONFLICT") {
        setConflict(true);
        setError("数据已变化，请重新载入后重试");
      } else {
        setError(saveError instanceof Error ? saveError.message : "保存年度月目标失败");
      }
    },
  });

  const validationErrors = useMemo(() => validateRows(rows), [rows]);
  const dirty = loadedYear === year && rowsAreDirty(rows);
  const canSave = loadedYear === year && !goalsQuery.isLoading && !goalsQuery.isFetching && !saveMutation.isPending && dirty && validationErrors.size === 0;

  function requestClose() {
    if (!dirty || window.confirm("有未保存的年度快速编辑修改，确定放弃吗？")) onClose();
  }

  function changeYear(nextYear: number) {
    if (nextYear === year) return;
    if (dirty && !window.confirm("切换年份将放弃未保存修改，确定继续吗？")) return;
    setYear(nextYear);
    setRows([]);
    setBaseline([]);
    setLoadedYear(null);
    setError("");
    setConflict(false);
  }

  function updateRow(rowId: string, update: (row: QuickEditRow) => QuickEditRow) {
    setRows((current) => current.map((row) => row.id === rowId ? update(row) : row));
    setError("");
  }

  function toggleMonth(rowId: string, month: number) {
    updateRow(rowId, (row) => {
      const activeMonths = row.activeMonths.includes(month)
        ? row.activeMonths.filter((item) => item !== month)
        : [...row.activeMonths, month].sort((left, right) => left - right);
      return { ...row, activeMonths };
    });
  }

  function addRow() {
    setRows((current) => [...current, newRow(makeNewRowId())]);
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const remaining = current.filter((row) => row.id !== rowId);
      return remaining.some((row) => row.originalTitle === null) ? remaining : [...remaining, newRow(makeNewRowId())];
    });
  }

  async function reload() {
    if (dirty && !window.confirm("重新载入将放弃未保存修改，确定继续吗？")) return;
    const result = await goalsQuery.refetch();
    if (result.data) applySnapshot(result.data, year);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setError("");
    saveMutation.mutate({ year, baseline, rows: payloadRows(rows) });
  }

  const queryError = goalsQuery.error instanceof Error ? goalsQuery.error.message : goalsQuery.error ? "年度月目标加载失败" : "";
  const isLoading = goalsQuery.isLoading || loadedYear !== year;

  return (
    <div className="modal-layer annual-quick-edit-layer">
      <button className="modal-backdrop" type="button" onClick={requestClose} aria-label="关闭" />
      <form className="annual-quick-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="annual-quick-edit-title" onSubmit={submit}>
        <header>
          <div><h2 id="annual-quick-edit-title"><Table2 />年度快速编辑</h2><p>按目标名称集中维护 {year} 年 1–12 月的活跃状态。</p></div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="关闭"><X /></button>
        </header>

        <div className="annual-quick-edit-toolbar">
          <label className="month-selector"><span>年份</span><select value={year} onChange={(event) => changeYear(Number(event.target.value))} disabled={saveMutation.isPending}>{yearRange.map((option) => <option key={option} value={option}>{option} 年</option>)}</select></label>
          <span className="annual-quick-edit-hint">勾选表示该月存在至少一个未归档目标</span>
          <button className="secondary-button compact-button" type="button" onClick={addRow} disabled={isLoading || saveMutation.isPending}><Plus />新增一行</button>
        </div>

        {queryError && !goalsQuery.data ? (
          <div className="annual-quick-edit-message"><div className="form-error" role="alert">{queryError}</div><button className="secondary-button" type="button" onClick={() => void goalsQuery.refetch()}>重试</button></div>
        ) : isLoading ? (
          <div className="annual-quick-edit-loading">正在载入 {year} 年月目标…</div>
        ) : (
          <div className="annual-quick-edit-table-scroll">
            <table className="annual-quick-edit-table">
              <thead><tr><th scope="col">目标名称</th>{months.map((month) => <th scope="col" key={month}>{month} 月</th>)}<th scope="col" aria-label="行操作" /></tr></thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const rowError = validationErrors.get(row.id);
                  const displayTitle = row.title.trim() || `第 ${rowIndex + 1} 行`;
                  return (
                    <tr key={row.id}>
                      <th scope="row" className="annual-quick-edit-name-cell">
                        <input value={row.title} maxLength={200} aria-label={`${displayTitle}，目标名称`} onChange={(event) => updateRow(row.id, (current) => ({ ...current, title: event.target.value }))} />
                        {rowError ? <small className="annual-quick-edit-row-error" role="alert">{rowError}</small> : null}
                      </th>
                      {months.map((month) => <td key={month}><input type="checkbox" checked={row.activeMonths.includes(month)} aria-label={`${displayTitle}，${month} 月`} onChange={() => toggleMonth(row.id, month)} /></td>)}
                      <td className="annual-quick-edit-row-actions">{row.originalTitle === null ? <button className="icon-button" type="button" aria-label={`移除 ${displayTitle}`} onClick={() => removeRow(row.id)} disabled={saveMutation.isPending}><Minus /></button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {conflict ? <div className="annual-quick-edit-message"><div className="form-error" role="alert">数据已变化，请重新载入后重试</div><button className="secondary-button" type="button" onClick={() => void reload()} disabled={goalsQuery.isFetching}>重新载入</button></div> : error && !queryError ? <div className="form-error annual-quick-edit-error" role="alert">{error}</div> : null}
        <footer><button className="secondary-button" type="button" onClick={requestClose}>取消</button><button className="primary-button" type="submit" disabled={!canSave}>{saveMutation.isPending ? "保存中…" : "保存"}</button></footer>
      </form>
    </div>
  );
}
