import { useState, type CSSProperties, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CustomFieldDefinition, CustomFieldType } from "@workplan/contracts";
import { customFieldOptionColorPalette } from "@workplan/contracts";
import { Archive, ArrowDown, ArrowUp, GripVertical, Pencil, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useToast } from "../../components/ToastProvider";
import { api, jsonBody } from "../../lib/api";

const typeLabels: Record<CustomFieldType, string> = {
  short_text: "短文本",
  long_text: "长文本",
  number: "数字",
  boolean: "布尔值",
  date: "日期",
  datetime: "日期时间",
  single_select: "单选",
  multi_select: "多选",
  url: "URL",
};

type OptionDraft = {
  id?: string;
  value: string;
  label: string;
  color?: string | null | undefined;
  archived: boolean;
  version?: number;
};

type FieldDraft = {
  key: string;
  label: string;
  description: string;
  type: CustomFieldType;
  required: boolean;
  collapsed: boolean;
  defaultValue: string;
  options: OptionDraft[];
};

const fieldsQueryKey = ["custom-fields", "all"] as const;

function emptyDraft(): FieldDraft {
  return { key: "", label: "", description: "", type: "short_text", required: false, collapsed: false, defaultValue: "", options: [] };
}

export default function CustomFieldsSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null | "new">(null);
  const [draft, setDraft] = useState<FieldDraft>(emptyDraft);
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const fields = useQuery({ queryKey: fieldsQueryKey, queryFn: () => api<CustomFieldDefinition[]>("/custom-fields?includeArchived=true") });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api("/custom-fields", { method: "POST", ...jsonBody(body) }),
    onSuccess: async () => {
      await refreshFields();
      showSuccess("字段已创建");
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ field, nextDraft }: { field: CustomFieldDefinition; nextDraft: FieldDraft }) => {
      if (["single_select", "multi_select"].includes(field.type)) {
        const submittedIds = await syncOptions(field, nextDraft.options);
        await syncOptionOrder(field, submittedIds);
      }
      return api(`/custom-fields/${field.id}`, {
        method: "PATCH",
        ...jsonBody({
          label: nextDraft.label,
          description: nextDraft.description,
          required: nextDraft.required,
          collapsed: nextDraft.collapsed,
          defaultValue: parseDefault(nextDraft.type, nextDraft.defaultValue, activeOptions(nextDraft.options)),
          version: field.version,
        }),
      });
    },
    onSuccess: async () => {
      await refreshFields();
      showSuccess("字段已保存");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ field, archived }: { field: CustomFieldDefinition; archived: boolean }) =>
      api(`/custom-fields/${field.id}`, { method: "PATCH", ...jsonBody({ archived, version: field.version }) }),
    onSuccess: async (_field, { archived }) => {
      await refreshFields();
      showSuccess(archived ? "字段已归档" : "字段已恢复");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => api("/custom-fields/reorder", { method: "POST", ...jsonBody({ orderedIds }) }),
    onSuccess: () => showSuccess("字段顺序已保存"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["custom-fields"] }),
  });

  async function refreshFields() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["custom-fields"] }),
      queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
    ]);
    closeForm();
  }

  function openCreate() {
    setDraft(emptyDraft());
    setEditingField("new");
    setError("");
  }

  function openEdit(field: CustomFieldDefinition) {
    setDraft({
      key: field.key,
      label: field.label,
      description: field.description,
      type: field.type,
      required: field.required,
      collapsed: field.collapsed,
      defaultValue: formatDefaultForInput(field),
      options: field.options.map((option) => ({
        id: option.id,
        value: option.value,
        label: option.label,
        color: option.color,
        archived: Boolean(option.archivedAt),
        version: option.version,
      })),
    });
    setEditingField(field);
    setError("");
  }

  function closeForm() {
    setEditingField(null);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (editingField === "new") {
        const options = activeOptions(draft.options);
        await createMutation.mutateAsync({
          key: draft.key,
          label: draft.label,
          description: draft.description,
          type: draft.type,
          required: draft.required,
          collapsed: draft.collapsed,
          defaultValue: parseDefault(draft.type, draft.defaultValue, options),
          options,
        });
      } else if (editingField) {
        await editMutation.mutateAsync({ field: editingField, nextDraft: draft });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存字段失败");
    }
  }

  // 选项同步：返回与草稿行对齐的选项 id 序列（新建选项取创建响应的 id，跳过的草稿行不计入）。
  // 颜色口径：选项更新路径仅备注字段随 payload 携带 color（D8：其余字段无配色控件，不传即不丢本地已有色）；
  // 创建路径的 color 列对所有单选字段通用，activeOptions 对非备注草稿恒提交 null，与空值等效。
  async function syncOptions(field: CustomFieldDefinition, nextOptions: OptionDraft[]): Promise<string[]> {
    const colorEditable = field.key === "remarks" && field.type === "single_select";
    const currentById = new Map(field.options.map((option) => [option.id, option]));
    const submissions = nextOptions.map(async (option): Promise<string | null> => {
      if (!option.id) {
        if (option.archived || !option.label.trim()) return null;
        const created = await api<{ id: string }>(`/custom-fields/${field.id}/options`, {
          method: "POST",
          ...jsonBody({ value: option.value, label: option.label, ...(colorEditable ? { color: option.color ?? null } : {}) }),
        });
        return created.id;
      }
      const current = currentById.get(option.id);
      const colorChanged = colorEditable && (current?.color ?? null) !== (option.color ?? null);
      if (current && (current.label !== option.label || Boolean(current.archivedAt) !== option.archived || colorChanged)) {
        await api(`/custom-field-options/${option.id}`, {
          method: "PATCH",
          ...jsonBody({
            label: option.label,
            archived: option.archived,
            ...(colorEditable ? { color: option.color ?? null } : {}),
            version: option.version,
          }),
        });
      }
      return option.id;
    });
    const ids = await Promise.all(submissions);
    return ids.filter((id): id is string => Boolean(id));
  }

  // 顺序随「保存字段」提交：草稿顺序与弹窗打开时一致则直接跳过（并发新增的选项本就追加末尾，
  // 无需重排也不必校验，避免误伤并发保存）；确有移动时与保存后的实际选项序列比较，有变化才调一次重排（含归档行，ADR-0009）。
  async function syncOptionOrder(field: CustomFieldDefinition, submittedIds: string[]) {
    const originalIds = field.options.map((option) => option.id);
    if (originalIds.length === submittedIds.length && originalIds.every((id, index) => id === submittedIds[index])) return;
    if (submittedIds.length === 0) return;
    const fresh = (await api<CustomFieldDefinition[]>("/custom-fields?includeArchived=true")).find((item) => item.id === field.id);
    if (!fresh) return;
    const currentIds = fresh.options.map((option) => option.id);
    if (currentIds.length === submittedIds.length && currentIds.every((id, index) => id === submittedIds[index])) return;
    await api(`/custom-fields/${field.id}/options/reorder`, { method: "POST", ...jsonBody({ orderedIds: submittedIds }) });
  }

  function commitOrder(next: CustomFieldDefinition[]) {
    const ordered = next.map((field, sortOrder) => ({ ...field, sortOrder }));
    queryClient.setQueryData(fieldsQueryKey, ordered);
    reorderMutation.mutate(ordered.map((field) => field.id));
  }

  function moveField(id: string, direction: -1 | 1) {
    const current = fields.data ?? [];
    const index = current.findIndex((field) => field.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    commitOrder(arrayMove(current, index, nextIndex));
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const current = fields.data ?? [];
    const oldIndex = current.findIndex((field) => field.id === event.active.id);
    const newIndex = current.findIndex((field) => field.id === event.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    commitOrder(arrayMove(current, oldIndex, newIndex));
  }

  const saving = createMutation.isPending || editMutation.isPending;

  return (
    <>
      <div className="settings-panel">
        <div className="settings-panel-header">
          <div><SlidersHorizontal /><strong>字段定义</strong></div>
          <span className="settings-panel-header-actions"><span>{reorderMutation.isPending ? "正在保存顺序…" : `${fields.data?.length ?? 0} 个字段`}</span><button className="primary-button" type="button" onClick={openCreate}><Plus />新建字段</button></span>
        </div>
        <div className="fields-table table-head"><span /><span>字段名称</span><span>稳定键</span><span>字段类型</span><span>必填</span><span>折叠</span><span>默认值</span><span /></div>
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={(fields.data ?? []).map((field) => field.id)} strategy={verticalListSortingStrategy}>
            {fields.data?.map((field, index) => (
              <SortableFieldRow
                key={field.id}
                field={field}
                index={index}
                count={fields.data?.length ?? 0}
                onEdit={openEdit}
                onMove={moveField}
                onArchive={(target) => archiveMutation.mutate({ field: target, archived: !target.archivedAt })}
              />
            ))}
          </SortableContext>
        </DndContext>
        {!fields.isLoading && fields.data?.length === 0 ? <div className="empty-state"><SlidersHorizontal /><h3>还没有自定义字段</h3><p>创建字段后，它会自动出现在所有工作计划的编辑表单中。</p></div> : null}
      </div>

      {editingField ? (
        <div className="modal-layer">
          <button className="modal-backdrop" type="button" onClick={closeForm} aria-label="关闭" />
          <form className="field-dialog" onSubmit={submit}>
            <header><div><h2>{editingField === "new" ? "新建自定义字段" : "编辑自定义字段"}</h2><p>稳定键和字段类型创建后不可修改。</p></div><button className="icon-button" type="button" onClick={closeForm} aria-label="关闭"><X /></button></header>
            <div className="field-grid">
              <label className="field"><span>字段名称 <b>*</b></span><input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value, key: editingField === "new" && !current.key ? slugify(event.target.value) : current.key }))} required /></label>
              <label className="field"><span>稳定键 <b>*</b></span><input value={draft.key} disabled={editingField !== "new"} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value.toLocaleLowerCase().replace(/[^a-z0-9_]/g, "") }))} pattern="[a-z][a-z0-9_]{1,63}" required placeholder="owner_role" /></label>
              <label className="field"><span>字段类型 <b>*</b></span><select value={draft.type} disabled={editingField !== "new"} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as CustomFieldType, defaultValue: "", options: [] }))}>{Object.entries(typeLabels).map(([value, typeLabel]) => <option key={value} value={value}>{typeLabel}</option>)}</select></label>
              <label className="field toggle-field"><span>必填</span><button className={`switch ${draft.required ? "on" : ""}`} type="button" aria-pressed={draft.required} onClick={() => setDraft((current) => ({ ...current, required: !current.required }))}><i /></button></label>
              <div className="field toggle-field"><span>折叠</span><button className={`switch ${draft.collapsed ? "on" : ""}`} type="button" aria-pressed={draft.collapsed} aria-label="折叠" onClick={() => setDraft((current) => ({ ...current, collapsed: !current.collapsed }))}><i /></button></div>
              <div className="field full field-hint"><small>折叠：字段收入计划抽屉底部「更多信息」折叠区，展开后仍可查看和编辑。</small></div>
              <label className="field full"><span>字段说明</span><textarea rows={2} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={500} /></label>
              {["single_select", "multi_select"].includes(draft.type) ? <OptionEditor options={draft.options} showColor={draft.key === "remarks" && draft.type === "single_select"} onChange={(options) => setDraft((current) => ({ ...current, options }))} /> : null}
              <label className="field full"><span>默认值{draft.required ? " *" : ""}</span><input value={draft.defaultValue} onChange={(event) => setDraft((current) => ({ ...current, defaultValue: event.target.value }))} required={draft.required} placeholder={draft.type === "boolean" ? "true 或 false" : ["single_select", "multi_select"].includes(draft.type) ? "填写选项名称，多选用逗号分隔" : "可选"} /></label>
            </div>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <footer><button className="secondary-button" type="button" onClick={closeForm}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "保存字段"}</button></footer>
          </form>
        </div>
      ) : null}
    </>
  );
}

