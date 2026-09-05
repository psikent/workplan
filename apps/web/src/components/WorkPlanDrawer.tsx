import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { CreateWorkPlan, CustomFieldDefinition, MonthlyGoal, OwnerAccountMapping, OwnerConflictCounterpart, WorkPlan, WorkPlanConflictCheckResponse, WorkPlanSeries, WorkPlanStatus, WorkPlanStatusMode } from "@workplan/contracts";
import { Archive, CalendarClock, Copy, Repeat2, Target, X } from "lucide-react";
import { api, jsonBody } from "../lib/api";
import { formatDate, fromDateTimeLocal, statusLabels, toDateTimeLocal } from "../lib/format";
import { rangeOverlapsMonth } from "../lib/period";

type RecurrenceInput = { frequency: "daily" | "weekly" | "monthly"; interval: number; timeZone: string } | null;

type Props = {
  plan: WorkPlan | null;
  series?: WorkPlanSeries | null | undefined;
  fields: CustomFieldDefinition[];
  monthlyGoals?: MonthlyGoal[];
  monthlyGoalsLoading?: boolean;
  initialDate?: Date | null;
  ownerAccountMappings?: OwnerAccountMapping[];
  ownerAccountMappingsLoading?: boolean;
  ownerAccountMappingsError?: boolean;
  open: boolean;
  saving: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (input: CreateWorkPlan & { version?: number }, recurrence: RecurrenceInput) => Promise<void>;
  onDuplicate?: ((plan: WorkPlan) => Promise<void>) | undefined;
  onDelete?: ((plan: WorkPlan) => Promise<void>) | undefined;
};

function defaultTimes(date = new Date()) {
  const start = new Date(date);
  start.setHours(8, 30, 0, 0);
  const end = new Date(start);
  end.setHours(18, 0, 0, 0);
  return { startAt: toDateTimeLocal(start.toISOString()), endAt: toDateTimeLocal(end.toISOString()) };
}

function defaultCustomValues(fields: CustomFieldDefinition[]) {
  return Object.fromEntries(fields.flatMap((field) => {
    if (field.archivedAt || field.defaultValue == null) return [];
    const value = Array.isArray(field.defaultValue) ? [...field.defaultValue] : field.defaultValue;
    return [[field.key, value]];
  }));
}

function isValidPlanRange(startAt: string, endAt: string): boolean {
  const startTimestamp = Date.parse(startAt);
  const endTimestamp = Date.parse(endAt);
  return Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp) && endTimestamp > startTimestamp;
}

