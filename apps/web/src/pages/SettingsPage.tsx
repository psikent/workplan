import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CustomFieldDefinition,
  EnvConfigImportOutcome,
  EnvConfigImportResult,
  EnvConfigImportMode,
  EnvConfigOptionPlanItem,
  EnvConfigPackage,
  EnvConfigPlan,
  EnvConfigSection,
  ExportTemplate,
  ExportTemplateColumn,
  OwnerAccountMapping,
} from "@workplan/contracts";
import { ArrowDown, ArrowUp, BookOpen, ClipboardCopy, DatabaseBackup, Download, FileSpreadsheet, Pencil, Plus, Save, Settings2, Trash2, Upload, UsersRound, X } from "lucide-react";
import { useToast } from "../components/ToastProvider";
import { api, downloadEnvConfig, downloadExport, jsonBody } from "../lib/api";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const [importMessage, setImportMessage] = useState("");

  async function exportFile() {
    setImportMessage("");
    try {
      await downloadExport();
      showSuccess("JSON 已导出");
    } catch (caught) {
      setImportMessage(caught instanceof Error ? caught.message : "导出失败");
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportMessage("正在校验…");
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      await api("/import/validate", { method: "POST", ...jsonBody(payload) });
      if (!window.confirm("导入会替换全部业务数据，管理员账户和令牌不受影响。继续吗？")) {
        setImportMessage("已取消导入");
        return;
      }
      await api("/import", { method: "POST", ...jsonBody(payload) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["custom-fields"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-account-mappings"] }),
      ]);
      setImportMessage("导入完成");
      showSuccess("数据导入成功");
    } catch (caught) {
      setImportMessage(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <section className="content-page narrow-page">
      <header className="page-header"><div><h1>设置</h1><p>管理数据备份、负责人账号映射、导出模板和接口文档。</p></div></header>
      <div className="settings-stack">
        <section className="settings-section">
          <header><div><DatabaseBackup /><span><strong>数据导入导出</strong><small>版本化 JSON 包含全部工作计划、自定义字段、负责人账号映射和重复规则。</small></span></div></header>
          <div className="settings-actions"><button className="secondary-button" type="button" onClick={() => void exportFile()}><Download />导出 JSON</button><label className="secondary-button file-button"><Upload />导入 JSON<input type="file" accept="application/json,.json" onChange={(event) => void importFile(event)} /></label>{importMessage ? <span>{importMessage}</span> : null}</div>
        </section>

        <EnvironmentConfigSettings />

        <OwnerAccountMappingSettings />

        <ExportTemplateSettings />

        <section className="settings-section">
          <header><div><BookOpen /><span><strong>接口文档</strong><small>使用个人访问令牌从外部脚本调用 REST API。</small></span></div><a className="secondary-button" href="/api/docs" target="_blank" rel="noreferrer">打开 OpenAPI</a></header>
        </section>
      </div>
    </section>
  );
}

function EnvironmentConfigSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const validationRequestRef = useRef(0);
  const fileReadRequestRef = useRef(0);
  const [error, setError] = useState("");
  const [packageText, setPackageText] = useState("");
  const [mode, setMode] = useState<EnvConfigImportMode>("additive");
  const [plan, setPlan] = useState<EnvConfigPlan | null>(null);
  const [validatedPackage, setValidatedPackage] = useState<unknown>(null);
  const [selectedSections, setSelectedSections] = useState<EnvConfigSectionSelection>({ ...allEnvConfigSectionsSelected });
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<EnvConfigImportResult | null>(null);
  const selectedSectionCount = envConfigSectionDefinitions.filter((section) => selectedSections[section.key]).length;
  const requiresDestructiveConfirmation = Boolean(plan && plan.mode === "sync" && envConfigSectionDefinitions.some(
    (section) => selectedSections[section.key] && envConfigSectionHasDestructive(plan, section.key),
  ));

  async function copyConfig() {
    setError("");
    try {
      const envConfigPackage = await api<EnvConfigPackage>("/env-config");
      await navigator.clipboard.writeText(JSON.stringify(envConfigPackage, null, 2));
      showSuccess("环境配置已复制");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "复制配置失败");
    }
  }

  async function downloadConfig() {
    setError("");
    try {
      await downloadEnvConfig();
      showSuccess("环境配置文件已下载");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "环境配置下载失败");
    }
  }

  function changePackageText(value: string) {
    if (isImporting) return;
    validationRequestRef.current += 1;
    fileReadRequestRef.current += 1;
    setIsValidating(false);
    setPackageText(value);
    setPlan(null);
    setValidatedPackage(null);
    setConfirmDestructive(false);
    setResult(null);
    setError("");
  }

  function changeMode(value: EnvConfigImportMode) {
    if (isImporting) return;
    validationRequestRef.current += 1;
    setIsValidating(false);
    setMode(value);
    setPlan(null);
    setValidatedPackage(null);
    setConfirmDestructive(false);
    setResult(null);
    setError("");
  }

  async function loadConfigFile(event: ChangeEvent<HTMLInputElement>) {
    if (isImporting) return;
    const file = event.target.files?.[0];
    if (!file) return;
    changePackageText("");
    const requestId = fileReadRequestRef.current;
    try {
      const contents = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("环境配置文件读取失败"));
        reader.readAsText(file);
      });
      if (fileReadRequestRef.current !== requestId) return;
      changePackageText(contents);
    } catch (caught) {
      if (fileReadRequestRef.current !== requestId) return;
      setError(caught instanceof Error ? caught.message : "环境配置文件读取失败");
    } finally {
      event.target.value = "";
    }
  }

  async function validateConfig() {
    if (isImporting) return;
    const requestId = validationRequestRef.current + 1;
    validationRequestRef.current = requestId;
    setError("");
    setPlan(null);
    setValidatedPackage(null);
    setConfirmDestructive(false);
    setResult(null);
    setIsValidating(true);
    try {
      const parsedPackage = JSON.parse(packageText) as unknown;
      const nextPlan = await api<EnvConfigPlan>("/env-config/validate", {
        method: "POST",
        ...jsonBody({ package: parsedPackage, mode }),
      });
      if (validationRequestRef.current !== requestId) return;
      setValidatedPackage(parsedPackage);
      setSelectedSections({ ...allEnvConfigSectionsSelected });
      setPlan(nextPlan);
    } catch (caught) {
      if (validationRequestRef.current !== requestId) return;
      setError(caught instanceof SyntaxError
        ? "环境配置 JSON 格式无效"
        : caught instanceof Error ? caught.message : "环境配置校验失败");
    } finally {
      if (validationRequestRef.current === requestId) setIsValidating(false);
    }
  }

  async function executeImport() {
    if (!plan || !validatedPackage || isImporting) return;
    const sections = envConfigSectionDefinitions.flatMap((section) => selectedSections[section.key] ? [section.key] : []);
    if (sections.length === 0) return;
    setError("");
    setResult(null);
    setIsImporting(true);
    try {
      const nextResult = await api<EnvConfigImportResult>("/env-config/import", {
        method: "POST",
        ...jsonBody({ package: validatedPackage, mode: plan.mode, sections, confirmDestructive }),
      });
      setResult(nextResult);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["custom-fields"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-account-mappings"] }),
        queryClient.invalidateQueries({ queryKey: ["export-templates"] }),
        queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
      ]);
      showSuccess("环境配置导入完成");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "环境配置导入失败");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="settings-section env-config-section" aria-busy={isValidating || isImporting}>
      <header>
        <div><Settings2 /><span><strong>环境配置</strong><small>复制或导入自定义字段、负责人账号映射和 XLS 导出模板。</small></span></div>
      </header>
      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={() => void copyConfig()}><ClipboardCopy />复制配置</button>
        <button className="secondary-button" type="button" onClick={() => void downloadConfig()}><Download />下载配置文件</button>
      </div>
      <div className="env-config-import">
        <label className="env-config-paste">粘贴环境配置 JSON<textarea aria-label="粘贴环境配置 JSON" value={packageText} disabled={isImporting} onChange={(event) => changePackageText(event.target.value)} placeholder="在此粘贴 Environment Configuration Package JSON" /></label>
        <div className="env-config-import-controls">
          <label>导入模式<select aria-label="导入模式" value={mode} disabled={isImporting} onChange={(event) => changeMode(event.target.value as EnvConfigImportMode)}><option value="additive">增量导入</option><option value="sync">同步导入</option></select></label>
          <label className={`secondary-button file-button${isImporting ? " disabled" : ""}`}><Upload />上传配置文件<input aria-label="上传环境配置文件" type="file" accept="application/json,.json" disabled={isImporting} onChange={(event) => void loadConfigFile(event)} /></label>
          <button className="primary-button" type="button" disabled={!packageText.trim() || isValidating || isImporting} onClick={() => void validateConfig()}>{isValidating ? "正在校验…" : "校验并预览"}</button>
        </div>
      </div>
      {plan && validatedPackage ? (
        <>
          <EnvironmentConfigPreview plan={plan} selectedSections={selectedSections} disabled={isImporting} onToggleSection={(section) => {
            if (isImporting) return;
            setConfirmDestructive(false);
            setResult(null);
            setSelectedSections((current) => ({ ...current, [section]: !current[section] }));
          }} />
          <div className="env-config-execute">
            {requiresDestructiveConfirmation ? <label className="env-config-destructive-confirm"><input type="checkbox" aria-label="我已确认破坏性变更" checked={confirmDestructive} disabled={isImporting} onChange={(event) => setConfirmDestructive(event.target.checked)} />我已确认破坏性变更</label> : <span />}
            <button className="primary-button" type="button" disabled={isImporting || selectedSectionCount === 0 || (requiresDestructiveConfirmation && !confirmDestructive)} onClick={() => void executeImport()}>{isImporting ? "正在导入…" : "执行导入"}</button>
          </div>
        </>
      ) : null}
      {result ? <EnvironmentConfigResultSummary result={result} /> : null}
      {error ? <div className="form-error env-config-error" role="alert">{error}</div> : null}
    </section>
  );
}

