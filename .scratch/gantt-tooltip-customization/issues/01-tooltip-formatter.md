# 01 — Web: 甘特条提示内容格式化（formatGanttTooltip）
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: apps/web/src/components/GanttTimeline.tsx（新增格式化函数，可抽到 lib/gantt.ts）、WorkPlansPage.tsx（数据来源）

## 背景
规格 R2/R1。Frappe Gantt 默认 popup 显示英文日期（MMM D）、'day(s)'、'Progress: X%'，与全站中文 UI 不一致，且不可配置。popup 选项是返回 HTML 字符串的回调，可整体替换内容而不改库；工具提示定位由 configurePopupFollow 接管，不能替换 .popup-wrapper 元素本身（见 spec 背景事实）。

## 改动清单
1. 新增纯函数 formatGanttTooltip(plan, visibleIds, fieldDefinitions, options?)：返回提示 HTML 字符串
   - 标题行 + 中文日期范围：M月D日 - M月D日（跨年/跨月时补年份），补齐 startOfLocalDay/endOfLocalDay/toLocalDateString 等本地日期处理；
   - 选中属性按序渲染：status 用现有状态标签映射（StatusBadge/statusLabels），custom:key 用 formatCustomFieldValue 语义；值为 '—' 或空时整行省略；
   - 持续时间：进行中/已完成时显示 持续 N 天（含当天）；不在文字里输出英文月份、days、Progress。
2. 在 GanttTimeline 的 popup 回调（GanttTimeline.tsx:127 区域）中接入该函数，popup_on 保持 hover；不改 configurePopupFollow 的定位逻辑。
3. 默认选中为空（仅标题 + 日期范围），与甘特条属性 displayProperties 相互独立。

## 验收
- 中文日期/持续/进度文案正确；任意 locale 无英文残留。
- 选中属性渲染、'—' 省略、默认选中行为符合规格 R1/R2 与验收标准 1-2。
- 提示仍跟随鼠标，row hover 高亮不受影响（联动票据 03 回归用例）。
## Answer

已完成（本次会话实现）。

改动：
- `apps/web/src/components/GanttTimeline.tsx`
  - 新增并导出纯函数 `formatGanttTooltip(plan, properties)`：返回替换 `.popup-wrapper` 内 HTML 的字符串 —— 标题行 + 中文日期范围（同年同月 `M月D日 - M月D日`；跨月/跨年时两侧各自补年份 `YYYY年M月D日`）、按序渲染选中属性（status → `statusLabels`，custom:* → `formatCustomFieldValue` 语义，值为 "—" 或空时整行省略）、进行中/已完成计划追加 `持续 N 天`（含首尾两天）。标题与属性值均做 HTML 转义。
  - 组件新增 `tooltipProperties?: GanttDisplayProperty[]` prop，默认空数组（仅标题 + 日期），与甘特条属性 `displayProperties` 完全独立；popup 回调经 ref 读取最新选中，无需重建甘特。
  - Gantt 配置新增 `popup` 回调（返回 HTML 字符串，plan 缺失时返回 `false` 保持默认行为）；`popup_on` 保持 `"hover"`；`configurePopupFollow` 定位逻辑与 `.popup-wrapper` 元素本身均未改动。
- `apps/web/src/components/GanttTimeline.test.tsx`
  - 新增 `formatGanttTooltip` 单测：默认选中、状态/自定义字段渲染、"—" 整行省略、中文日期/持续文案、同年同月不带年份、跨月/跨年含年份、HTML 转义、可见文本无英文残留。
  - 新增接线用例：options.popup 为函数、`popup_on` 仍为 hover、按 plan 生成中文 HTML、未知 id 返回 false。
  - 既有用例零回归（`GanttTimeline.test.tsx` 与 `GanttTimeline.render.test.tsx` 全部保持绿色）。

验收核对：
- `corepack pnpm --filter @workplan/web typecheck` 通过。
- `corepack pnpm --filter @workplan/web test`：12 files / 101 tests 全部通过（含既有 hover-popup 与 configurePopupFollow 回归用例）。
- 提示内容回归净化：任何语言环境输出均不包含英文月份、"day(s)"、"Progress:"。

后续：02 可基于 `tooltipProperties` 接入 `workplan:gantt-tooltip:v1` 偏好读写与设置 UI；03 负责组件交互与回归增量测试。
