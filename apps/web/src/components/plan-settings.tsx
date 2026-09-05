// 工作计划页的三个设置弹层（排序 / 列 / 甘特属性）：从 WorkPlansPage 拆出（纯移动，无逻辑变更）。
import { arrayMove } from "@dnd-kit/sortable";
import type { CustomFieldDefinition, WorkPlanSortItem } from "@workplan/contracts";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import type { GanttDisplayId, GanttDisplayProperty } from "./GanttTimeline";
import { sortableBuiltInLabels, sortableCustomFieldTypes, type ColumnId } from "../lib/plan-preferences";

export type PlanColumn = {
  id: ColumnId;
  label: string;
  width: number;
  field?: CustomFieldDefinition;
};

export function SortSettings({ items, fields, appliedItems, queryFailed, onChange, onClose }: {
  items: WorkPlanSortItem[];
  fields: CustomFieldDefinition[];
  appliedItems: WorkPlanSortItem[];
  queryFailed: boolean;
  onChange: (items: WorkPlanSortItem[]) => void;
  onClose: () => void;
}) {
  const labelOf = (field: string) => {
    if (field.startsWith("custom.")) {
      const definition = fields.find((candidate) => candidate.key === field.slice("custom.".length));
      return definition ? `${definition.label}（自定义）` : field;
    }
    return sortableBuiltInLabels[field] ?? field;
  };
  const availableFieldKeys = [
    ...Object.keys(sortableBuiltInLabels),
    ...fields
      .filter((field) => !field.archivedAt && sortableCustomFieldTypes.has(field.type))
      .map((field) => `custom.${field.key}`),
  ];
  const addable = availableFieldKeys.filter((key) => !items.some((item) => item.field === key));
  const sameSort = (left: WorkPlanSortItem[], right: WorkPlanSortItem[]) =>
    left.length === right.length && left.every((item, index) => item.field === right[index]?.field && item.direction === right[index]?.direction);
  const defaultActive = items.length === 0;

  return (
    <div className="advanced-filter-panel sort-panel" role="dialog" aria-label="排序设置">
      <header className="sort-panel-head">
        <div>
          <strong>排序</strong>
          <small>{defaultActive ? "当前：排期顺序（默认）" : `当前按 ${items.map((item) => labelOf(item.field)).join(" → ")} 排序`}</small>
        </div>
        <span className="sort-panel-actions">
          {defaultActive ? null : <button className="text-button" type="button" onClick={() => onChange([])}><RotateCcw />恢复默认</button>}
          <button className="text-button" type="button" onClick={onClose}>关闭</button>
        </span>
      </header>
      {queryFailed && !sameSort(items, appliedItems) ? <div className="form-error" role="status">最近一次排序未应用成功，表格仍按之前的顺序显示。</div> : null}
      {items.length === 0 ? <p className="sort-panel-hint">未添加排序项时，表格与甘特图按默认排期顺序显示。</p> : null}
      <ol className="sort-item-list">
        {items.map((item, index) => (
          <li className="sort-item-row" key={item.field}>
            <span className="sort-item-rank" aria-hidden>{index + 1}</span>
            <span className="sort-item-label">{labelOf(item.field)}</span>
            <button
              type="button"
              aria-label={`${labelOf(item.field)} 方向 ${item.direction === "asc" ? "升序，点击改为降序" : "降序，点击改为升序"}`}
              onClick={() => onChange(items.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, direction: candidate.direction === "asc" ? "desc" as const : "asc" as const } : candidate)))}
            >
              {item.direction === "asc" ? <ArrowUp /> : <ArrowDown />}{item.direction === "asc" ? "升序" : "降序"}
            </button>
            <span className="column-order-actions">
              <button type="button" aria-label={`上移 ${labelOf(item.field)}`} disabled={index <= 0} onClick={() => onChange(arrayMove(items, index, index - 1))}><ArrowUp /></button>
              <button type="button" aria-label={`下移 ${labelOf(item.field)}`} disabled={index < 0 || index === items.length - 1} onClick={() => onChange(arrayMove(items, index, index + 1))}><ArrowDown /></button>
              <button type="button" aria-label={`移除 ${labelOf(item.field)}`} onClick={() => onChange(items.filter((_, candidateIndex) => candidateIndex !== index))}>移除</button>
            </span>
          </li>
        ))}
      </ol>
      <div className="sort-add-row">
        <select
          aria-label="添加排序字段"
          value=""
          disabled={items.length >= 5 || addable.length === 0}
          onChange={(event) => {
            if (!event.target.value) return;
            onChange([...items, { field: event.target.value, direction: "asc" }]);
            event.target.value = "";
          }}
        >
          <option value="">{items.length >= 5 ? "最多五项排序" : "添加排序字段"}</option>
          {addable.map((key) => <option key={key} value={key}>{labelOf(key)}</option>)}
        </select>
        <small>最多五项，从上到下是优先级；并列时按默认排期顺序兜底。</small>
      </div>
    </div>
  );
}