type EnvConfigSectionSelection = Record<EnvConfigSection, boolean>;
type EnvConfigPlanItem =
  | EnvConfigPlan["sections"]["customFields"][number]
  | EnvConfigPlan["sections"]["ownerAccountMappings"][number]
  | EnvConfigPlan["sections"]["exportTemplates"][number]
  | EnvConfigOptionPlanItem;
type EnvConfigResultItem =
  | EnvConfigImportResult["sections"]["customFields"][number]
  | NonNullable<EnvConfigImportResult["sections"]["customFields"][number]["options"]>[number]
  | EnvConfigImportResult["sections"]["ownerAccountMappings"][number]
  | EnvConfigImportResult["sections"]["exportTemplates"][number];

const allEnvConfigSectionsSelected: EnvConfigSectionSelection = {
  customFields: true,
  ownerAccountMappings: true,
  exportTemplates: true,
};

const envConfigSectionDefinitions: ReadonlyArray<{
  key: EnvConfigSection;
  label: string;
  checkboxLabel: string;
}> = [
  { key: "customFields", label: "自定义字段", checkboxLabel: "导入自定义字段" },
  { key: "ownerAccountMappings", label: "负责人账号映射", checkboxLabel: "导入负责人账号映射" },
  { key: "exportTemplates", label: "XLS 导出模板", checkboxLabel: "导入 XLS 导出模板" },
];

