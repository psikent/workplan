# 04 — 浮动提示属性值加属性名前缀
Type: task
Status: resolved
Blocked by: 03
Spec: ../spec.md
Scope: apps/web/src/components/GanttTimeline.tsx（formatGanttTooltip）、apps/web/src/components/GanttTimeline.test.tsx、apps/web/src/components/GanttTimeline.render.test.tsx

## 背景
悬停提示中选中属性只渲染值本身，布尔/短文本类自定义字段（如 是否需要开票 = 是）含义模糊；需求为每行加属性名前缀，`是` → `是否需要开票：是`，状态等内置属性同理（`状态：待开始`）。

## 改动清单
1. formatGanttTooltip：选中属性行由纯值改为 `${label}：${value}`（全角冒号），label 与 value 均 HTML 转义；"—"或空值整行省略逻辑不变。
2. 单测与集成回归断言更新为前缀格式，并新增 label 转义用例。

## 验收
- popup 中每个选中属性形如 `属性名：值`（如 状态：进行中、工作负责人：lxj）；无属性名孤值。
- pnpm --filter @workplan/web typecheck 与 test 全绿；既有用例零回归。

## Answer

已完成（本次会话实现）。

改动：
- `apps/web/src/components/GanttTimeline.tsx`（formatGanttTooltip：354-360）
  - 属性行渲染由 `escapeHtml(value)` 改为 `${escapeHtml(property.label)}：${escapeHtml(value)}`（全角冒号）；状态（`状态：待开始`）与自定义字段（`负责人：lxj`、`是否需要开票：是`）统一生效；"—"/空值整行省略不变。
- `apps/web/src/components/GanttTimeline.test.tsx`
  - 状态用例断言收紧为 `状态：待开始`；自定义字段用例断言 `工作负责人：lxj`；排序用例断言 `状态：进行中` 先于 `工作负责人：冯铭倩` 先于 `持续 3 天`；新增 label HTML 转义用例（`&lt;b&gt;负责人&lt;/b&gt;：lxj`）。
- `apps/web/src/components/GanttTimeline.render.test.tsx`
  - hover 集成回归断言更新为 `状态：进行中`、`负责人：冯铭倩`，定位跟随断言不变。

验收核对：
- `corepack pnpm --filter @workplan/web typecheck` 通过。
- `corepack pnpm --filter @workplan/web test`：110 tests 全部通过（含既有 hover-popup、configurePopupFollow、行 hover 高亮用例零回归）。
- 规格 R1/验收标准 1 已同步补充 `<属性名>：<值>` 前缀规则。