function SortableFieldRow({ field, index, count, onEdit, onMove, onArchive }: {
  field: CustomFieldDefinition;
  index: number;
  count: number;
  onEdit: (field: CustomFieldDefinition) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onArchive: (field: CustomFieldDefinition) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition } as CSSProperties;
  return (
    <div ref={setNodeRef} style={style} className={`fields-table ${field.archivedAt ? "archived" : ""} ${isDragging ? "dragging" : ""}`}>
      <button className="field-sort-handle" type="button" aria-label={`拖动排序 ${field.label}`} {...attributes} {...listeners}><GripVertical /></button>
      <div><strong>{field.label}</strong>{field.archivedAt ? <small>已归档</small> : null}</div>
      <code>{field.key}</code>
      <span>{typeLabels[field.type]}</span>
      <span>{field.required ? "是" : "否"}</span>
      <span>{field.collapsed ? "是" : "否"}</span>
      <span className="truncate">{field.defaultValue == null ? "—" : String(field.defaultValue)}</span>
      <div className="field-row-actions">
        <button className="icon-button" type="button" aria-label={`上移 ${field.label}`} disabled={index === 0} onClick={() => onMove(field.id, -1)}><ArrowUp /></button>
        <button className="icon-button" type="button" aria-label={`下移 ${field.label}`} disabled={index === count - 1} onClick={() => onMove(field.id, 1)}><ArrowDown /></button>
        <button className="icon-button" type="button" aria-label={`编辑 ${field.label}`} onClick={() => onEdit(field)}><Pencil /></button>
        <button className="icon-button" type="button" aria-label={field.archivedAt ? `恢复 ${field.label}` : `归档 ${field.label}`} onClick={() => onArchive(field)}>{field.archivedAt ? <RotateCcw /> : <Archive />}</button>
      </div>
    </div>
  );
}

