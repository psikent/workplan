# 03 — 测试与回归（tooltip 内容 + 偏好 + 定位）
Type: task
Status: resolved
Blocked by: 02
Spec: ../spec.md
Scope: apps/web/src/components/GanttTimeline.test.tsx、GanttTimeline.render.test.tsx（新增用例）、WorkPlansPage.test.tsx（如有设置交互断言）

## 背景
规格 R5。既有 GanttTimeline 测试覆盖 hover popup 与 configurePopupFollow；新增内容不得破坏定位与高亮。

## 改动清单
1. 组件/单测（RTL）：
   - formatGanttTooltip：选中属性渲染、'—' 值省略、默认选中（仅标题+日期）、中文日期/持续/进度文案、跨年日期含年份；
   - 设置交互：勾选/排序/清空后偏好写入，坏数据回退默认；
   - 回归：提示跟随指针（configurePopupFollow）与行 hover 高亮保持；既有 hover-popup 用例保持 green。
2. 需要时以 vi.mock 拦截 localStorage 与日期时间，保持确定性。
3. 核查全站文案：甘特条浮动提示 / 持续 N 天 / M月D日 等与现有中文风格一致。

## 验收
- 新增用例覆盖规格验收标准 5；既有 GanttTimeline 用例零回归。
- pnpm --filter @workplan/web typecheck 与 test 全绿。

## Answer

已完成（本次会话实现）。依赖 01/02 均已 resolve，本票在既有测试基础上补齐交互与回归增量。

改动：
- `apps/web/src/components/GanttTimeline.test.tsx`
  - 新增 adapter 回归用例：`tooltipProperties` 变更后重渲染，popup 回调经 ref 读到最新选中（状态属性渲染进 HTML），且不重建甘特（renderCount 不变）——防止设置变化打断悬停定位。
  - 新增 `formatGanttTooltip` 单测：多属性按选中顺序渲染（状态 → 自定义字段 → 中文持续时间先后次序断言）。
- `apps/web/src/components/GanttTimeline.render.test.tsx`
  - 新增真实网格集成回归：带 `tooltipProperties`（状态 + 自定义字段）渲染后触发 Frappe Gantt 的 200ms mouseenter 悬停，等待 popup 内容出现并断言 `.popup-wrapper` 内为 `formatGanttTooltip` 的中文输出（标题、`8月5日 - 8月5日`、`进行中`、`冯铭倩`、`持续 1 天`，可见文本无拉丁字母残留）；随后移动指针断言 `configurePopupFollow` 定位仍生效（left/top 152/102px）——内容替换不破坏定位。
  - 新增 `localIso` 本地日期构造帮助函数，保证各时区下日期断言确定（与 GanttTimeline.test.tsx 一致）。
- 设置交互（勾选/排序/清空/坏数据回退）断言由票据 02 在 `WorkPlansPage.test.tsx` 的 6 个用例覆盖，本票核对无遗漏：默认空选中、`workplan:gantt-tooltip:v1` 读写、与甘特条属性双向独立、分区清空、版本不符回退。
- 全站文案核查：`甘特条浮动提示`（WorkPlansPage.tsx 甘特条属性 popover 分区）、`浮动提示 <属性>` 勾选框/排序按钮可访问名、`持续 N 天`（formatGanttTooltip）、`M月D日`/跨年 `YYYY年M月D日`（chineseDayLabel），与现有 popover 中文风格一致；任意语言环境输出无英文月份、day(s)、Progress。

验收核对：
- `corepack pnpm --filter @workplan/web typecheck` 通过。
- `corepack pnpm --filter @workplan/web test`：12 files / 109 tests 全部通过（较票据 02 收盘 106 例 +3）；既有 hover-popup（`.bar-wrapper` 跟随指针）、行 hover 高亮（`gantt-row-hovered`）、弹出定位用例零回归。
- 注：本会话 vitest 在受限沙箱下因 esbuild 以管道 stdio 拉起原生服务触发 spawn EPERM，测试需在完整权限模式运行（对仓库工程无影响，仅为运行环境限制）。