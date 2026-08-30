import { useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  EnvConfigImportOutcome,
  EnvConfigImportResult,
  EnvConfigImportMode,
  EnvConfigOptionPlanItem,
  EnvConfigPackage,
  EnvConfigPlan,
  EnvConfigSection,
} from "@workplan/contracts";
import { ClipboardCopy, Download, Settings2, Upload } from "lucide-react";
import { useToast } from "../../components/ToastProvider";
import { api, downloadEnvConfig, jsonBody } from "../../lib/api";

export default function EnvironmentConfigSettings() {
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