function OptionEditor({ options, showColor, onChange }: { options: OptionDraft[]; showColor: boolean; onChange: (options: OptionDraft[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const optionKey = (option: OptionDraft) => option.id ?? option.value;
  function update(index: number, changes: Partial<OptionDraft>) {
    onChange(options.map((option, optionIndex) => optionIndex === index ? { ...option, ...changes } : option));
  }
  function addOption() {
    const suffix = `${Date.now().toString(36)}_${options.length + 1}`;
    onChange([...options, { value: `option_${suffix}`, label: "", archived: false }]);
  }
  function moveOption(key: string, direction: -1 | 1) {
    const index = options.findIndex((option) => optionKey(option) === key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= options.length) return;
    onChange(arrayMove(options, index, nextIndex));
  }
  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = options.findIndex((option) => optionKey(option) === event.active.id);
    const newIndex = options.findIndex((option) => optionKey(option) === event.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(options, oldIndex, newIndex));
  }
  return (
    <div className="field full option-editor">
      <div className="option-editor-header"><span>选项 <b>*</b></span><button className="text-button" type="button" onClick={addOption}><Plus />添加选项</button></div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={options.map(optionKey)} strategy={verticalListSortingStrategy}>
          <div className="option-editor-list">
            {options.map((option, index) => (
              <SortableOptionRow
                key={optionKey(option)}
                option={option}
                index={index}
                count={options.length}
                showColor={showColor}
                onUpdate={(changes) => update(index, changes)}
                onMove={moveOption}
                onUnsavedRemove={() => onChange(options.filter((_, optionIndex) => optionIndex !== index))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {activeOptions(options).length === 0 ? <small>单选和多选字段至少需要一个选项。</small> : null}
    </div>
  );
}

// 选项行：拖拽手柄 + 上移/下移（归档行同样可排，其顺序位决定历史值的单选排序位置）；改动仅落在草稿。
// 备注单选字段额外渲染色板行（8 色点选 + 「无色」清除），其余字段不出现配色控件（D8）。
function SortableOptionRow({ option, index, count, showColor, onUpdate, onMove, onUnsavedRemove }: {
  option: OptionDraft;
  index: number;
  count: number;
  showColor: boolean;
  onUpdate: (changes: Partial<OptionDraft>) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onUnsavedRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id ?? option.value });
  const style = { transform: CSS.Transform.toString(transform), transition } as CSSProperties;
  const key = option.id ?? option.value;
  const rowLabel = option.label || `选项 ${index + 1}`;
  const currentColor = option.color ?? null;
  return (
    <div ref={setNodeRef} style={style} className={`option-row ${showColor ? "with-color" : ""} ${option.archived ? "archived" : ""} ${isDragging ? "dragging" : ""}`}>
      <button className="field-sort-handle" type="button" aria-label={`拖动排序选项 ${rowLabel}`} {...attributes} {...listeners}><GripVertical /></button>
      <input value={option.label} disabled={option.archived} required={!option.archived} onChange={(event) => onUpdate({ label: event.target.value })} placeholder={`选项 ${index + 1}`} />
      <div className="option-row-actions">
        <button className="icon-button" type="button" aria-label={`上移选项 ${rowLabel}`} disabled={index === 0} onClick={() => onMove(key, -1)}><ArrowUp /></button>
        <button className="icon-button" type="button" aria-label={`下移选项 ${rowLabel}`} disabled={index === count - 1} onClick={() => onMove(key, 1)}><ArrowDown /></button>
        <button className="icon-button" type="button" aria-label={option.archived ? `恢复选项 ${rowLabel}` : `移除选项 ${rowLabel}`} onClick={() => option.id ? onUpdate({ archived: !option.archived }) : onUnsavedRemove()}>{option.archived ? <RotateCcw /> : <Archive />}</button>
      </div>
      {showColor ? (
        <div className="option-color-picker" role="group" aria-label={`选项颜色 ${rowLabel}`}>
          {customFieldOptionColorPalette.map((color) => (
            <button
              key={color}
              type="button"
              className={`color-swatch ${currentColor === color ? "selected" : ""}`}
              style={{ backgroundColor: color }}
              aria-label={`选项颜色 ${color}`}
              aria-pressed={currentColor === color}
              disabled={option.archived}
              onClick={() => onUpdate({ color })}
            />
          ))}
          <button
            type="button"
            className={`color-swatch color-swatch-none ${currentColor === null ? "selected" : ""}`}
            aria-label="清除选项颜色"
            aria-pressed={currentColor === null}
            disabled={option.archived}
            onClick={() => onUpdate({ color: null })}
          />
        </div>
      ) : null}
    </div>
  );
}

function activeOptions(options: OptionDraft[]) {
  return options.filter((option) => !option.archived && option.label.trim()).map((option) => ({ value: option.value, label: option.label.trim(), color: option.color ?? null }));
}

function slugify(value: string) {
  const ascii = value.trim().toLocaleLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return /^[a-z]/.test(ascii) ? ascii.slice(0, 64) : `field_${Date.now().toString(36)}`;
}

function formatDefaultForInput(field: CustomFieldDefinition) {
  if (field.defaultValue == null) return "";
  if (field.type === "single_select") return field.options.find((option) => option.value === field.defaultValue)?.label ?? String(field.defaultValue);
  if (field.type === "multi_select" && Array.isArray(field.defaultValue)) {
    return field.defaultValue.map((value) => field.options.find((option) => option.value === value)?.label ?? String(value)).join("，");
  }
  return String(field.defaultValue);
}

function parseDefault(type: CustomFieldType, value: string, options: Array<{ value: string; label: string }>): unknown | null {
  if (!value) return null;
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  if (type === "multi_select") return value.split(/[，,]/).map((item) => options.find((option) => option.label === item.trim())?.value).filter((item): item is string => Boolean(item));
  if (type === "single_select") return options.find((option) => option.label === value.trim())?.value ?? value;
  if (type === "datetime") return new Date(value).toISOString();
  return value;
}
