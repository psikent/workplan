# UI fidelity ledger

## Compared artifacts

- Concept: `work-plan-primary.png` at 1536 × 1024.
- Browser render: `work-plan-rendered.png` at the desktop QA viewport.
- Editor render: `work-plan-editor-rendered.png`.
- Responsive render: `work-plan-mobile.png` at 390 × 844.

## Visual comparison

1. The 224px navigation rail, white surface, cool-gray work canvas, and indigo active state follow the concept.
2. The toolbar keeps the same compact search, status, priority, filter, reset, today, and week/month controls.
3. The plan list and Frappe Gantt remain one bordered continuous canvas with aligned 58px rows.
4. Status and priority retain the concept's restrained green, amber, red, and slate semantic colors.
5. The current-day marker, plan bars, date header, horizontal scrolling, and direct-manipulation handles use the same scheduling visual language.
6. The editor is a right-side sheet with a dimmed canvas, dense two-column fields, custom fields, and fixed actions.
7. The mobile breakpoint converts navigation to a compact top rail while preserving a horizontally scrollable planning surface.

## Copy comparison

The implementation keeps the concept's primary labels: 工作计划、工作台、自定义字段、设置、新建工作计划、今天、周视图、月视图、筛选、重置. Dates and example plan titles intentionally use the QA date and generated acceptance data rather than the concept's static May 2025 sample.

## Intentional deviations

- The first release omits concept-only pagination and overflow menus because the API currently returns a bounded 500-item planning window and editing is opened by the title.
- The toolbar omits a separate built-in date dropdown; the fixed natural week/month selector and advanced custom-field filter cover the v1 workflow with less chrome.
- Frappe Gantt owns the bar geometry and labels, so resize handles follow the library's hover behavior instead of remaining permanently visible.
- The authenticated user block remains in the rail footer; global search and help icons are not duplicated because work-plan search and protected OpenAPI are already available in-context.
