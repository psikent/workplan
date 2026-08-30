import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomFieldDefinition, ExportTemplate, ExportTemplateColumn } from "@workplan/contracts";
import { ArrowDown, ArrowUp, FileSpreadsheet, Plus, Save } from "lucide-react";
import { useToast } from "../../components/ToastProvider";
import { api, jsonBody } from "../../lib/api";

const standardTemplateColumns: ExportTemplateColumn[] = [
  { source: "title", header: "工作内容" },
  { source: "status", header: "状态" },
  { source: "startAt", header: "开始时间" },
  { source: "endAt", header: "结束时间" },
];

export default function ExportTemplateSettings() {
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
