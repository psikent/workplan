# Spec: Gantt Bar Hover Tooltip Customization（甘特条浮动提示自定义）

> Status: **待开发** (backlog — planned, not yet scheduled for implementation).

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

## Requirements (draft — to be confirmed during implementation)

### R1 Tooltip property selection
- The hover tooltip shows the Work Plan's title plus a separate, independently selected set of properties: `status` and `custom:<key>` Custom Field values, reusing `GanttDisplayProperty`/status label mapping and `formatCustomFieldValue` semantics (placeholder `"—"` values omitted).
- Default selection: empty (title + Chinese date range only) or a sensible baseline (e.g. status), decided in implementation; the selection must be independent of the bar-label `displayProperties`.

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

## Out of scope
- Changing `popup_on` mode (stays hover-only), replacing click behavior, bar-label content (existing 甘特条属性 feature), server-side or per-account tooltip settings, tooltip actions/buttons inside the popup.
