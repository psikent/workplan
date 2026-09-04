import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MonthlyGoal,
  MonthlyGoalSeries,
  MonthlyGoalSeriesDetail,
  MonthlyGoalSeriesDissolvePreview,
  MonthlyGoalSeriesDissolveReason,
  MonthlyGoalSeriesDissolveResult,
  MonthlyGoalSeriesFrequency,
  WorkPlan,
} from "@workplan/contracts";
import { Archive, Pencil, Plus, Repeat2, RotateCcw, Search, Table2, Target, Trash2, Unlink2, X } from "lucide-react";
import MonthlyGoalQuickEditDialog from "../components/MonthlyGoalQuickEditDialog";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/ToastProvider";
import { useSession } from "../App";
import { type ApiError, api, jsonBody } from "../lib/api";
import { canWriteBusinessData } from "../lib/permissions";
import { rangeOverlapsMonth } from "../lib/period";

type SeriesFrequency = MonthlyGoalSeriesFrequency | "";

type GoalDraft = {
  title: string;
  description: string;
  year: number;
  month: number;
  workPlanId: string;
  recurrence: SeriesFrequency;
  interval: number;
  endMode: "count" | "until";
  occurrenceCount: number;
  untilYear: number;
  untilMonth: number;
};

type MonthPeriod = Pick<GoalDraft, "year" | "month">;

function workPlanOverlapsMonth(plan: WorkPlan, period: MonthPeriod): boolean {
  return rangeOverlapsMonth(plan.startAt, plan.endAt, period.year, period.month);
}

function emptyDraft(): GoalDraft {
  const now = new Date();
  return {
    title: "",
    description: "",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    workPlanId: "",
    recurrence: "",
    interval: 1,
    endMode: "count",
    occurrenceCount: 6,
    untilYear: now.getFullYear(),
    untilMonth: now.getMonth() + 1,
  };
}

const yearRange = Array.from({ length: 101 }, (_, index) => 2000 + index);
const months = Array.from({ length: 12 }, (_, index) => index + 1);

const frequencyLabels: Record<MonthlyGoalSeriesFrequency, string> = { monthly: "每月", quarterly: "每季度", yearly: "每年" };
const frequencyUnits: Record<MonthlyGoalSeriesFrequency, string> = { monthly: "个月", quarterly: "个季度", yearly: "年" };

function seriesBadgeTitle(series: MonthlyGoalSeries | undefined): string {
  if (!series) return "重复周期";
  const unit = frequencyUnits[series.frequency];
  const label = series.interval > 1 ? `每 ${series.interval} ${unit}` : frequencyLabels[series.frequency];
  return `${label}重复 · 共 ${series.instanceCount} 期`;
}

