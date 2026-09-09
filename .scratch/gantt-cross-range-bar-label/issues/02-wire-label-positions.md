# 02 — 接线三处标签定位 + 跨周/跨月渲染测试
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/components/GanttTimeline.tsx、apps/web/src/components/GanttTimeline.render.test.tsx、apps/web/src/components/GanttTimeline.test.tsx

## 背景

规格 R3/R4/R6,票据 01 的 `layoutBarLabel` 就位后接线。三处现状:`applyWholeDayBarGeometry`(`:807-808`,全跨度中点,无画布宽入参)、`keepGanttLabelsCentered`(`:664-691`,初始 + MutationObserver 强制全跨度居中/去 .big)、拖拽 `renderScheduleGeometry`(`:1054-1063`)。frappe `draw_label`/`update_label_position` 的 `.big` 逻辑继续被「后渲染同步 + 观察器」覆盖。渲染测试标签用例(`:628-674`、`:676-696`)全为范围内计划,跨周几何零覆盖。

## 改动清单

1. `applyWholeDayBarGeometry` 增画布宽入参(`dayCount × columnWidth`,调用点 `:244` 同步),label 段改走 `layoutBarLabel`,截断后同步 `label.textContent`(`text-anchor` 维持 middle、去 `.big`)。
2. `keepGanttLabelsCentered` 更名(如 `keepGanttLabelsPositioned`):初始 + MutationObserver 从「强制全跨度居中」改为「强制新规则」;截断后的 textContent 不被观察器回滚(frappe 全量重渲染会重建 wrapper,重新走整趟管线)。
3. 拖拽 `renderScheduleGeometry`:label 走同一函数(入参 nextX/nextWidth),拖拽期间实时跟随。
4. 测宽接入:SVGTextElement 的 `getComputedTextLength`(或 `getBBox().width`);非有限/0 → 退化仅锚定。jsdom 渲染测试因此聚焦几何断言,像素截断由 01 的注入 measure 单测覆盖。
5. 渲染测试(spec R6):跨 2 周计划结束周视图(x = 该周条段中点、∈ [0, 画布宽]、无 `.big`、`middle`);跨 3 周计划首/中/尾三个周视图;月视图跨月;贴左缘窄条钳入;范围内计划既有断言零回归(条段 = 全跨度,期望值不变);20 字截断回归;可复用既有拖拽测试模式则补拖拽跟随。

## 验收

- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿,既有用例零回归。
- 对应 spec 验收标准 1。
