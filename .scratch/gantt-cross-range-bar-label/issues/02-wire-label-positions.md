# 02 — 接线三处标签定位 + 跨周/跨月渲染测试
Type: task
Status: resolved
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

## Comments

### 2026-09-09 实施完成

- 三处定位统一走 `layoutBarLabel`：`applyWholeDayBarGeometry` 增 `canvasWidth` 入参（effect 内 `const canvasWidth = dayCount * columnWidth`，调用点同步）；`keepGanttLabelsCentered` 更名 `keepGanttLabelsPositioned(mount, canvasWidth)`，初始 + MutationObserver 从「强制全跨度居中」改为「强制新规则」（textContent 截断写入不被观察器回滚——观察器只盯 x/class/text-anchor 属性）；拖拽 `renderScheduleGeometry` 以 `nextX/nextWidth` 实时重算（`configureScheduleInteraction` options 增 `canvasWidth`）。`text-anchor` 维持 middle、去 `.big` 逻辑不变；`.date-range-highlight` 维持全跨度定位（R5）。
- 测宽接入为「逐字符串探针」`createBarLabelMeasurer(label)`：向同一 SVG 挂临时 `<text class="bar-label">`（`.gantt-mount` 后代，继承同一套字体样式）测长即删；探针不在任何 bar-group/bar-wrapper 内，frappe `group.querySelector(".bar-label")` 与本组件按容器作用域的查询都不会命中。jsdom 无 `getComputedTextLength` → 恒 0 走退化路径。
- 实施坑（记档）：首版把「元素测宽函数」直接当 `measureText(text)` 注入，layoutBarLabel 传给它的实参是字符串，jsdom 下全部退化、钳制用例假绿路径不可达；另排查中发现渲染测试环境存在与本规格无关的既有 frappe 未处理 rejection（构造期 `set_scroll_position` 的 `upperTexts.find` 落空，仅在缺少 `innerText` mock 的环境中复现，管线随之全灭但既有断言因与 frappe 初始定位巧合一致而照常通过）。两者均已排除，最终以「字符串探针测宽 + 完整 mock 环境」验收。
- 渲染测试 5 例（TDD 红灯先行）：跨 2 周结束周（x=150、无 .big、middle、条几何 x=−500/宽 800 不裁剪）；跨 3 周首/中/尾（450/350/150，rerender 后先等条几何切到新视图再断言，避免旧 DOM 竞态）；月视图跨月（画布 992、锚 48）；贴左缘窄条注入测宽（原型 defineProperty gCTL→300）验证钳到 150；拖拽拉宽条尾超画布时标签实时钳回 650（旧规则为 700）。`GanttTimeline.test.tsx` + `GanttTimeline.render.test.tsx` 95/95 绿；web 全量 337/337 绿 + typecheck 干净（验收标准 1）。