export function ColumnSettings({ columns, visibleIds, onToggle, onMove, onReset }: {
  columns: PlanColumn[];
  visibleIds: ColumnId[];
  onToggle: (id: ColumnId) => void;
  onMove: (id: ColumnId, direction: -1 | 1) => void;
  onReset: () => void;
}) {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const orderedColumns = [
    ...visibleIds.flatMap((id) => {
      const column = columnsById.get(id);
      return column ? [column] : [];
    }),
    ...columns.filter((column) => !visibleIds.includes(column.id)),
  ];
  return (
    <div className="column-settings-popover" role="dialog" aria-label="列设置">
      <header><div><strong>列设置</strong><small>选择显示内容并调整顺序</small></div><button className="text-button" type="button" onClick={onReset}><RotateCcw />恢复默认</button></header>
      <div className="column-settings-list">
        <label className="column-setting-row fixed"><input type="checkbox" checked disabled /><span>工作内容</span><small>固定</small></label>
        {orderedColumns.map((column) => {
          const checked = visibleIds.includes(column.id);
          const visibleIndex = visibleIds.indexOf(column.id);
          return (
            <div className="column-setting-row" key={column.id}>
              <label><input type="checkbox" checked={checked} onChange={() => onToggle(column.id)} /><span>{column.label}</span></label>
              {column.field ? <small>自定义字段</small> : null}
              <div className="column-order-actions">
                <button type="button" aria-label={`上移 ${column.label}`} disabled={!checked || visibleIndex <= 0} onClick={() => onMove(column.id, -1)}><ArrowUp /></button>
                <button type="button" aria-label={`下移 ${column.label}`} disabled={!checked || visibleIndex < 0 || visibleIndex === visibleIds.length - 1} onClick={() => onMove(column.id, 1)}><ArrowDown /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GanttPropertySettings({ properties, tooltipProperties, visibleIds, onToggle, onMove, onReset, tooltipVisibleIds, onToggleTooltip, onMoveTooltip, onResetTooltip }: {
  properties: GanttDisplayProperty[];
  tooltipProperties: GanttDisplayProperty[];
  visibleIds: GanttDisplayId[];
  onToggle: (id: GanttDisplayId) => void;
  onMove: (id: GanttDisplayId, direction: -1 | 1) => void;
  onReset: () => void;
  tooltipVisibleIds: GanttDisplayId[];
  onToggleTooltip: (id: GanttDisplayId) => void;
  onMoveTooltip: (id: GanttDisplayId, direction: -1 | 1) => void;
  onResetTooltip: () => void;
}) {
  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const tooltipPropertiesById = new Map(tooltipProperties.map((property) => [property.id, property]));
  const orderedProperties = [
    ...visibleIds.flatMap((id) => {
      const property = propertiesById.get(id);
      return property ? [property] : [];
    }),
    ...properties.filter((property) => !visibleIds.includes(property.id)),
  ];
  const orderedTooltipProperties = [
    ...tooltipVisibleIds.flatMap((id) => {
      const property = tooltipPropertiesById.get(id);
      return property ? [property] : [];
    }),
    ...tooltipProperties.filter((property) => !tooltipVisibleIds.includes(property.id)),
  ];
  return (
    <div className="column-settings-popover gantt-property-popover" role="dialog" aria-label="甘特条属性">
      <header><div><strong>甘特条属性</strong><small>选择并排序甘特条内显示的内容</small></div><button className="text-button" type="button" onClick={onReset}><RotateCcw />清空</button></header>
      <div className="column-settings-list">
        {orderedProperties.map((property) => {
          const checked = visibleIds.includes(property.id);
          const visibleIndex = visibleIds.indexOf(property.id);
          return (
            <div className="column-setting-row" key={property.id}>
              <label><input type="checkbox" checked={checked} onChange={() => onToggle(property.id)} /><span>{property.label}</span></label>
              {property.field ? <small>自定义字段</small> : <small>内置属性</small>}
              <div className="column-order-actions">
                <button type="button" aria-label={`上移甘特属性 ${property.label}`} disabled={!checked || visibleIndex <= 0} onClick={() => onMove(property.id, -1)}><ArrowUp /></button>
                <button type="button" aria-label={`下移甘特属性 ${property.label}`} disabled={!checked || visibleIndex < 0 || visibleIndex === visibleIds.length - 1} onClick={() => onMove(property.id, 1)}><ArrowDown /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="gantt-popover-section">
        <div className="gantt-popover-section-head">
          <div><strong>甘特条浮动提示</strong><small>选择并排序悬停提示内显示的内容</small></div>
          <button className="text-button" type="button" onClick={onResetTooltip}><RotateCcw />清空</button>
        </div>
        <div className="column-settings-list">
          {orderedTooltipProperties.map((property) => {
            const checked = tooltipVisibleIds.includes(property.id);
            const visibleIndex = tooltipVisibleIds.indexOf(property.id);
            return (
              <div className="column-setting-row" key={property.id}>
                <label><input type="checkbox" aria-label={`浮动提示 ${property.label}`} checked={checked} onChange={() => onToggleTooltip(property.id)} /><span>{property.label}</span></label>
                {property.field ? <small>自定义字段</small> : <small>内置属性</small>}
                <div className="column-order-actions">
                  <button type="button" aria-label={`上移浮动提示 ${property.label}`} disabled={!checked || visibleIndex <= 0} onClick={() => onMoveTooltip(property.id, -1)}><ArrowUp /></button>
                  <button type="button" aria-label={`下移浮动提示 ${property.label}`} disabled={!checked || visibleIndex < 0 || visibleIndex === tooltipVisibleIds.length - 1} onClick={() => onMoveTooltip(property.id, 1)}><ArrowDown /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