const envConfigActionLabels: Record<EnvConfigPlanItem["action"], string> = {
  create: "新增",
  update: "更新",
  retire: "停用",
  delete: "删除",
  skip: "跳过",
  set_required: "设为必填",
  add_option: "新增选项",
  retire_option: "停用选项",
  update_option: "更新选项",
};

const envConfigReasonLabels: Record<NonNullable<EnvConfigPlanItem["reason"]>, string> = {
  key_exists: "字段稳定键已存在",
  owner_exists: "负责人已存在",
  template_name_exists: "模板名称已存在",
  select_without_options: "选择字段没有选项",
  required_without_default: "必填字段没有默认值",
  missing_field_ref: "模板引用的字段不存在",
  type_conflict: "字段类型冲突",
};

const envConfigOutcomeLabels: Record<EnvConfigImportOutcome, string> = {
  created: "已创建",
  updated: "已更新",
  retired: "已停用",
  deleted: "已删除",
  skipped: "已跳过",
  not_selected: "未选择",
};

const envConfigOutcomeOrder: EnvConfigImportOutcome[] = ["created", "updated", "retired", "deleted", "skipped", "not_selected"];

function EnvironmentConfigPreview({
  plan,
  selectedSections,
  disabled,
  onToggleSection,
}: {
  plan: EnvConfigPlan;
  selectedSections: EnvConfigSectionSelection;
  disabled: boolean;
  onToggleSection: (section: EnvConfigSection) => void;
}) {
  return (
    <div className="env-config-preview">
      <h3>校验预览</h3>
      {envConfigSectionDefinitions.map((section) => {
        const items = getEnvConfigSectionItems(plan, section.key);
        return (
          <section className="env-config-preview-section" key={section.key}>
            <header>
              <label><input type="checkbox" aria-label={section.checkboxLabel} checked={selectedSections[section.key]} disabled={disabled} onChange={() => onToggleSection(section.key)} />{section.label}</label>
              <span>{items.length} 项</span>
            </header>
            {items.length > 0 ? (
              <ul className="env-config-plan-list">
                {items.map((item, index) => (
                  <li key={`${section.key}-${envConfigPlanItemIdentity(item)}-${index}`}>
                    <EnvironmentConfigPlanRow item={item} />
                    {"options" in item && item.options?.length ? (
                      <ul className="env-config-option-list">{item.options.map((option, optionIndex) => <li key={`${option.value}-${optionIndex}`}><EnvironmentConfigPlanRow item={option} /></li>)}</ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="env-config-empty-section">无变更</p>}
          </section>
        );
      })}
    </div>
  );
}

function EnvironmentConfigPlanRow({ item }: { item: EnvConfigPlanItem }) {
  const skipped = item.action === "skip";
  return (
    <div className={`env-config-plan-row ${item.grade}${skipped ? " skipped" : ""}`}>
      <strong>{envConfigPlanItemName(item)}</strong>
      <span className="env-config-action">{envConfigActionLabels[item.action]}</span>
      <span className="env-config-grade">{item.grade === "destructive" ? "破坏性" : "安全"}</span>
      {item.reason ? <small>{envConfigReasonLabels[item.reason]}</small> : null}
    </div>
  );
}

function EnvironmentConfigResultSummary({ result }: { result: EnvConfigImportResult }) {
  return (
    <div className="env-config-result">
      <h3>导入结果</h3>
      <ul>{envConfigSectionDefinitions.map((section) => (
        <li key={section.key}>{`${section.label}：${summarizeEnvConfigOutcomes(getEnvConfigResultItems(result, section.key))}`}</li>
      ))}</ul>
    </div>
  );
}

function getEnvConfigSectionItems(plan: EnvConfigPlan, section: EnvConfigSection): EnvConfigPlanItem[] {
  if (section === "customFields") return plan.sections.customFields;
  if (section === "ownerAccountMappings") return plan.sections.ownerAccountMappings;
  return plan.sections.exportTemplates;
}

function envConfigSectionHasDestructive(plan: EnvConfigPlan, section: EnvConfigSection): boolean {
  return getEnvConfigSectionItems(plan, section).some(
    (item) => item.grade === "destructive" || ("options" in item && item.options?.some((option) => option.grade === "destructive")),
  );
}

function getEnvConfigResultItems(result: EnvConfigImportResult, section: EnvConfigSection): EnvConfigResultItem[] {
  if (section === "customFields") {
    return result.sections.customFields.flatMap((item) => [item, ...(item.options ?? [])]);
  }
  if (section === "ownerAccountMappings") return result.sections.ownerAccountMappings;
  return result.sections.exportTemplates;
}

function summarizeEnvConfigOutcomes(items: EnvConfigResultItem[]): string {
  const summaries = envConfigOutcomeOrder.flatMap((outcome) => {
    const count = items.filter((item) => item.outcome === outcome).length;
    return count > 0 ? [`${envConfigOutcomeLabels[outcome]} ${count} 项`] : [];
  });
  return summaries.length > 0 ? summaries.join("，") : "无变更";
}

function envConfigPlanItemName(item: EnvConfigPlanItem): string {
  if ("ownerName" in item) return item.ownerName;
  if ("name" in item) return item.name;
  return item.label;
}

function envConfigPlanItemIdentity(item: EnvConfigPlanItem): string {
  if ("key" in item) return item.key;
  if ("ownerName" in item) return item.ownerName;
  if ("name" in item) return item.name;
  return item.value;
}

type MappingUpdate = {
  currentOwnerName: string;
  mapping: OwnerAccountMapping;
};

function OwnerAccountMappingSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const mappingsQuery = useQuery({
    queryKey: ["owner-account-mappings"],
    queryFn: () => api<OwnerAccountMapping[]>("/owner-account-mappings"),
  });
  const fieldsQuery = useQuery({
    queryKey: ["custom-fields"],
    queryFn: () => api<CustomFieldDefinition[]>("/custom-fields"),
  });
  const [ownerName, setOwnerName] = useState("");
  const [account, setAccount] = useState("");
  const [editingOwnerName, setEditingOwnerName] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<OwnerAccountMapping | null>(null);

  const mappings = mappingsQuery.data ?? [];
  const ownerField = fieldsQuery.data?.find((field) => field.key === "owner" && !field.archivedAt);
  const ownerOptionNames = (ownerField?.options ?? [])
    .filter((option) => !option.archivedAt)
    .map((option) => option.label);
  const ownerOptionNameSet = new Set(ownerOptionNames);
  const mappingByOwnerName = new Map(mappings.map((mapping) => [mapping.ownerName, mapping]));
  const unmappedOwnerNames = ownerOptionNames.filter((name) => !mappingByOwnerName.has(name));

  async function invalidateDerivedAccounts() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["owner-account-mappings"] }),
      queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
    ]);
  }

  const createMapping = useMutation({
    mutationFn: (mapping: OwnerAccountMapping) => api<OwnerAccountMapping>("/owner-account-mappings", {
      method: "POST",
      ...jsonBody(mapping),
    }),
    onSuccess: async () => {
      setOwnerName("");
      setAccount("");
      await invalidateDerivedAccounts();
      showSuccess("负责人账号映射已创建");
    },
  });
  const updateMapping = useMutation({
    mutationFn: ({ currentOwnerName, mapping }: MappingUpdate) => api<OwnerAccountMapping>(
      `/owner-account-mappings/${encodeURIComponent(currentOwnerName)}`,
      { method: "PUT", ...jsonBody(mapping) },
    ),
    onSuccess: async () => {
      setEditingOwnerName(null);
      setEditDraft(null);
      await invalidateDerivedAccounts();
      showSuccess("负责人账号映射已保存");
    },
  });
  const deleteMapping = useMutation({
    mutationFn: (name: string) => api<void>(`/owner-account-mappings/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: async (_data, deletedOwnerName) => {
      if (editingOwnerName === deletedOwnerName) {
        setEditingOwnerName(null);
        setEditDraft(null);
      }
      await invalidateDerivedAccounts();
      showSuccess("负责人账号映射已删除");
    },
  });

  function submitNewMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateMapping.reset();
    deleteMapping.reset();
    createMapping.mutate({ ownerName: ownerName.trim(), account: account.trim() });
  }

  function beginEdit(mapping: OwnerAccountMapping) {
    createMapping.reset();
    updateMapping.reset();
    deleteMapping.reset();
    setEditingOwnerName(mapping.ownerName);
    setEditDraft({ ...mapping });
  }

  function cancelEdit() {
    updateMapping.reset();
    setEditingOwnerName(null);
    setEditDraft(null);
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingOwnerName || !editDraft) return;
    createMapping.reset();
    deleteMapping.reset();
    updateMapping.mutate({
      currentOwnerName: editingOwnerName,
      mapping: { ownerName: editDraft.ownerName.trim(), account: editDraft.account.trim() },
    });
  }

  function confirmDelete(name: string) {
    if (!window.confirm(`删除“${name}”的账号映射后，相关工作计划将立即显示为未配置。继续吗？`)) return;
    createMapping.reset();
    updateMapping.reset();
    deleteMapping.mutate(name);
  }

  const mutationError = createMapping.error ?? updateMapping.error ?? deleteMapping.error;

  return (
    <section className="settings-section owner-account-mapping-section">
      <header>
        <div><UsersRound /><span><strong>工作负责人账号映射</strong><small>维护负责人姓名与 4A 账号的对应关系；工作计划会实时派生，只读且不单独保存。</small></span></div>
        <span className="mapping-count">{mappings.length} 条映射</span>
      </header>

      {fieldsQuery.isError ? (
        <div className="mapping-coverage mapping-coverage-error">负责人选项加载失败，暂时无法核对映射覆盖情况。</div>
      ) : fieldsQuery.isLoading ? (
        <div className="mapping-coverage">正在核对负责人选项…</div>
      ) : unmappedOwnerNames.length > 0 ? (
        <div className="mapping-coverage">
          <strong>待配置负责人</strong>
          <span>{unmappedOwnerNames.map((name) => (
            <button key={name} type="button" onClick={() => setOwnerName(name)}>为 {name} 配置</button>
          ))}</span>
        </div>
      ) : (
        <div className="mapping-coverage mapping-coverage-complete">当前负责人选项均已配置账号。</div>
      )}

      <form className="owner-mapping-create" onSubmit={submitNewMapping}>
        <label>工作负责人<input aria-label="新增映射工作负责人" list="owner-account-owner-options" maxLength={80} required value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="输入姓名" /></label>
        <datalist id="owner-account-owner-options">{ownerOptionNames.map((name) => <option key={name} value={name} />)}</datalist>
        <label>工作负责人账号<input aria-label="新增映射工作负责人账号" type="email" maxLength={254} required value={account} onChange={(event) => setAccount(event.target.value)} placeholder="name@zh.gd.csg.cn" /></label>
        <button className="primary-button" type="submit" disabled={createMapping.isPending || !ownerName.trim() || !account.trim()}><Plus />新增映射</button>
      </form>

      {mutationError ? <div className="form-error owner-mapping-error">{mutationError.message}</div> : null}

      {mappingsQuery.isError ? (
        <div className="empty-state"><p>映射表加载失败，请稍后重试。</p></div>
      ) : mappingsQuery.isLoading ? (
        <div className="empty-state"><p>正在载入映射表…</p></div>
      ) : mappings.length === 0 ? (
        <div className="empty-state"><p>尚未配置任何负责人账号映射。</p></div>
      ) : (
        <div className="owner-mapping-table-wrap">
          <table className="owner-mapping-table">
            <thead><tr><th>工作负责人</th><th>工作负责人账号</th><th>负责人选项状态</th><th>操作</th></tr></thead>
            <tbody>{mappings.map((mapping) => {
              const editing = editingOwnerName === mapping.ownerName && editDraft;
              return editing ? (
                <tr key={mapping.ownerName}>
                  <td colSpan={4}>
                    <form className="owner-mapping-edit" onSubmit={submitEdit}>
                      <input aria-label={`编辑 ${mapping.ownerName} 的工作负责人`} list="owner-account-owner-options" maxLength={80} required value={editing.ownerName} onChange={(event) => setEditDraft({ ...editing, ownerName: event.target.value })} />
                      <input aria-label={`编辑 ${mapping.ownerName} 的工作负责人账号`} type="email" maxLength={254} required value={editing.account} onChange={(event) => setEditDraft({ ...editing, account: event.target.value })} />
                      <span className="owner-mapping-row-actions">
                        <button className="primary-button compact-button" type="submit" disabled={updateMapping.isPending || !editing.ownerName.trim() || !editing.account.trim()}><Save />保存</button>
                        <button className="secondary-button compact-button" type="button" aria-label={`取消编辑 ${mapping.ownerName}`} onClick={cancelEdit}><X />取消</button>
                      </span>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={mapping.ownerName}>
                  <td><strong>{mapping.ownerName}</strong></td>
                  <td><span className="mapping-account">{mapping.account}</span></td>
                  <td><span className={ownerOptionNameSet.has(mapping.ownerName) ? "mapping-status linked" : "mapping-status detached"}>{ownerOptionNameSet.has(mapping.ownerName) ? "已关联" : "当前无对应选项"}</span></td>
                  <td><span className="owner-mapping-row-actions"><button className="icon-button" type="button" aria-label={`编辑 ${mapping.ownerName}`} onClick={() => beginEdit(mapping)}><Pencil /></button><button className="icon-button danger-icon-button" type="button" aria-label={`删除 ${mapping.ownerName}`} onClick={() => confirmDelete(mapping.ownerName)}><Trash2 /></button></span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <footer className="owner-mapping-note">初始数据来源于 Notion“班组人员4A账户”；修改映射后，详情抽屉与后续 XLS 导出会立即使用新账号。</footer>
    </section>
  );
}

const standardTemplateColumns: ExportTemplateColumn[] = [
  { source: "title", header: "工作内容" },
  { source: "status", header: "状态" },
  { source: "startAt", header: "开始时间" },
  { source: "endAt", header: "结束时间" },
];

function ExportTemplateSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const templatesQuery = useQuery({ queryKey: ["export-templates"], queryFn: () => api<ExportTemplate[]>("/export-templates") });
  const fieldsQuery = useQuery({ queryKey: ["custom-fields"], queryFn: () => api<CustomFieldDefinition[]>("/custom-fields") });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ExportTemplate | null>(null);
  const templates = templatesQuery.data ?? [];
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    setDraft(selected ? { ...selected, columns: selected.columns.map((column) => ({ ...column })) } : null);
  }, [selected?.id, selected?.version]);

  const availableColumns = useMemo(() => [
    { source: "title", label: "工作内容", kind: "内置属性" },
    { source: "description", label: "说明", kind: "内置属性" },
    { source: "status", label: "状态", kind: "内置属性" },
    { source: "startAt", label: "开始时间", kind: "内置属性" },
    { source: "endAt", label: "结束时间", kind: "内置属性" },
    ...(fieldsQuery.data ?? []).filter((field) => !field.archivedAt).flatMap((field) => [
      { source: `custom:${field.key}`, label: field.label, kind: "自定义字段" },
      ...(field.key === "owner" ? [{ source: "ownerAccount", label: "工作负责人账号", kind: "隐藏属性" }] : []),
    ]),
  ], [fieldsQuery.data]);

  const createTemplate = useMutation({
    mutationFn: () => api<ExportTemplate>("/export-templates", { method: "POST", ...jsonBody({ name: "新建导出模板", sheetName: "工作计划", columns: standardTemplateColumns }) }),
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setSelectedId(template.id);
      setDraft(template);
      showSuccess("模板已创建");
    },
  });
  const saveTemplate = useMutation({
    mutationFn: (template: ExportTemplate) => api<ExportTemplate>(`/export-templates/${template.id}`, {
      method: "PATCH",
      ...jsonBody({ name: template.name, sheetName: template.sheetName, columns: template.columns, version: template.version }),
    }),
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setDraft(template);
      showSuccess("模板已保存");
    },
  });

  function toggleColumn(source: string, label: string) {
    if (!draft) return;
    const exists = draft.columns.some((column) => column.source === source);
    setDraft({ ...draft, columns: exists ? draft.columns.filter((column) => column.source !== source) : [...draft.columns, { source, header: label }] });
  }

  function moveColumn(source: string, direction: -1 | 1) {
    if (!draft) return;
    const index = draft.columns.findIndex((column) => column.source === source);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= draft.columns.length) return;
    const columns = [...draft.columns];
    [columns[index], columns[nextIndex]] = [columns[nextIndex]!, columns[index]!];
    setDraft({ ...draft, columns });
  }

  const orderedColumns = draft ? [
    ...draft.columns.flatMap((column) => {
      const available = availableColumns.find((item) => item.source === column.source);
      return available ? [available] : [];
    }),
    ...availableColumns.filter((available) => !draft.columns.some((column) => column.source === available.source)),
  ] : availableColumns;
  const importReady = draft ? ["title", "startAt", "endAt"].every((source) => draft.columns.some((column) => column.source === source)) : false;

  return (
    <section className="settings-section export-template-section">
      <header><div><FileSpreadsheet /><span><strong>Excel 导入导出模板</strong><small>自定义 XLS 的列、标题和顺序；导入与导出共用列映射。</small></span></div><button className="secondary-button" type="button" onClick={() => createTemplate.mutate()}><Plus />新建模板</button></header>
      {draft ? (
        <div className="export-template-editor">
          <div className="export-template-basics">
            <label>选择模板<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            <label>模板名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>工作表名称<input value={draft.sheetName} maxLength={31} onChange={(event) => setDraft({ ...draft, sheetName: event.target.value })} /></label>
          </div>
          <div className="export-column-list">
            <div className="export-column-head"><span>导出</span><span>属性</span><span>导出列标题</span><span>顺序</span></div>
            {orderedColumns.map((available) => {
              const column = draft.columns.find((item) => item.source === available.source);
              const index = column ? draft.columns.indexOf(column) : -1;
              return (
                <div className="export-column-row" key={available.source}>
                  <input type="checkbox" aria-label={`导出 ${available.label}`} checked={Boolean(column)} onChange={() => toggleColumn(available.source, available.label)} />
                  <span><strong>{available.label}</strong><small>{available.kind}</small></span>
                  <input aria-label={`${available.label}导出列标题`} disabled={!column} value={column?.header ?? available.label} onChange={(event) => setDraft({ ...draft, columns: draft.columns.map((item) => item.source === available.source ? { ...item, header: event.target.value } : item) })} />
                  <span className="export-column-actions"><button type="button" aria-label={`上移导出列 ${available.label}`} disabled={!column || index <= 0} onClick={() => moveColumn(available.source, -1)}><ArrowUp /></button><button type="button" aria-label={`下移导出列 ${available.label}`} disabled={!column || index === draft.columns.length - 1} onClick={() => moveColumn(available.source, 1)}><ArrowDown /></button></span>
                </div>
              );
            })}
          </div>
          <footer><span className={importReady ? "template-ready" : "template-warning"}>{importReady ? "可用于 XLS 导入" : "用于导入时必须包含工作内容、开始时间和结束时间"}</span><button className="primary-button" type="button" disabled={!draft.name.trim() || !draft.sheetName.trim() || draft.columns.length === 0 || saveTemplate.isPending} onClick={() => saveTemplate.mutate(draft)}><Save />保存模板</button></footer>
          {saveTemplate.error ? <div className="form-error">{saveTemplate.error.message}</div> : null}
        </div>
      ) : <div className="empty-state"><p>正在载入导出模板…</p></div>}
    </section>
  );
}
