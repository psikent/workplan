# 01 — 甘特条标签支持“工作内容”内置属性与 20 字截断

**What:** 扩展 `GanttDisplayProperty` 联合类型（`apps/web/src/components/GanttTimeline.tsx`），新增 `{ id: "title"; label: string }` 内置属性变体；`formatGanttLabel` 解析该属性时取 `plan.title`，并按 spec D4 对该值截断（>20 字 → 前 20 字 + `…`，仅截此值，不影响其它属性值）。浮动提示 `formatGanttTooltip` 不改动。

**Why:** spec `.scratch/gantt-work-content-property/spec.md` R3/D1/D4。当前标签为 SVG 文本无截断，200 字标题会横向溢出。

**Tests:**
- `GanttTimeline.test.tsx`（`formatGanttLabel`）：≤20 字原样；>20 字（如 21 字）截断为前 20 字 + `…`；title 与 status/custom 属性按顺序 `" · "` 连接，custom 值不被截断。
- `GanttTimeline.render.test.tsx`：勾选 title 属性后条上标签显示截断文本。

**Blocked by:** None.

Status: resolved

- [x] `GanttDisplayProperty` 支持 `title` 内置属性，`formatGanttLabel` 按 D4 截断渲染（`truncateWorkContent`，按 Unicode 码点计字）；`GanttDisplayId` 改为由联合类型导出派生。
- [x] 新增 5 项测试通过（21 字截断、20 字边界、多属性连接仅截 title、条上渲染），既有甘特测试无回归；`formatGanttLabel`/`formatGanttTooltip` 值解析提取为 `ganttPropertyValue`（code-review 标准轴建议）。
