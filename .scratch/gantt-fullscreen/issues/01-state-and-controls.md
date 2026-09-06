# 01 — 甘特图全屏状态与工具栏入口

Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src/pages/WorkPlansPage.tsx、必要时 apps/web/src/components/AppShell.tsx

## 背景

规格 R1、R3。现有 `WorkPlansPage` 管理 `.planner-panel`、页面级查询控件、多个设置浮层和 `WorkPlanDrawer`；需要增加一个只在当前页面会话存在的甘特图全屏状态，并让入口位于中央日期标题右侧。

## 改动清单

1. 增加全屏状态和进入/退出处理；按钮使用现有紧凑图标按钮体系，动态提供“进入全屏”/“退出全屏”的 `aria-label`、`title` 和状态图标。
2. 把入口放入现有中央日期标题布局，使标题视觉中心不因按钮改变；保留左右日期导航和右侧工具栏。
3. 进入时关闭导出、导入、筛选、排序、列设置和甘特条属性浮层，保留搜索/筛选/排序值、时间范围、游标、视图、折叠和显示偏好。
4. 监听并清理 `Esc`：没有打开 `WorkPlanDrawer` 时退出全屏；抽屉打开时让既有抽屉关闭逻辑先消费 `Esc`，不退出全屏。
5. 将全屏状态以页面/应用壳层可识别的状态传给布局层，使应用侧栏和页面级元素能按票据 02 隐藏；不得使用 `requestFullscreen` 或改动路由 URL。
6. 进入/退出不得触发 API 写入或查询条件重置；现有只读账户、甘特选择、提醒点击、排程拖动/拉伸和双击新建逻辑保持不变。

## 验收

- 工具栏中央日期标题右侧可见按钮，点击可进入/退出，全屏时标签和提示切换。
- 点击按钮、`Esc`、打开/关闭抽屉的优先级符合规格；刷新后重新挂载为普通布局。
- 进入全屏前的浮层关闭而查询值保持，传给 `GanttTimeline` 的业务 props 不变。
- 相关页面测试通过，且不引入 API、数据库或权限变更。

## Comments

- 2026-09-06 实现完成。全屏状态存于 `WorkPlansPage` 的 `ganttFullscreen`，经 effect 写 `html.gantt-fullscreen` 根类名供布局层（AppShell/页面级 CSS）识别；不使用原生 Fullscreen API、不改路由、不写 localStorage，卸载/刷新即复位。
- 按钮位于 `.table-toolbar-center`（中央日期标题右侧，绝对定位不占布局），lucide `Maximize`/`Minimize` 切换图标，`aria-label`/`title` 动态为“进入全屏”/“退出全屏”。
- Esc 分层：抽屉 > 面板内列设置/甘特条属性浮层 > 退出全屏；`event.repeat` 守卫防长按击穿。抽屉本身无既有 Esc 逻辑（勘察确认），故由页面处理器以与 `onClose` 相同语义关闭（共享 `closePlanDrawer`）。
- 进入全屏一次性关闭导出/导入/筛选/排序/列设置/甘特条属性六类浮层；查询值、时间范围、游标、视图、折叠与显示偏好不触碰。
- 审查修复（P0）：新增 `applyGanttFullscreen(next)` 作为切换唯一入口，按钮与 Esc 退出均写时间轴横向滚动快照，避免 Esc 退出路径丢失恢复时机。
