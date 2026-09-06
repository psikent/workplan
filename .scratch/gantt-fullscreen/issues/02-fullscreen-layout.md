# 02 — 甘特图全屏布局与响应式样式

Type: task
Status: awaiting-approval
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/components/AppShell.tsx、apps/web/src/styles.css、必要时 apps/web/src/pages/WorkPlansPage.tsx

## 背景

规格 R2、R4。应用侧栏和离线横幅位于 `AppShell`，工作计划页面有自己的内边距和页面级工具栏；`.planner-panel` 目前只填充普通页面剩余高度。全屏状态必须让面板占据应用窗口，并保持现有列表/时间轴滚动与抽屉层级。

## 改动清单

1. 为应用壳层、工作计划页和甘特面板增加全屏状态样式/挂载边界：隐藏应用侧栏、页面级标题与操作区域，去除全屏时多余的页面内边距，让 `.planner-panel` 填满 `app-main` 的可用区域。
2. 保留 `.planner-panel` 内的工作内容列表、分页、工具栏和时间轴；全屏时既有 `collapsed` 状态仍决定列表显示，用户仍可手动展开/折叠。
3. 保证桌面和约 390px 窄屏下没有页面级横向滚动；保留既有分栏最小宽度、列表/时间轴内部滚动、触控尺寸和抽屉 `z-index`/fixed 覆盖关系。
4. 在尺寸变化导致 Gantt 重建或重排时，保存并恢复列表 `scrollTop` 和时间轴 `scrollLeft`；不得破坏既有纵向同步、日期标记、悬停和拖拽交互。
5. 全屏退出后恢复普通页头、侧栏和内边距；不把全屏状态写入 localStorage，也不改变现有布局偏好（列表宽度、折叠、列和甘特属性）。

## 验收

- 浅色/深色、桌面/窄屏截图中甘特面板铺满应用窗口，页面级元素不占位，工具栏与中央按钮位置稳定。
- 列表展开和折叠、分隔线、分页、时间轴横向/纵向滚动及抽屉覆盖层可操作；全屏切换前后的滚动位置保持。
- 现有工作计划页样式测试、Web typecheck 和 build 通过。
