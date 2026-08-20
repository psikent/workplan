import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { deriveWorkPlanStatus } from "@workplan/contracts";
import type { CreateWorkPlan, CustomFieldDefinition, OwnerAccountMapping, WorkPlan, WorkPlanSeries, WorkPlanStatus, WorkPlanStatusMode } from "@workplan/contracts";
import { Archive, CalendarClock, Copy, Repeat2, X } from "lucide-react";
import { fromDateTimeLocal, statusLabels, toDateTimeLocal } from "../lib/format";

type RecurrenceInput = { frequency: "daily" | "weekly" | "monthly"; interval: number; timeZone: string } | null;

type Props = {
  plan: WorkPlan | null;
  series?: WorkPlanSeries | null | undefined;
  fields: CustomFieldDefinition[];
  initialDate?: Date | null;
  ownerAccountMappings?: OwnerAccountMapping[];
  ownerAccountMappingsLoading?: boolean;
  ownerAccountMappingsError?: boolean;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (input: CreateWorkPlan & { version?: number }, recurrence: RecurrenceInput) => Promise<void>;
  onDuplicate?: (plan: WorkPlan) => Promise<void>;
  onDelete?: (plan: WorkPlan) => Promise<void>;
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

export default function WorkPlanDrawer({ plan, series, fields, initialDate = null, ownerAccountMappings = [], ownerAccountMappingsLoading = false, ownerAccountMappingsError = false, open, saving, onClose, onSave, onDuplicate, onDelete }: Props) {
  const defaults = useMemo(() => defaultTimes(initialDate ?? undefined), [initialDate, open]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkPlanStatus>("pending");
  const [statusMode, setStatusMode] = useState<WorkPlanStatusMode>("automatic");
  const [startAt, setStartAt] = useState(defaults.startAt);
  const [endAt, setEndAt] = useState(defaults.endAt);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [interval, setIntervalValue] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextDefaults = defaultTimes(initialDate ?? undefined);
    setTitle(plan?.title ?? "");
    setDescription(plan?.description ?? "");
    setStatus(plan?.status ?? "pending");
    setStatusMode(plan?.statusMode ?? "automatic");
    setStartAt(plan ? toDateTimeLocal(plan.startAt) : nextDefaults.startAt);
    setEndAt(plan ? toDateTimeLocal(plan.endAt) : nextDefaults.endAt);
    setCustomValues(plan?.customFields ?? {});
    setRecurrence(series?.active ? series.recurrence.frequency : "none");
    setIntervalValue(series?.active ? series.recurrence.interval : 1);
    setError("");
  }, [initialDate, open, plan, series]);

  useEffect(() => {
    if (!open || plan) return;
    const defaults = defaultCustomValues(fields);
    setCustomValues((current) => ({ ...defaults, ...current }));
  }, [fields, open, plan]);

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
      <aside className="editor-drawer" aria-label={plan ? "编辑工作计划" : "新建工作计划"}>
        <header className="drawer-header">
          <div><h2>{plan ? "编辑工作计划" : "新建工作计划"}</h2><span>{plan?.isException ? "此重复实例已单独调整" : "填写排程与跟进信息"}</span></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        <form className="drawer-form" onSubmit={submit}>
          <label className="field full"><span>工作内容 <b>*</b></span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus /></label>
          <label className="field full"><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={4_000} /></label>
          <div className="status-field full">
            <label className="field"><span>状态 <b>*</b> <small>{statusMode === "automatic" ? "自动" : "手动"}</small></span><select value={status} onChange={(event) => { setStatus(event.target.value as WorkPlanStatus); setStatusMode("manual"); }}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <div className="status-mode-help"><small>{statusMode === "automatic" ? "根据开始和结束时间自动更新；选择状态后将切换为手动。" : "当前状态由你手动指定，不再随时间自动变化。"}</small>{statusMode === "manual" ? <button className="text-button" type="button" onClick={() => setStatusMode("automatic")}>恢复自动</button> : null}</div>
          </div>
          <label className="field"><span>开始时间 <b>*</b></span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} required /></label>
          <label className="field"><span>结束时间 <b>*</b></span><input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} required /></label>
          <fieldset className="form-section recurrence-section full">
            <legend><Repeat2 />计划周期</legend>
            <div className="field-grid compact">
              <label className="field"><span>周期</span><select value={recurrence} disabled={cycleLoading} onChange={(event) => setRecurrence(event.target.value as typeof recurrence)}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
              <label className="field"><span>间隔</span><input type="number" min={1} max={365} value={interval} required={recurrence !== "none"} disabled={cycleLoading || recurrence === "none"} onChange={(event) => setIntervalValue(Number(event.target.value))} /></label>
            </div>
            <p className="recurrence-summary">{cycleSummary}</p>
          </fieldset>

          {activeFields.length > 0 ? (
            <fieldset className="form-section full">
              <legend><CalendarClock />自定义字段</legend>
              <div className="custom-field-list">{activeFields.map((field) => (
                <Fragment key={field.id}>
                  <CustomFieldControl field={field} value={customValues[field.key]} onChange={(value) => setCustomValues((current) => ({ ...current, [field.key]: value }))} />
                  {field.key === "owner" ? <label className="field derived-field"><span>工作负责人账号</span><input value={ownerAccountDisplay} readOnly aria-readonly="true" /></label> : null}
                </Fragment>
              ))}</div>
            </fieldset>
          ) : null}
          {error ? <div className="form-error full" role="alert">{error}</div> : null}
          <footer className="drawer-actions full">
            <div className="drawer-secondary-actions">
              {plan && onDelete ? <button className="danger-button" type="button" disabled={saving} onClick={() => void onDelete(plan)}><Archive />删除</button> : null}
              {plan && onDuplicate ? <button className="secondary-button" type="button" disabled={saving} onClick={() => void duplicate()}><Copy />复制</button> : null}
            </div>
            <div><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></div>
          </footer>
        </form>
      </aside>
    </>
  );
}

function CustomFieldControl({ field, value, onChange }: { field: CustomFieldDefinition; value: unknown; onChange: (value: unknown) => void }) {
  const label = <span>{field.label}{field.required ? <b> *</b> : null}</span>;
  if (field.type === "boolean") return <label className="field toggle-field">{label}<button className={`switch ${value ? "on" : ""}`} type="button" onClick={() => onChange(!value)}><i /></button></label>;
  if (field.type === "single_select") return <label className="field">{label}<select value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)} required={field.required}><option value="">请选择</option>{field.options.filter((option) => !option.archivedAt).map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>;
  if (field.type === "multi_select") return <label className="field">{label}<select multiple value={Array.isArray(value) ? value as string[] : []} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{field.options.filter((option) => !option.archivedAt).map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>;
  if (field.type === "long_text") return <label className="field">{label}<textarea rows={2} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} required={field.required} /></label>;
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "url" ? "url" : "text";
  const shownValue = field.type === "datetime" && typeof value === "string" ? toDateTimeLocal(value) : value == null ? "" : String(value);
  return <label className="field">{label}<input type={inputType} value={shownValue} onChange={(event) => onChange(field.type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : field.type === "datetime" && event.target.value ? fromDateTimeLocal(event.target.value) : event.target.value)} required={field.required} /></label>;
}
