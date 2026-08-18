# 02 — Web: 工具提示属性选择与持久化
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/WorkPlansPage.tsx（甘特条属性 popover 扩展）、apps/web/src/components/GanttTimeline.tsx（接收 tooltipVisibleIds）

## 背景
规格 R3/R4。工具提示所选属性必须与甘特条属性相互独立；偏好沿用全站版本化 localStorage 模式（theme/sidebar/gantt 均为 workplan:*:v1 + 防御式解析）。

## 改动清单
1. 新增偏好读写：键 workplan:gantt-tooltip:v1，形状 { version: 1, visibleIds: GanttDisplayId[] }；解析失败或版本不符退回默认（空选中），与 WorkPlansPage.tsx:61-72 的防御式解析一致。
2. UI：在现有 甘特条属性（GanttPropertySettings）popover 中增加「浮动提示」分区，或新增同级 popover，两种角色（Editor/Administrator）都可达；可多选 status 与 custom:key，支持排序/清空，交互与列设置一致。
3. 将 tooltipVisibleIds 传入 GanttTimeline，作为 01 的 formatGanttTooltip 输入；与 displayProperties 状态完全分离。
4. 通知既有 preference 持久化的失败降级（存储不可用时当次会话仍可用）。

## 验收
- 修改工具提示选择不影响甘特条属性，反之亦然（独立状态）。
- localStorage 读写正确、版本校验通过、坏数据回退默认且甘特图正常渲染。
- 两种角色都能在工具栏完成设置；文案与现有 popover 一致（甘特条浮动提示 / 清空 / 恢复默认）。
## Answer

已完成（本次会话实现），票据 02 的收盘依赖 01 已 resolve。

改动：
- `apps/web/src/pages/WorkPlansPage.tsx`
  - 新增偏好读写：键 `workplan:gantt-tooltip:v1`，形状 `{ version: 1, visibleIds: GanttDisplayId[] }`，`loadTooltipPreferences()` 与既有 `loadGanttPreferences()` 同款防御式解析（版本 != 1、非数组、非法 id、JSON 异常均回退默认空选中），并去重。
  - 新增独立状态 `tooltipDisplayIds`、持久化 effect（try/catch，存储不可用时当次会话仍可用）、`toggleTooltipProperty`/`moveTooltipProperty` 动作与 `visibleTooltipProperties` memo；与 `ganttDisplayIds`/`displayProperties` 完全分离。
  - 甘特条属性 popover（`GanttPropertySettings`）内新增「甘特条浮动提示」分区：独立标题、独立「清空」按钮、与列设置一致的勾选（多选）/上移/下移交互；勾选框/排序按钮使用独立可访问名（`浮动提示 …`、`上移/下移浮动提示 …`）避免与甘特条属性分区冲突。
  - `<GanttTimeline>` 新增 `tooltipProperties={visibleTooltipProperties}` 传入，作为 01 的 `formatGanttTooltip` 输入；默认空选中（仅标题 + 中文日期）。
- `apps/web/src/styles.css`
  - 新增 `.gantt-popover-section` / `.gantt-popover-section-head` 样式，与现有 popover 视觉一致。
- `apps/web/src/pages/WorkPlansPage.test.tsx`
  - 新增 5 个用例：默认空选中且不影响甘特条属性、勾选持久化到 `workplan:gantt-tooltip:v1` 且跨渲染恢复、甘特条属性改动不影响浮动提示（双向独立）、排序持久化、分区「清空」只清浮动提示、坏数据（版本不符）回退默认且甘特图正常渲染。

验收核对：
- `corepack pnpm --filter @workplan/web typecheck` 通过。
- `corepack pnpm --filter @workplan/web test`：12 files / 106 tests 全部通过（WorkPlansPage 23 例含新增 5 例；GanttTimeline 与 render 用例零回归）。
- 两种角色（Editor/Administrator）均可达同一工具栏 甘特条属性 popover；文案 甘特条浮动提示 / 清空 与现有 popover 一致。

后续：03 负责组件交互与回归增量测试（popup 跟随指针、行 hover 高亮、hover-popup 既有用例）。
