# 03 — Web 甘特:颜色编码切换到备注 + 状态退出甘特视觉 + 图例
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/components/GanttTimeline.tsx、apps/web/src/components/GanttTimeline.test.tsx、apps/web/src/components/GanttTimeline.render.test.tsx、apps/web/src/pages/WorkPlansPage.tsx、apps/web/src/styles.css

## 背景

规格 R4/R5/R6,票据 01 落地后字段目录选项携带 `color`。现状:`GanttTimeline.tsx:158-161` 注入 `custom_class: gantt-${plan.status}`(单 token 约束,见处内注释),状态色规则 `styles.css:302-305`(变量浅 `:56-67`/暗 `:616-623`),默认条色 `--gantt-bar`(`:294-295`);进度按状态两处(`:157` 100/50/0、`:789` 1/0.5/0);冲突类 `gantt-conflict`(`:775` 切换,规则 `:307-308` 含 `.bar-progress` 着色);空占位条 `gantt-empty`(`:170`)。备注值经 `plan.customFields.remarks`(原始 `option_N`),字段目录 `WorkPlansPage.tsx:155` 已在手。注意 frappe-gantt 上条经验:custom_class 只接受单 token,upper_text 清空会崩(须保留标签 CSS 隐藏)。

## 改动清单

1. 颜色映射传入:`WorkPlansPage` 从字段目录构建备注选项 value→color 映射(含归档过滤后的图例数据),随既有 props 传入 `GanttTimeline`。
2. 条形着色(R4):后渲染同步(与冲突类同步同一趟)在 bar 元素上设 `style.setProperty("--gantt-bar-fill", color)`;样式 `.gantt-mount .bar { fill: var(--gantt-bar-fill, var(--gantt-bar)); }` 替换状态色规则;备注未设/归档选项值/字段缺失时不设该属性(回退 `--gantt-bar`)。遵守 custom_class 单 token 约束。
3. 状态退出(R5):
   - 删除 `custom_class: gantt-${plan.status}` 注入(空时间轴 `gantt-empty` 保留);删除 styles.css 浅/暗两套 `.gantt-pending/.gantt-in_progress/.gantt-completed/.gantt-cancelled` 条形与 `.bar-progress` 规则。
   - 两处按状态的 progress 赋值删除,恒 0(无暗条);冲突规则保留且特异性别高于默认条规则(覆盖任何备注色),去掉其对 `.bar-progress` 的着色。
   - 甘特可选显示属性「状态」文本保留不动(`WorkPlansPage.tsx:237` 注册、`GanttTimeline.tsx:455-461` 渲染)。
4. 图例(R6):甘特面板头部新增图例——按选项顺序列未归档备注选项(色点 + label)+ 末尾「未设置」灰点;备注字段不存在/已归档或无任何选项配色时整体不渲染。
5. 测试:
   - 更新既有 `custom_class === "gantt-pending"` 类断言:断言不再有状态类;条形 `--gantt-bar-fill` 随备注值设置/未设回退;归档选项值回退;冲突类仍切换且覆盖。
   - 图例:按选项顺序渲染 + 「未设点」;隐藏条件两态。
   - 既有甘特用例(含 render 测试)零回归。

## 验收

- 对应规格 R4/R5/R6 与验收标准 1 的甘特部分。
- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿。
- 隔离实例手工验收:配色→变色、空备注灰、归档值灰、冲突覆盖、暗色主题可读、无色图例隐藏(见 spec 验收标准 2)。

## Comments

### 2026-09-09 实施完成

- `GanttTimeline.tsx`:删除 `custom_class: gantt-${status}` 注入(保留空时间轴 `gantt-empty`);任务 progress 恒 0,`applyWholeDayBarGeometry` 里 `.bar-progress` 钳宽 0 并移除 animate;备注着色与冲突类同一趟后渲染——bar 元素设/移除内联 `--gantt-bar-fill`(映射只收已配色活动选项,未设/归档值/字段缺失不命中);`ganttInputSignature` 纳入 remarks 值(抽屉改备注即触发重建),remarksColorByValue 入 effect 依赖;新增 `remarksOptions` prop(`GanttRemarkOption[]`)。拖拽几何中随进度暗条一并移除的 progressRatio 死逻辑清理。
- `WorkPlansPage.tsx`:`remarksGanttOptions` memo(key=remarks 单选、活动选项按 sortOrder);图例渲染在 `.table-toolbar-center`(面板头部,避免破坏左列表头与甘特日期头的 46px 对齐);无色/字段缺失整体隐藏;remarksOptions 传入甘特。
- `styles.css`:删浅/暗两套状态条色规则、bar-progress 规则与 12 个 `--gantt-*` 状态变量;`.gantt-mount .bar { fill: var(--gantt-bar-fill, var(--gantt-bar)) !important }`——frappe 库样式 `.gantt .bar-wrapper .bar` 特异性 (0,3,0) 且 `--g-bar-color:#fff`,按 bar-label 既有先例用 !important 压制;冲突规则同为 important 且特异性更高保持覆盖(D5);增图例样式。
- 测试:`custom_class === "gantt-pending"` 断言改为不存在状态类;新增着色三用例(命中设色、未命中回退、冲突覆盖+进度 0);mock 增 `.bar-progress`;WorkPlansPage 新增图例 3 用例(顺序+未设置项+归档不列、无色隐藏、字段缺失隐藏+remarksOptions 透传)。web 325 用例全绿。
- 隔离实例手工验收(临时 DATA_DIR + 浏览器实测):5 计划含备注三色/无备注/负责人冲突——浅暗两主题截图核验(冲突琥珀覆盖备注蓝、无备注默认灰、图例按选项顺序+未设置项、无进度暗条、状态列徽章不变、甘特属性「状态」文本可勾选且生效、状态筛选器在位);PATCH 清空三选项色后图例整体消失、条形回默认,恢复后图例回归。
