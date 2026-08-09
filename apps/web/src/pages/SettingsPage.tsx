import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomFieldDefinition, ExportTemplate, ExportTemplateColumn, OwnerAccountMapping } from "@workplan/contracts";
import { ArrowDown, ArrowUp, BookOpen, DatabaseBackup, Download, FileSpreadsheet, Pencil, Plus, Save, Trash2, Upload, UsersRound, X } from "lucide-react";
import { useToast } from "../components/ToastProvider";
import { api, downloadExport, jsonBody } from "../lib/api";

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

        <OwnerAccountMappingSettings />

        <ExportTemplateSettings />

        <section className="settings-section">
          <header><div><BookOpen /><span><strong>接口文档</strong><small>使用个人访问令牌从外部脚本调用 REST API。</small></span></div><a className="secondary-button" href="/api/docs" target="_blank" rel="noreferrer">打开 OpenAPI</a></header>
        </section>
      </div>
    </section>
  );
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