export default function MonthlyGoalsPage() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const { user } = useSession();
  const canWrite = canWriteBusinessData(user.role);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<MonthlyGoal | null | "new">(null);
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft);
  const [error, setError] = useState("");
  const [linkingGoal, setLinkingGoal] = useState<MonthlyGoal | null>(null);
  const [planSearch, setPlanSearch] = useState("");
  const [linkError, setLinkError] = useState("");
  const [managingSeries, setManagingSeries] = useState<{ seriesId: string; keepGoalId: string } | null>(null);
  const [quickEditing, setQuickEditing] = useState(false);

  const goalsQuery = useQuery({
    queryKey: ["monthly-goals", year, month],
    queryFn: () => api<MonthlyGoal[]>(`/monthly-goals?year=${year}&month=${month}&includeArchived=true`),
  });
  const plansQuery = useQuery({ queryKey: ["work-plans"], queryFn: () => api<WorkPlan[]>("/work-plans?limit=500") });
  const seriesQuery = useQuery({ queryKey: ["monthly-goal-series"], queryFn: () => api<MonthlyGoalSeries[]>("/monthly-goal-series") });

  const goals = goalsQuery.data ?? [];
  const visibleGoals = useMemo(() => showArchived ? goals : goals.filter((goal) => !goal.archivedAt), [goals, showArchived]);
  const completedCount = useMemo(() => goals.filter((goal) => !goal.archivedAt && goal.status === "completed").length, [goals]);
  const activeCount = useMemo(() => goals.filter((goal) => !goal.archivedAt).length, [goals]);
  const plans = useMemo(() => [...(plansQuery.data ?? [])].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)), [plansQuery.data]);
  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const formMonthPlans = useMemo(
    () => plans.filter((plan) => workPlanOverlapsMonth(plan, draft)),
    [draft.month, draft.year, plans],
  );
  const formMonthPlanIds = useMemo(() => new Set(formMonthPlans.map((plan) => plan.id)), [formMonthPlans]);
  const historicalFormPlanId = editing && editing !== "new"
    && draft.workPlanId === editing.linkedWorkPlan?.id
    && !formMonthPlanIds.has(draft.workPlanId)
    ? draft.workPlanId
    : null;
  const missingCurrentFormPlan = editing && editing !== "new"
    && editing.linkedWorkPlan
    && draft.workPlanId === editing.linkedWorkPlan.id
    && !plansById.has(draft.workPlanId)
    ? editing.linkedWorkPlan
    : null;
  const formPlans = useMemo(() => {
    if (!editing || editing === "new") return formMonthPlans;
    return plans.filter((plan) => (
      (formMonthPlanIds.has(plan.id) || plan.id === historicalFormPlanId)
      && (!plan.monthlyGoalIds.includes(editing.id) || plan.id === editing.linkedWorkPlan?.id)
    ));
  }, [editing, formMonthPlanIds, formMonthPlans, historicalFormPlanId, plans]);
  const seriesById = useMemo(() => new Map((seriesQuery.data ?? []).map((series) => [series.id, series])), [seriesQuery.data]);
  const quickLinkMonthPlans = useMemo(
    () => linkingGoal
      ? plans.filter((plan) => workPlanOverlapsMonth(plan, linkingGoal))
      : [],
    [linkingGoal, plans],
  );
  const filteredPlans = useMemo(() => {
    const query = planSearch.trim().toLocaleLowerCase();
    return query ? quickLinkMonthPlans.filter((plan) => `${plan.title} ${plan.description}`.toLocaleLowerCase().includes(query)) : quickLinkMonthPlans;
  }, [planSearch, quickLinkMonthPlans]);
  const quickLinkCurrentPlan = linkingGoal?.linkedWorkPlan
    ? plansById.get(linkingGoal.linkedWorkPlan.id)
    : undefined;
  const quickLinkCurrentMissing = Boolean(linkingGoal?.linkedWorkPlan && !quickLinkCurrentPlan);
  const quickLinkCurrentOutOfMonth = Boolean(
    linkingGoal && quickLinkCurrentPlan
    && !workPlanOverlapsMonth(quickLinkCurrentPlan, linkingGoal),
  );
  const editingSeriesId = editing && editing !== "new" ? editing.seriesId : null;
  const editingSeries = editingSeriesId ? seriesById.get(editingSeriesId) : undefined;

  const saveMutation = useMutation({
    mutationFn: ({ goal, body, series }: { goal: MonthlyGoal | null; body: Record<string, unknown>; series?: boolean }): Promise<MonthlyGoal | { series: MonthlyGoalSeries }> =>
      goal
        ? api<MonthlyGoal>(`/monthly-goals/${goal.id}`, { method: "PATCH", ...jsonBody({ ...body, version: goal.version }) })
        : series
          ? api<{ series: MonthlyGoalSeries }>("/monthly-goal-series", { method: "POST", ...jsonBody(body) })
          : api<MonthlyGoal>("/monthly-goals", { method: "POST", ...jsonBody(body) }),
    onSuccess: async (_goal, { goal }) => {
      await refreshGoals();
      showSuccess(goal ? "月目标已保存" : "月目标已创建");
      closeForm();
    },
    onError: (error) => {
      if ((error as ApiError).problem?.code === "VERSION_CONFLICT") {
        setError("数据已被修改，请刷新后重试");
        void queryClient.invalidateQueries({ queryKey: ["monthly-goals", year, month] });
      } else {
        setError(error instanceof Error ? error.message : "保存月目标失败");
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ goal, archived }: { goal: MonthlyGoal; archived: boolean }) =>
      api(`/monthly-goals/${goal.id}`, { method: "PATCH", ...jsonBody({ archived, version: goal.version }) }),
    onSuccess: async (_result, { archived }) => {
      await refreshGoals();
      showSuccess(archived ? "月目标已归档" : "月目标已恢复");
    },
    onError: (error) => showSuccess(error instanceof Error ? error.message : "操作失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (goal: MonthlyGoal) => api(`/monthly-goals/${goal.id}?version=${goal.version}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refreshGoals();
      showSuccess("月目标已删除");
    },
    onError: (error) => showSuccess(error instanceof Error ? error.message : "删除失败"),
  });

  const linkMutation = useMutation({
    mutationFn: ({ goal, workPlanId }: { goal: MonthlyGoal; workPlanId: string | null }) =>
      api<MonthlyGoal>(`/monthly-goals/${goal.id}`, { method: "PATCH", ...jsonBody({ workPlanId, version: goal.version }) }),
    onSuccess: async (_goal, { workPlanId }) => {
      await refreshGoals();
      showSuccess(workPlanId ? "已关联工作计划" : "已解除关联");
      setLinkingGoal(null);
    },
    onError: (error) => {
      setLinkError(error instanceof Error ? error.message : "关联失败");
      void queryClient.invalidateQueries({ queryKey: ["monthly-goals", year, month] });
    },
  });

  async function refreshGoals() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["monthly-goals"] }),
      queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
      queryClient.invalidateQueries({ queryKey: ["monthly-goal-series"] }),
    ]);
  }

  function openCreate() {
    setDraft({ ...emptyDraft(), year, month });
    setEditing("new");
    setError("");
  }

  function openEdit(goal: MonthlyGoal) {
    setDraft({
      title: goal.title,
      description: goal.description,
      year: goal.year,
      month: goal.month,
      workPlanId: goal.linkedWorkPlan?.id ?? "",
      recurrence: "",
      interval: 1,
      endMode: "count",
      occurrenceCount: 6,
      untilYear: goal.year,
      untilMonth: goal.month,
    });
    setEditing(goal);
    setError("");
  }

  function closeForm() {
    setEditing(null);
    setError("");
  }

  function updateDraftPeriod(period: Partial<MonthPeriod>) {
    setDraft((current) => {
      const next = { ...current, ...period };
      if (!current.workPlanId) return next;

      const selectedPlan = plansById.get(current.workPlanId);
      if (!selectedPlan) return next;
      const start = Date.parse(selectedPlan.startAt);
      const end = Date.parse(selectedPlan.endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return next;

      return workPlanOverlapsMonth(selectedPlan, next)
        ? next
        : { ...next, workPlanId: "" };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (draft.recurrence && draft.endMode === "count" && draft.occurrenceCount < 1) {
        setError("请填写有效的期数");
        return;
      }
      const body = {
        title: draft.title,
        description: draft.description,
        year: draft.year,
        month: draft.month,
        workPlanId: draft.workPlanId || null,
      };
      const goal = editing === "new" ? null : editing;
      if (!goal && draft.recurrence) {
        const seriesBody = {
          template: { title: draft.title, description: draft.description },
          frequency: draft.recurrence,
          interval: draft.interval,
          startPeriod: { year: draft.year, month: draft.month },
          occurrenceCount: draft.endMode === "count" ? draft.occurrenceCount : null,
          untilPeriod: draft.endMode === "until" ? { year: draft.untilYear, month: draft.untilMonth } : null,
        };
        await saveMutation.mutateAsync({ goal: null, body: seriesBody, series: true });
        return;
      }
      await saveMutation.mutateAsync({ goal, body });
    } catch {
      // Error feedback is handled by saveMutation.onError.
    }
  }

  function handleArchive(goal: MonthlyGoal) {
    archiveMutation.mutate({ goal, archived: !goal.archivedAt });
  }

  function handleDelete(goal: MonthlyGoal) {
    if (window.confirm(`删除后该月目标将从关联的工作计划中消失，确定删除“${goal.title}”吗？`)) {
      deleteMutation.mutate(goal);
    }
  }

  const saving = saveMutation.isPending || archiveMutation.isPending || deleteMutation.isPending || linkMutation.isPending;
  const periodControlsDisabled = Boolean(draft.workPlanId) && plansQuery.isLoading;

  return (
    <section className="content-page">
      <header className="page-header">
        <div><h1>月目标</h1><p>每月为工作安排一组随月份变化的目标，并自动跟随关联计划完成。</p></div>
        <div className="header-actions">
          {canWrite ? <button className="secondary-button" type="button" onClick={() => setQuickEditing(true)} aria-label="快速编辑月目标"><Table2 />快速编辑</button> : null}
          <label className={`secondary-button compact-check ${showArchived ? "selected" : ""}`}><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>显示已归档</span></label>
          {canWrite ? <button className="primary-button" type="button" onClick={openCreate}><Plus />新建月目标</button> : null}
        </div>
      </header>
      {canWrite ? null : <p className="read-only-hint" role="note">当前账户为只读账户：可查看月目标及其关联计划，不能新建或修改目标。</p>}

      <div className="month-toolbar">
        <label className="month-selector"><span>年份</span><select value={year} onChange={(event) => setYear(Number(event.target.value))}>{yearRange.map((option) => <option key={option} value={option}>{option} 年</option>)}</select></label>
        <label className="month-selector"><span>月份</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{months.map((option) => <option key={option} value={option}>{option} 月</option>)}</select></label>
        <span className="monthly-goals-summary">本月已完成 {completedCount} / {activeCount} 个目标</span>
      </div>

      <div className="settings-panel">
        <div className="settings-panel-header"><div><Target /><strong>目标列表</strong></div><span>{visibleGoals.length} 个目标</span></div>
        <div className="goals-table table-head"><span>目标名称</span><span>所属月份</span><span>说明</span><span>关联计划</span><span>状态</span><span /></div>
        {visibleGoals.map((goal) => (
          <div className={`goals-table ${goal.archivedAt ? "archived" : ""}`} key={goal.id}>
            <div><strong>{goal.title}</strong>{goal.archivedAt ? <small>已归档</small> : null}</div>
            <span>{goal.year} 年 {goal.month} 月</span>
            <span className="truncate" title={goal.description}>{goal.description || "—"}</span>
            {goal.linkedWorkPlan ? (
              <div className="goal-linked-plan"><span className="truncate" title={goal.linkedWorkPlan.title}>{goal.linkedWorkPlan.title}</span><StatusBadge status={goal.status!} /></div>
            ) : <span className="goal-unlinked">未关联</span>}
            {goal.status ? <StatusBadge status={goal.status} /> : <span className="goal-unlinked">未关联</span>}
            <div className="field-row-actions">
              {canWrite && goal.seriesId ? (
                <button className="icon-button" type="button" title={seriesBadgeTitle(seriesById.get(goal.seriesId))} aria-label={`管理系列 ${goal.title}`} disabled={saving} onClick={() => setManagingSeries({ seriesId: goal.seriesId!, keepGoalId: goal.id })}><Repeat2 /></button>
              ) : null}
              {canWrite ? <button className="icon-button" type="button" title="关联计划" aria-label={`关联计划 ${goal.title}`} disabled={saving} onClick={() => { setLinkingGoal(goal); setPlanSearch(""); }}><Target /></button> : null}
              {canWrite ? <button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${goal.title}`} disabled={saving} onClick={() => openEdit(goal)}><Pencil /></button> : null}
              {canWrite ? <button className="icon-button" type="button" title={goal.archivedAt ? "恢复" : "归档"} aria-label={goal.archivedAt ? `恢复 ${goal.title}` : `归档 ${goal.title}`} disabled={saving} onClick={() => handleArchive(goal)}>{goal.archivedAt ? <RotateCcw /> : <Archive />}</button> : null}
              {canWrite ? <button className="icon-button" type="button" title="删除" aria-label={`删除 ${goal.title}`} disabled={saving} onClick={() => handleDelete(goal)}><Trash2 /></button> : null}
            </div>
          </div>
        ))}
        {!goalsQuery.isLoading && visibleGoals.length === 0 ? (
          <div className="empty-state"><Target /><h3>这个月还没有配置月目标</h3><p>{canWrite ? `点击「新建月目标」为 ${year} 年 ${month} 月安排一份工作目标。` : `只读账户可查看 ${year} 年 ${month} 月已配置的目标。`}</p></div>
        ) : null}
      </div>

      {quickEditing ? <MonthlyGoalQuickEditDialog initialYear={year} onClose={() => setQuickEditing(false)} onSaved={(savedYear) => { setYear(savedYear); setQuickEditing(false); }} /> : null}

      {editing ? (
        <div className="modal-layer">
          <button className="modal-backdrop" type="button" onClick={closeForm} aria-label="关闭" />
          <form className="field-dialog goal-dialog" onSubmit={submit}>
            <header><div><h2>{editing === "new" ? "新建月目标" : "编辑月目标"}</h2><p>目标完成状态由关联工作计划的有效状态自动派生。</p></div><button className="icon-button" type="button" onClick={closeForm} aria-label="关闭"><X /></button></header>
            <div className="field-grid">
              <label className="field"><span>目标名称 <b>*</b></span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} required maxLength={200} /></label>
              <label className="field"><span>所属月份</span><select value={draft.month} disabled={periodControlsDisabled} onChange={(event) => updateDraftPeriod({ month: Number(event.target.value) })}>{months.map((option) => <option key={option} value={option}>{option} 月</option>)}</select></label>
              <label className="field"><span>所属年份</span><select value={draft.year} disabled={periodControlsDisabled} onChange={(event) => updateDraftPeriod({ year: Number(event.target.value) })}>{yearRange.map((option) => <option key={option} value={option}>{option} 年</option>)}</select></label>
              {editing === "new" ? (
                <fieldset className="form-section full">
                  <legend><Repeat2 />重复周期</legend>
                  <div className="field-grid compact">
                    <label className="field"><span>频率</span><select value={draft.recurrence} onChange={(event) => setDraft((current) => ({ ...current, recurrence: event.target.value as SeriesFrequency }))}><option value="">不重复</option><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="yearly">每年</option></select></label>
                    <label className="field"><span>间隔</span><input type="number" min={1} max={12} value={draft.interval} disabled={!draft.recurrence} onChange={(event) => setDraft((current) => ({ ...current, interval: Number(event.target.value) }))} /></label>
                    <label className="field"><span>结束方式</span><select value={draft.endMode} disabled={!draft.recurrence} onChange={(event) => setDraft((current) => ({ ...current, endMode: event.target.value as "count" | "until" }))}><option value="count">共 N 期</option><option value="until">到某年某月</option></select></label>
                    {draft.endMode === "count" ? (
                      <label className="field"><span>期数</span><input type="number" min={1} max={600} value={draft.occurrenceCount} disabled={!draft.recurrence} onChange={(event) => setDraft((current) => ({ ...current, occurrenceCount: Number(event.target.value) }))} /></label>
                    ) : (
                      <>
                        <label className="field"><span>结束于</span><select value={draft.untilYear} disabled={!draft.recurrence} onChange={(event) => setDraft((current) => ({ ...current, untilYear: Number(event.target.value) }))}>{yearRange.map((option) => <option key={option} value={option}>{option} 年</option>)}</select></label>
                        <label className="field"><span>月份</span><select value={draft.untilMonth} disabled={!draft.recurrence} onChange={(event) => setDraft((current) => ({ ...current, untilMonth: Number(event.target.value) }))}>{months.map((option) => <option key={option} value={option}>{option} 月</option>)}</select></label>
                      </>
                    )}
                  </div>
                  {draft.recurrence ? <p className="goal-link-hint">保存后将立即生成从 {draft.year} 年 {draft.month} 月起的独立月目标实例，每期可单独编辑与关联计划。</p> : null}
                </fieldset>
              ) : (
                <fieldset className="form-section full">
                  <legend><Repeat2 />重复周期</legend>
                  {editingSeriesId ? (
                    <div className="goal-recurrence-summary">
                      <span>{editingSeries ? seriesBadgeTitle(editingSeries) : "已设置重复周期"}</span>
                      <button className="secondary-button compact-button" type="button" onClick={() => setManagingSeries({ seriesId: editingSeriesId, keepGoalId: editing.id })}>编辑重复周期</button>
                    </div>
                  ) : (
                    <p className="goal-link-hint">不重复</p>
                  )}
                </fieldset>
              )}
              <label className="field full"><span>说明</span><textarea rows={2} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={2000} /></label>
              <label className="field full"><span>关联计划</span><select value={draft.workPlanId} onChange={(event) => setDraft((current) => ({ ...current, workPlanId: event.target.value }))}>
                <option value="">不关联</option>
                {missingCurrentFormPlan ? <option value={missingCurrentFormPlan.id}>{missingCurrentFormPlan.title}（当前关联，未在候选列表中）</option> : null}
                {formPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}{plan.id === historicalFormPlanId ? "（当前关联，不在所选月份）" : ""}</option>)}
              </select></label>
              <p className="goal-link-hint full">{draft.workPlanId ? "目标完成状态将跟随该工作计划的完成情况。" : "未关联计划时目标显示为「未关联」。"}</p>
            </div>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <footer><button className="secondary-button" type="button" onClick={closeForm}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer>
          </form>
        </div>
      ) : null}

      {linkingGoal ? (
        <div className="modal-layer">
          <button className="modal-backdrop" type="button" onClick={() => setLinkingGoal(null)} aria-label="关闭" />
          <div className="field-dialog goal-link-dialog" role="dialog" aria-label="关联工作计划">
            <header><div><h2>关联工作计划</h2><p>选择一条工作计划作为“{linkingGoal.title}”的完成判据。</p></div><button className="icon-button" type="button" onClick={() => setLinkingGoal(null)} aria-label="关闭"><X /></button></header>
            <div className="goal-link-picker">
              {linkingGoal.linkedWorkPlan ? (
                <div className="goal-link-current"><span className="truncate" title={linkingGoal.linkedWorkPlan.title}>当前关联：{linkingGoal.linkedWorkPlan.title}{quickLinkCurrentOutOfMonth ? "（不在目标所属月份）" : quickLinkCurrentMissing ? "（计划未在候选列表中，无法确认目标所属月份）" : ""}</span><button className="text-button" type="button" disabled={saving} onClick={() => linkMutation.mutate({ goal: linkingGoal, workPlanId: null })}>解除关联</button></div>
              ) : null}
              <label className="search-control goal-link-search"><Search /><input value={planSearch} onChange={(event) => setPlanSearch(event.target.value)} placeholder="搜索工作计划" /></label>
              <div className="goal-link-list">
                {filteredPlans.map((plan) => {
                  const occupied = plan.monthlyGoalIds.includes(linkingGoal.id) && plan.id !== linkingGoal.linkedWorkPlan?.id;
                  const isCurrent = plan.id === linkingGoal.linkedWorkPlan?.id;
                  return (
                    <button className={`goal-link-option ${occupied ? "disabled" : ""}`} type="button" key={plan.id} disabled={occupied || isCurrent || saving} title={occupied ? "该工作计划已关联该目标" : isCurrent ? "当前已关联" : plan.title} onClick={() => linkMutation.mutate({ goal: linkingGoal, workPlanId: plan.id })}>
                      <span className="goal-link-option-title">{plan.title}</span><StatusBadge status={plan.status} />
                    </button>
                  );
                })}
                {filteredPlans.length === 0 && !plansQuery.isLoading ? (
                  <div className="goal-link-empty">{quickLinkMonthPlans.length === 0 ? "所选月份暂无可关联计划" : "没有匹配的工作计划"}</div>
                ) : null}
                {linkError ? <div className="form-error" role="alert">{linkError}</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {managingSeries ? (
        <SeriesDialog
          seriesId={managingSeries.seriesId}
          keepGoalId={managingSeries.keepGoalId}
          onClose={() => setManagingSeries(null)}
          onChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ["monthly-goals"] });
            await queryClient.invalidateQueries({ queryKey: ["monthly-goal-series"] });
          }}
        />
      ) : null}
    </section>
  );
}

type SeriesRuleDraft = {
  forSeries: string;
  frequency: MonthlyGoalSeriesFrequency;
  interval: number;
  endMode: "count" | "until";
  occurrenceCount: number;
  untilYear: number;
  untilMonth: number;
};

function SeriesDialog({ seriesId, keepGoalId, onClose, onChanged }: { seriesId: string; keepGoalId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const [draft, setDraft] = useState<SeriesRuleDraft | null>(null);
  const [error, setError] = useState("");
  const [dissolving, setDissolving] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["monthly-goal-series", seriesId],
    queryFn: () => api<MonthlyGoalSeriesDetail>(`/monthly-goal-series/${seriesId}`),
  });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail) return;
    setDraft((current) => current && current.forSeries === detail.id ? current : {
      forSeries: detail.id,
      frequency: detail.frequency,
      interval: detail.interval,
      endMode: detail.occurrenceCount != null ? "count" : "until",
      occurrenceCount: detail.occurrenceCount ?? 12,
      untilYear: detail.untilPeriod?.year ?? detail.startPeriod.year,
      untilMonth: detail.untilPeriod?.month ?? detail.startPeriod.month,
    });
    setError("");
  }, [detail]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/monthly-goal-series/${seriesId}`, { method: "PATCH", ...jsonBody(body) }),
    onSuccess: async () => {
      await onChanged();
      showSuccess("系列规则已保存");
    },
    onError: (error) => {
      if ((error as ApiError).problem?.code === "VERSION_CONFLICT") {
        setError("数据已被修改，请刷新后重试");
        void queryClient.invalidateQueries({ queryKey: ["monthly-goal-series", seriesId] });
      } else {
        setError(error instanceof Error ? error.message : "保存失败");
      }
    },
  });

  function patchDraft(patch: Partial<Omit<SeriesRuleDraft, "forSeries">>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  const stopMutation = useMutation({
    mutationFn: () => api(`/monthly-goal-series/${seriesId}?version=${detail?.version}`, { method: "DELETE" }),
    onSuccess: async () => {
      await onChanged();
      showSuccess("已停止重复周期");
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : "停止失败");
      void queryClient.invalidateQueries({ queryKey: ["monthly-goal-series", seriesId] });
    },
  });

  if (!detail || !draft) {
    return (
      <div className="modal-layer">
        <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭" />
        <div className="field-dialog series-dialog" role="dialog" aria-label="目标重复周期"><div className="empty-state"><Target /><h3>{detailQuery.isLoading ? "正在载入重复周期…" : "重复周期不存在"}</h3></div></div>
      </div>
    );
  }

  const saveRule = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    saveMutation.mutate({
      frequency: draft.frequency,
      interval: draft.interval,
      occurrenceCount: draft.endMode === "count" ? draft.occurrenceCount : null,
      untilPeriod: draft.endMode === "until" ? { year: draft.untilYear, month: draft.untilMonth } : null,
      version: detail.version,
    });
  };

  const handleStop = () => {
    if (detail.active && window.confirm(`停止后不再生成后续月目标，已生成的实例保留，确定停止“${detail.template.title}”吗？`)) {
      stopMutation.mutate();
    }
  };

  const busy = saveMutation.isPending || stopMutation.isPending;
  return (
    <div className="modal-layer">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭" />
      <div className="field-dialog series-dialog" role="dialog" aria-label="目标重复周期">
        <header>
          <div><h2>目标重复周期</h2><p>{detail.template.title}{detail.active ? "" : "（已停止）"}</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        <form className="field-grid compact" onSubmit={saveRule}>
          <label className="field"><span>频率</span><select value={draft.frequency} onChange={(event) => patchDraft({ frequency: event.target.value as MonthlyGoalSeriesFrequency })}><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="yearly">每年</option></select></label>
          <label className="field"><span>间隔</span><input type="number" min={1} max={12} value={draft.interval} onChange={(event) => patchDraft({ interval: Number(event.target.value) })} /></label>
          <label className="field"><span>结束方式</span><select value={draft.endMode} onChange={(event) => patchDraft({ endMode: event.target.value as "count" | "until" })}><option value="count">共 N 期</option><option value="until">到某年某月</option></select></label>
          {draft.endMode === "count" ? (
            <label className="field"><span>期数</span><input type="number" min={1} max={600} value={draft.occurrenceCount} onChange={(event) => patchDraft({ occurrenceCount: Number(event.target.value) })} /></label>
          ) : (
            <>
              <label className="field"><span>结束于</span><select value={draft.untilYear} onChange={(event) => patchDraft({ untilYear: Number(event.target.value) })}>{yearRange.map((option) => <option key={option} value={option}>{option} 年</option>)}</select></label>
              <label className="field"><span>月份</span><select value={draft.untilMonth} onChange={(event) => patchDraft({ untilMonth: Number(event.target.value) })}>{months.map((option) => <option key={option} value={option}>{option} 月</option>)}</select></label>
            </>
          )}
          <div className="series-dialog-meta full">起始于 {detail.startPeriod.year} 年 {detail.startPeriod.month} 月 · 已生成 {detail.instanceCount} 期</div>
          <div className="series-instance-list full">
            {detail.instances.map((instance) => (
              <div className={`series-instance ${instance.archivedAt ? "archived" : ""}`} key={instance.id}>
                <span>{instance.year} 年 {instance.month} 月</span>
                <span className="truncate" title={instance.title}>{instance.title}</span>
                {instance.archivedAt ? <small>已归档</small> : null}
              </div>
            ))}
          </div>
          {error ? <div className="form-error full" role="alert">{error}</div> : null}
          <footer className="field-dialog-footer full">
            <div>
              <button className="danger-button" type="button" disabled={!detail.active || busy} onClick={handleStop}><Archive />{detail.active ? "停止生成" : "已停止"}</button>
              <button className="danger-button" type="button" disabled={busy} onClick={() => setDissolving(true)}><Unlink2 />解散重复系列</button>
            </div>
            <div><button className="secondary-button" type="button" onClick={onClose}>关闭</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "保存中…" : "保存规则"}</button></div>
          </footer>
        </form>
      </div>
      {dissolving ? (
        <DissolveSeriesDialog
          seriesId={seriesId}
          keepGoalId={keepGoalId}
          onClose={() => setDissolving(false)}
          onDissolved={async (result) => {
            await onChanged();
            showSuccess(`重复系列已解散：保留 ${result.retainedCount} 个，删除 ${result.deletedCount} 个`);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}

const dissolveReasonLabels: Record<MonthlyGoalSeriesDissolveReason, string> = {
  selected: "发起目标",
  edited: "已编辑",
  archived: "已归档",
  linked: "已关联",
  completed: "已完成",
};

function DissolveSeriesDialog({ seriesId, keepGoalId, onClose, onDissolved }: {
  seriesId: string;
  keepGoalId: string;
  onClose: () => void;
  onDissolved: (result: MonthlyGoalSeriesDissolveResult) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [error, setError] = useState("");
  const previewQuery = useQuery({
    queryKey: ["monthly-goal-series-dissolve-preview", seriesId, keepGoalId],
    queryFn: () => api<MonthlyGoalSeriesDissolvePreview>(`/monthly-goal-series/${seriesId}/dissolve-preview?keepGoalId=${keepGoalId}`),
  });
  const preview = previewQuery.data;
  const mutation = useMutation({
    mutationFn: () => api<MonthlyGoalSeriesDissolveResult>(`/monthly-goal-series/${seriesId}/dissolve`, {
      method: "POST",
      ...jsonBody({ keepGoalId, snapshotToken: preview!.snapshotToken, confirmationTitle }),
    }),
    onSuccess: onDissolved,
    onError: (caught) => {
      if ((caught as ApiError).problem?.code === "VERSION_CONFLICT") {
        setError("数据已发生变化，请重新确认解散范围");
        setConfirmationTitle("");
        void queryClient.invalidateQueries({ queryKey: ["monthly-goal-series-dissolve-preview", seriesId, keepGoalId] });
      } else {
        setError(caught instanceof Error ? caught.message : "解散失败");
      }
    },
  });
  const retained = preview?.instances.filter((instance) => instance.action === "retain") ?? [];
  const deleted = preview?.instances.filter((instance) => instance.action === "delete") ?? [];
  const busy = mutation.isPending;

  return (
    <div className="modal-layer series-dissolve-layer">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭解散预览" />
      <div className="field-dialog series-dissolve-dialog" role="dialog" aria-label="解散重复系列">
        <header>
          <div><h2>解散重复系列</h2><p>保留有使用痕迹的月目标，并永久删除未使用的自动实例。</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        {!preview ? (
          <div className="empty-state"><Target /><h3>{previewQuery.isLoading ? "正在计算解散范围…" : "无法读取解散范围"}</h3>{previewQuery.error ? <p>{previewQuery.error instanceof Error ? previewQuery.error.message : "加载失败"}</p> : null}</div>
        ) : (
          <form className="dissolve-preview" onSubmit={(event) => { event.preventDefault(); setError(""); mutation.mutate(); }}>
            <div className="dissolve-summary">
              <strong>将保留 {preview.counts.retained} 个，永久删除 {preview.counts.deleted} 个</strong>
              <span>{preview.counts.linked > 0 ? `其中 ${preview.counts.linked} 个已关联工作计划，将保留关联。` : "没有实例关联工作计划。"}</span>
            </div>
            <section className="dissolve-group" aria-label="保留为普通月目标">
              <h3>保留为普通月目标（{retained.length}）</h3>
              <div className="dissolve-instance-list">{retained.map((instance) => (
                <div className="dissolve-instance retain" key={instance.id}>
                  <span>{instance.year} 年 {instance.month} 月</span>
                  <strong>{instance.title}</strong>
                  <small>{instance.reasons.map((reason) => dissolveReasonLabels[reason]).join("、")}</small>
                </div>
              ))}</div>
            </section>
            <section className="dissolve-group danger-zone" aria-label="永久删除">
              <h3>永久删除（{deleted.length}）</h3>
              <div className="dissolve-instance-list">{deleted.map((instance) => (
                <div className="dissolve-instance delete" key={instance.id}>
                  <span>{instance.year} 年 {instance.month} 月</span>
                  <strong>{instance.title}</strong>
                  <small>未使用的自动实例</small>
                </div>
              ))}</div>
            </section>
            <label className="field dissolve-confirm"><span>输入目标名称确认</span><input value={confirmationTitle} onChange={(event) => setConfirmationTitle(event.target.value)} placeholder={preview.keepGoal.title} autoComplete="off" /></label>
            <p className="dissolve-warning">此操作不可撤销。请输入“{preview.keepGoal.title}”确认。</p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <footer className="field-dialog-footer">
              <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button>
              <button className="danger-button" type="submit" disabled={busy || confirmationTitle !== preview.keepGoal.title}>{busy ? "解散中…" : `解散并删除 ${preview.counts.deleted} 个目标`}</button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
