# Spec: Gantt Bar Hover Tooltip Customization（甘特条浮动提示自定义）

> Status: **已实现** — 票据 01-03 已 resolve；04（浮动提示属性值加属性名前缀，`Status: resolved`）为完成后追加的显示增强。
>
> 票据索引：01 Web 工具提示格式化 | 02 属性选择与持久化 | 03 测试与回归 | 04 浮动提示属性名前缀。依赖：01 → 02 → 03；04 独立（依赖 03 的回归基线）。

## Goal

Let the user choose which Work Plan properties appear in the Gantt bar hover tooltip (浮动提示), and render that tooltip with the app's Chinese formatting instead of Frappe Gantt's default English text. The feature mirrors the existing bar-label property picker (甘特条属性) but targets the tooltip independently.

## Terms

See `CONTEXT.md`: **Work Plan**, **Custom Field**, **Manual Status Override**, **Automatic Status**. UI terms follow `README.md`/`docs/design/DESIGN.md`: 甘特图, 甘特条属性.

## Background facts

- `apps/web/src/components/GanttTimeline.tsx:127` creates Frappe Gantt with `popup_on: "hover"`. The tooltip is the library's default `popup` (`frappe-gantt/src/defaults.js:128-148`): it shows the task `name`, `description`, and details rendered with English month abbreviations (`MMM D`), "N day(s)", and "Progress: X%". This English copy is inconsistent with the app's zh UI and is not user-configurable today.
- Frappe Gantt's `popup` option is a callback that can return HTML; when it returns a string, `Popup.show` replaces `.popup-wrapper` innerHTML with it (`frappe-gantt/src/popup.js:25-51`). So tooltip content is fully replaceable without patching the library.
- The app already customizes tooltip positioning: `configurePopupFollow` (`GanttTimeline.tsx:207-239`) moves `.popup-wrapper` with the pointer via the `.bar-wrapper[data-id]` mouse events and a MutationObserver on the popup class. Content customization must keep this positioning intact (no DOM swap of the `.popup-wrapper` element itself).
- Gantt bar labels already support a user-selectable property list: `displayProperties: GanttDisplayProperty[]` (`"status" | custom:` field keys) flows from `WorkPlansPage.tsx:183-196` into `formatGanttLabel(`GanttTimeline.tsx:323-331`), which joins selected values with `" · "` and omits `"—"` placeholder values. Selection is edited in the `GanttPropertySettings` popover opened from the toolbar 甘特条属性 button (`WorkPlansPage.tsx:691`, `:770`) and persisted per-browser.
- Per-browser preferences follow a versioned localStorage pattern (`workplan:theme:v1`, `workplan:sidebar:v1`, `workplan:gantt:v1` for visible bar properties) with defensive parsing (`WorkPlansPage.tsx:61-72`). The tooltip preference should follow the same shape.
- The workbench (and hence the Gantt toolbar) is available to Editors and Administrators; there is no server-side per-account UI preference concept today.
- Popup `.details` currently receives ISO-free date text; the app has local-day helpers (`startOfLocalDay`, `endOfLocalDay`, `toLocalDateString`, `formatGanttLabel`, `formatCustomFieldValue`) that the tooltip formatter should reuse.

## Requirements（已定稿）

### R1 Tooltip property selection
- The hover tooltip shows the Work Plan's title plus a separate, independently selected set of properties: `status` and `custom:<key>` Custom Field values, reusing `GanttDisplayProperty`/status label mapping and `formatCustomFieldValue` semantics (placeholder `"—"` values omitted). Each selected property renders as `<属性名>：<值>` (e.g. `状态：待开始`、`是否需要开票：是`), with both label and value HTML-escaped.
- Default selection: **empty**（仅标题 + 中文日期范围），实现时以空选中为准；选择必须独立于甘特条属性的 `displayProperties`，两者互不影响。

### R2 Chinese formatting
- Date range rendered in Chinese, e.g. `M月D日 - M月D日` (cross-month/year includes year), duration as `持续 N 天`, progress only when meaningful (in-progress/completed).
- No English month names, "days", or "Progress:" in any locale output.

### R3 Persistence
- A new versioned localStorage key, e.g. `workplan:gantt-tooltip:v1`: `{ version: 1, visibleIds: GanttDisplayId[] }`, loaded/saved with the same defensive parsing as existing preferences; storage failure degrades to defaults without breaking the Gantt.

### R4 UI
- Reuse the existing 甘特条属性 popover or add a sibling 浮动提示 section on the toolbar (both roles reachable). Keep it a per-browser preference, consistent with existing Gantt display settings.

### R5 Testing (TDD)
- RTL/component tests on the popup content function: selected property values render, `"—"` values are omitted, default selection, Chinese date/duration/progress copy.
- Regression: tooltip still follows the pointer (`configurePopupFollow`) and row hover highlight keeps working; existing `GanttTimeline.test.tsx` / `GanttTimeline.render.test.tsx` hover-popup cases stay green.

## 验收标准（Acceptance criteria）

1. 甘特条 hover 提示默认仅显示标题 + 中文日期范围（如 8月1日 - 8月3日）；选择"状态"后追加 `状态：进行中` 等带属性名前缀的文案，选择自定义字段后按 `formatCustomFieldValue` 语义渲染并同样带属性名前缀（如 `是否需要开票：是`）。
2. 提示文案全程中文：日期 `M月D日`（跨年含年份）、持续时间 `持续 N 天`、进度仅在进行中/已完成时显示；任何语言环境都不出现英文月份、“day(s)”、“Progress:”。
3. 属性选择与持久化与甘特条属性完全独立；localStorage 键 `workplan:gantt-tooltip:v1`，读写采用与既有偏好一致的防御式解析；存储失败退回默认值且不影响甘特图。
4. 提示跟随鼠标（`configurePopupFollow`）与行 hover 高亮保持正常（不替换 .popup-wrapper 元素本身）。
5. 新增 popup 内容单测覆盖：选中属性渲染、"—"省略、默认选中、中文日期/持续/进度文案；既有 `GanttTimeline.test.tsx` / `GanttTimeline.render.test.tsx` hover 用例保持 green。
6. `pnpm typecheck` 与 `pnpm test`（web 部分）全绿。

## Out of scope
- Changing `popup_on` mode (stays hover-only), replacing click behavior, bar-label content (existing 甘特条属性 feature), server-side or per-account tooltip settings, tooltip actions/buttons inside the popup.
