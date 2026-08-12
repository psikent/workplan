# Work Plan UI design baseline

The production UI follows the two generated concepts in this directory:

- `work-plan-primary.png`: primary list and Gantt command center.
- `work-plan-editor.png`: editing drawer and custom-field management state.

## Design system

- **Backgrounds**: true white application surface, cool `#f6f8fb` canvas, no cream tint or decorative gradients.
- **Text**: near-black navy `#13213c`, muted slate `#68758a`, PingFang SC/Inter/system sans-serif.
- **Accent**: saturated indigo-blue `#3157df`; green, amber, coral, and slate are reserved for status and priority.
- **Geometry**: crisp one-pixel borders, 6–10px control radii, very light shadows only for drawers and dialogs.
- **Container model**: left navigation rail plus one continuous table/timeline canvas. Avoid nested cards and bento grids.
- **Density**: 13–14px application chrome, 44–56px rows, 28px page title, compact toolbar controls.
- **Icons**: consistent 18px rounded-outline icons; labels remain visible in navigation and primary actions.

## Visible copy and states

Above the fold is limited to the product name, navigation labels, page title, search and filter labels, view switch, today control, and the primary “新建工作计划” action. The primary workflow is list/filter → select → edit in the right drawer, or drag/resize directly on the Gantt canvas.

Responsive behavior keeps the table and timeline horizontally scrollable on narrow screens; the navigation becomes a compact top rail and the editor drawer becomes a full-width sheet.
