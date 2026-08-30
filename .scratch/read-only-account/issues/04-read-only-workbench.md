# 04 — Viewer 只读工作台
Type: task
Status: resolved
Blocked by: 01, 02
Spec: ../spec.md
Scope: apps/web/src/App.tsx、apps/web/src/components/AppShell.tsx、apps/web/src/pages/WorkPlansPage.tsx、apps/web/src/pages/MonthlyGoalsPage.tsx、WorkPlanDrawer/GanttTimeline 及相关测试

## 背景

规格 R2、R6、R7。Viewer 复用现有业务页面和查询能力，但所有会触发 mutation 的入口必须消失；前端负责清晰体验，服务端仍是最终权限边界。

## 改动清单

1. 从当前会话角色派生统一的 `canWrite`/只读状态，避免各页面分别猜测权限；Administrator 和 Editor 为可写，Viewer 为只读。
2. AppShell 对 Viewer 显示「只读账户」，继续隐藏 Custom Field、账户管理和设置导航；直接访问这些 URL 时沿用重定向到工作计划页的行为。
3. 在工作计划和月目标页面加入轻量只读提示，说明当前可查询和导出但不能修改。
4. Work Plans 页面保留列表、时间范围、搜索、筛选、分页、详情和全部业务导出；隐藏或移除所有调用新建、保存、删除、排序、日程更新和 Recurring Rule mutation 的入口。
5. WorkPlanDrawer 增加明确的只读呈现：字段和关联信息可查看，不显示保存、删除或修改系列操作，且不会在关闭或其他交互中隐式提交。
6. GanttTimeline 增加只读交互边界：保留选择、滚动和 tooltip；禁止空白处双击创建、条形拖动及宽度调整，不触发创建或日程变更回调。
7. Monthly Goals 页面保留月份切换、列表、筛选、详情和链接结果查看；隐藏新建、编辑、归档、删除、关联变更、Goal Recurrence 编辑/停止/解散等入口。
8. 不建立 Viewer 专用页面，不显示固定全局横幅；使用侧栏角色标签和业务页轻量提示。
9. 增加前端测试：Viewer 导航和提示、写控件缺失、抽屉只读、Gantt 不触发 mutation、Monthly Goal 无写入口、搜索与导出仍可用；Administrator/Editor 现有交互回归保持。

## 验收

- Viewer 可完整浏览、搜索、筛选和导出业务数据，并能打开只读详情。
- 页面不存在可触发业务写入的入口；模拟双击、拖动和详情交互不会调用 mutation API。
- Administrator 和 Editor 的既有可写工作台保持不变；相关 web 测试通过。

## Comments

## Answer

- 新增 `apps/web/src/lib/permissions.ts`：`canWriteBusinessData(role)` 统一派生可写状态（Administrator/Editor 可写、Viewer 只读）与 `roleLabel(role)`，各页面不再自行猜测。
- `App.tsx`：`User` 类型改用共享 `UserRole`/`LoginMode`；非管理员直接访问 `/custom-fields`、`/accounts`、`/settings` 仍重定向到工作计划页（行为不变）。
- `AppShell.tsx`：侧栏账户信息用 `roleLabel` 显示「管理员/编辑者/只读账户」；Viewer 导航仅保留工作台/工作计划/月目标（adminOnly 过滤不变）。
- `WorkPlansPage.tsx`：隐藏「新建工作计划」；新增轻量只读提示（`.read-only-hint`，非全局横幅）；GanttTimeline/WorkPlanDrawer 接收 `readOnly`；`onDuplicate`/`onDelete` 对 Viewer 不再传入；`handleScheduleChange`/`handleCreateAt`/`onSave` 内部再次判写（防御性）；列表、搜索、筛选、分页、详情与全部导出（JSON/模板 XLS/自定义 XLS）保留。
- `WorkPlanDrawer.tsx`：新增 `readOnly` 只读呈现——标题改为「工作计划详情」，字段/状态/时间/自定义字段以只读控件展示，计划周期只显示静态摘要，月目标复选框禁用，不渲染保存/删除/复制按钮；表单 onSubmit 恒先 `preventDefault`，只读时绝不调用保存，关闭/交互不会隐式提交。
- `GanttTimeline.tsx`：新增 `readOnly`；只读时不挂接拖拽/缩放（configureScheduleInteraction）、双击新建（configureDateCellCreation）与新建光标提示（configureDateCellAffordance）；选择（on_click）、浮动提示、提醒铃铛保留。
- `MonthlyGoalsPage.tsx`：隐藏快速编辑、新建月目标及每行的系列管理/关联/编辑/归档/删除入口；加入月目标只读提示；月份切换、显示已归档、列表与关联计划展示保留；空状态文案区分只读。
- 测试：WorkPlansPage 新增 viewer 用例（写入口缺失+提示+搜索/导出可用+readOnly 透传、抽屉只读且无 mutation 回调）；MonthlyGoalsPage 补 useSession mock 并新增 viewer 无写入口用例；GanttTimeline 测试 mock 支持注入最小甘特 DOM，新增「只读不触发创建/拖拽 mutation、选择仍可用」「可写时双击/拖拽仍触发回调」双向回归。全仓 web 测试 212/212、server 110/110，typecheck 与 build 全绿。