export default function WorkPlanDrawer({ plan, series, fields, monthlyGoals = [], monthlyGoalsLoading = false, initialDate = null, ownerAccountMappings = [], ownerAccountMappingsLoading = false, ownerAccountMappingsError = false, open, saving, readOnly = false, onClose, onSave, onDuplicate, onDelete }: Props) {
  const sortedMonthlyGoals = useMemo(
    () => [...monthlyGoals].sort((left, right) => right.year - left.year || right.month - left.month || left.createdAt.localeCompare(right.createdAt)),
    [monthlyGoals],
  );
  const monthlyGoalsById = useMemo(() => new Map(monthlyGoals.map((goal) => [goal.id, goal])), [monthlyGoals]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkPlanStatus>("pending");
  const [statusMode, setStatusMode] = useState<WorkPlanStatusMode>("automatic");
  const [startAt, setStartAt] = useState(() => defaultTimes(initialDate ?? undefined).startAt);
  const [endAt, setEndAt] = useState(() => defaultTimes(initialDate ?? undefined).endAt);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [monthlyGoalIds, setMonthlyGoalIds] = useState<string[]>([]);
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [interval, setIntervalValue] = useState(1);
  const [error, setError] = useState("");
  const selectedMonthlyGoalIds = useMemo(() => new Set(monthlyGoalIds), [monthlyGoalIds]);
  const visibleMonthlyGoals = useMemo(
    () => sortedMonthlyGoals.filter((goal) => (
      selectedMonthlyGoalIds.has(goal.id)
      || rangeOverlapsMonth(startAt, endAt, goal.year, goal.month)
    )),
    [endAt, selectedMonthlyGoalIds, sortedMonthlyGoals, startAt],
  );
  const validPlanRange = isValidPlanRange(startAt, endAt);

  // 负责人冲突实时提醒（规格 R7）：初始态用 plan 快照携带的 ownerConflict，
  // owner/起止任一变化后防抖调用 conflict-check 覆盖；仅提醒，不阻止保存。
  const [conflictCounterparts, setConflictCounterparts] = useState<OwnerConflictCounterpart[] | null>(null);
  const conflictCheckSequence = useRef(0);
  const ownerValue = typeof customValues.owner === "string" ? customValues.owner : "";
  const conflictCheckKey = `${ownerValue}|${startAt}|${endAt}`;

  // 表单重置只依赖 plan/open/initialDate：series 是异步加载的，若纳入此 effect，
  // 载入完成会把用户正在输入的表单整体打回 plan 快照（丢输入）。
  useEffect(() => {
    const nextDefaults = defaultTimes(initialDate ?? undefined);
    setTitle(plan?.title ?? "");
    setDescription(plan?.description ?? "");
    setStatus(plan?.status ?? "pending");
    setStatusMode(plan?.statusMode ?? "automatic");
    setStartAt(plan ? toDateTimeLocal(plan.startAt) : nextDefaults.startAt);
    setEndAt(plan ? toDateTimeLocal(plan.endAt) : nextDefaults.endAt);
    setCustomValues(plan?.customFields ?? {});
    setMonthlyGoalIds(plan?.monthlyGoalIds ?? []);
    setRecurrence("none");
    setIntervalValue(1);
    setError("");
  }, [initialDate, open, plan]);

  // 系列计划的周期字段随 series 异步载入回填：只动 recurrence/interval，不重置其他字段。
  useEffect(() => {
    if (!open || !plan?.seriesId) return;
    setRecurrence(series?.active ? series.recurrence.frequency : "none");
    setIntervalValue(series?.active ? series.recurrence.interval : 1);
  }, [open, plan, series]);

  useEffect(() => {
    if (!open || plan) return;
    const defaults = defaultCustomValues(fields);
    setCustomValues((current) => ({ ...defaults, ...current }));
  }, [fields, open, plan]);

  // 防抖实时校核：声明在表单重置 effect 之后、初始快照 effect 之前——挂载首轮
  // customValues 尚未重置，其同步清除必须先于快照写入执行，否则会覆盖初始提醒。
  useEffect(() => {
    if (!open) return;
    // owner 为空或起止未填齐/区间非法：不发请求，清除提醒。
    if (!ownerValue || !isValidPlanRange(startAt, endAt)) {
      setConflictCounterparts(null);
      return;
    }
    const startIso = fromDateTimeLocal(startAt);
    const endIso = fromDateTimeLocal(endAt);
    const sequence = ++conflictCheckSequence.current;
    const timer = window.setTimeout(() => {
      api<WorkPlanConflictCheckResponse>("/work-plans/conflict-check", {
        method: "POST",
        ...jsonBody({ ...(plan ? { id: plan.id } : {}), owner: ownerValue, startAt: startIso, endAt: endIso }),
      }).then((result) => {
        // 竞态以最后一次请求为准。
        if (conflictCheckSequence.current !== sequence) return;
        setConflictCounterparts(result.counterparts.length > 0 ? result.counterparts : null);
      }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [conflictCheckKey, open, plan]);

  useEffect(() => {
    if (!open) return;
    setConflictCounterparts(plan?.ownerConflict?.counterparts ?? null);
  }, [open, plan]);

  useEffect(() => {
    if (!open || statusMode !== "automatic" || !startAt || !endAt) return;
    const refreshAutomaticStatus = () => {
      const startTimestamp = Date.parse(startAt);
      const endTimestamp = Date.parse(endAt);
      if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return;
      const automaticStatus = deriveWorkPlanStatus(startAt, endAt);
      setStatus((current) => current === automaticStatus ? current : automaticStatus);
    };
    refreshAutomaticStatus();
    const refreshTimer = window.setInterval(refreshAutomaticStatus, 30_000);
    return () => window.clearInterval(refreshTimer);
  }, [endAt, open, startAt, statusMode]);

  function updatePlanRange(field: "startAt" | "endAt", value: string) {
    if (field === "startAt") setStartAt(value);
    else setEndAt(value);

    const nextStartAt = field === "startAt" ? value : startAt;
    const nextEndAt = field === "endAt" ? value : endAt;
    if (!isValidPlanRange(nextStartAt, nextEndAt)) return;

    setMonthlyGoalIds((current) => current.filter((id) => {
      const goal = monthlyGoalsById.get(id);
      return !goal || rangeOverlapsMonth(nextStartAt, nextEndAt, goal.year, goal.month);
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const startIso = fromDateTimeLocal(startAt);
    const endIso = fromDateTimeLocal(endAt);
    if (Date.parse(startIso) >= Date.parse(endIso)) {
      setError("结束时间必须晚于开始时间");
      return;
    }
    try {
      await onSave(
        {
          title,
          description,
          ...(statusMode === "manual"
            ? { status, statusMode: "manual" as const }
            : { statusMode: "automatic" as const }),
          startAt: startIso,
          endAt: endIso,
          customFields: customValues,
          monthlyGoalIds,
          ...(plan ? { version: plan.version } : {}),
        },
        recurrence === "none" ? null : { frequency: recurrence, interval, timeZone: "Asia/Shanghai" },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }

  async function duplicate() {
    if (!plan || !onDuplicate) return;
    setError("");
    try {
      await onDuplicate(plan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "复制失败");
    }
  }

  if (!open) return null;

  const cycleLoading = Boolean(plan?.seriesId && series === undefined);
  const cycleUnits = { daily: "天", weekly: "周", monthly: "个月" } as const;
  const readOnlyCycleSummary = cycleLoading
    ? "正在读取当前计划周期…"
    : recurrence === "none"
      ? "当前计划仅执行一次。"
      : `每 ${interval} ${cycleUnits[recurrence]}重复。`;
  const cycleSummary = cycleLoading
    ? "正在读取当前计划周期…"
    : recurrence === "none"
      ? series?.active ? "保存后将停止生成后续计划，当前计划会保留。" : "当前计划仅执行一次。"
      : `每 ${interval} ${cycleUnits[recurrence]}重复${plan ? "；保存后同步更新后续未单独调整的计划。" : "。"}`;
  const activeFields = fields
    .filter((field) => !field.archivedAt)
    .sort((left, right) => Number(right.required) - Number(left.required) || left.sortOrder - right.sortOrder);
  const ownerField = activeFields.find((field) => field.key === "owner");
  const ownerOption = ownerField?.options.find((option) => option.value === customValues.owner);
  const accountByOwnerName = new Map(ownerAccountMappings.map((mapping) => [mapping.ownerName, mapping.account]));
  const ownerAccount = ownerOption ? accountByOwnerName.get(ownerOption.label) ?? null : null;
  const ownerAccountDisplay = ownerAccountMappingsLoading
    ? "加载中…"
    : ownerAccountMappingsError
      ? "映射加载失败"
      : ownerAccount ?? "未配置";

  return (
    <>
      <button className="drawer-backdrop" type="button" aria-label="关闭编辑抽屉" onClick={onClose} />
      <aside className="editor-drawer" aria-label={readOnly ? "查看工作计划" : plan ? "编辑工作计划" : "新建工作计划"}>
        <header className="drawer-header">
          <div><h2>{readOnly ? "工作计划详情" : plan ? "编辑工作计划" : "新建工作计划"}</h2><span>{readOnly ? "只读账户仅可查看计划信息与关联数据" : plan?.isException ? "此重复实例已单独调整" : "填写排程与跟进信息"}</span></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        <form
          className="drawer-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (readOnly) return;
            void submit(event);
          }}
        >
          <label className="field full"><span>工作内容 <b>*</b></span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus readOnly={readOnly} /></label>
          <label className="field full"><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={4_000} readOnly={readOnly} /></label>
          <div className="status-field full">
            {readOnly ? (
              <label className="field"><span>状态 <small>{statusMode === "automatic" ? "自动" : "手动"}</small></span><input value={statusLabels[status]} readOnly aria-label="状态" /></label>
            ) : (
              <>
                <label className="field"><span>状态 <b>*</b> <small>{statusMode === "automatic" ? "自动" : "手动"}</small></span><select value={status} onChange={(event) => { setStatus(event.target.value as WorkPlanStatus); setStatusMode("manual"); }}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <div className="status-mode-help"><small>{statusMode === "automatic" ? "根据开始和结束时间自动更新；选择状态后将切换为手动。" : "当前状态由你手动指定，不再随时间自动变化。"}</small>{statusMode === "manual" ? <button className="text-button" type="button" onClick={() => setStatusMode("automatic")}>恢复自动</button> : null}</div>
              </>
            )}
          </div>
          <label className="field"><span>开始时间 <b>*</b></span><input type="datetime-local" value={startAt} onChange={(event) => updatePlanRange("startAt", event.target.value)} required readOnly={readOnly} /></label>
          <label className="field"><span>结束时间 <b>*</b></span><input type="datetime-local" value={endAt} onChange={(event) => updatePlanRange("endAt", event.target.value)} required readOnly={readOnly} /></label>
          <fieldset className="form-section recurrence-section full">
            <legend><Repeat2 />计划周期</legend>
            {readOnly ? (
              <p className="recurrence-summary">{readOnlyCycleSummary}</p>
            ) : (
              <>
                <div className="field-grid compact">
                  <label className="field"><span>周期</span><select value={recurrence} disabled={cycleLoading} onChange={(event) => setRecurrence(event.target.value as typeof recurrence)}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
                  <label className="field"><span>间隔</span><input type="number" min={1} max={365} value={interval} required={recurrence !== "none"} disabled={cycleLoading || recurrence === "none"} onChange={(event) => setIntervalValue(Number(event.target.value))} /></label>
                </div>
                <p className="recurrence-summary">{cycleSummary}</p>
              </>
            )}
          </fieldset>

          <fieldset className="form-section full">
            <legend><Target />月目标</legend>
            {monthlyGoalsLoading ? <p className="recurrence-summary">正在载入月目标…</p> : visibleMonthlyGoals.length > 0 ? (
                <div className="goal-multi-select">
                  {visibleMonthlyGoals.map((goal) => {
                    const occupied = Boolean(goal.linkedWorkPlan) && goal.linkedWorkPlan!.id !== plan?.id;
                    const checked = selectedMonthlyGoalIds.has(goal.id);
                    const outOfRange = checked && validPlanRange && !rangeOverlapsMonth(startAt, endAt, goal.year, goal.month);
                    const label = `${goal.year} 年 ${goal.month} 月 · ${goal.title}${outOfRange ? "（当前关联，不在计划覆盖月份）" : ""}`;
                    return (
                      <label key={goal.id} className={`goal-option ${occupied ? "disabled" : ""}`} title={occupied ? "该目标已关联其他工作计划" : label}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={readOnly || occupied}
                          onChange={(event) => setMonthlyGoalIds((current) => event.target.checked ? [...current, goal.id] : current.filter((id) => id !== goal.id))}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
            ) : <p className="recurrence-summary">计划覆盖月份内暂无可关联月目标</p>}
          </fieldset>

          {activeFields.length > 0 ? (
            <fieldset className="form-section full">
              <legend><CalendarClock />自定义字段</legend>
              <div className="custom-field-list">{activeFields.map((field) => (
                <Fragment key={field.id}>
                  {field.key === "owner" ? (
                    <div className={`owner-conflict-zone${conflictCounterparts ? " owner-conflict-active" : ""}`}>
                      <CustomFieldControl field={field} value={customValues[field.key]} disabled={readOnly} onChange={(value) => setCustomValues((current) => ({ ...current, [field.key]: value }))} />
                      <label className="field derived-field"><span>工作负责人账号</span><input value={ownerAccountDisplay} readOnly aria-readonly="true" /></label>
                      {conflictCounterparts ? (
                        <p className="owner-conflict-hint" role="status">
                          该负责人在此时段已有其他任务：{conflictCounterparts.map((counterpart) => `与【${counterpart.label}】${formatDate(counterpart.startAt, true)} - ${formatDate(counterpart.endAt, true)} 时间冲突`).join("；")}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <CustomFieldControl field={field} value={customValues[field.key]} disabled={readOnly} onChange={(value) => setCustomValues((current) => ({ ...current, [field.key]: value }))} />
                  )}
                </Fragment>
              ))}</div>
            </fieldset>
          ) : null}
          {error ? <div className="form-error full" role="alert">{error}</div> : null}
          <footer className="drawer-actions full">
            {readOnly ? (
              <div className="drawer-secondary-actions" />
            ) : (
              <div className="drawer-secondary-actions">
                {plan && onDelete ? <button className="danger-button" type="button" disabled={saving} onClick={() => void onDelete(plan)}><Archive />删除</button> : null}
                {plan && onDuplicate ? <button className="secondary-button" type="button" disabled={saving} onClick={() => void duplicate()}><Copy />复制</button> : null}
              </div>
            )}
            <div><button className="secondary-button" type="button" onClick={onClose}>{readOnly ? "关闭" : "取消"}</button>{readOnly ? null : <button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button>}</div>
          </footer>
        </form>
      </aside>
    </>
  );
}

function CustomFieldControl({ field, value, onChange, disabled = false }: { field: CustomFieldDefinition; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
  const label = <span>{field.label}{field.required ? <b> *</b> : null}</span>;
  if (field.type === "boolean") return <label className="field toggle-field">{label}<button className={`switch ${value ? "on" : ""}`} type="button" disabled={disabled} onClick={() => onChange(!value)}><i /></button></label>;
  if (field.type === "single_select") return <label className="field">{label}<select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value || null)} required={field.required}><option value="">请选择</option>{field.options.filter((option) => !option.archivedAt).map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>;
  if (field.type === "multi_select") return <label className="field">{label}<select multiple disabled={disabled} value={Array.isArray(value) ? value as string[] : []} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{field.options.filter((option) => !option.archivedAt).map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>;
  if (field.type === "long_text") return <label className="field">{label}<textarea rows={2} value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)} required={field.required} /></label>;
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "url" ? "url" : "text";
  const shownValue = field.type === "datetime" && typeof value === "string" ? toDateTimeLocal(value) : value == null ? "" : String(value);
  return <label className="field">{label}<input type={inputType} value={shownValue} disabled={disabled} onChange={(event) => onChange(field.type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : field.type === "datetime" && event.target.value ? fromDateTimeLocal(event.target.value) : event.target.value)} required={field.required} /></label>;
}
