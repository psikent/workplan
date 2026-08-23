# 测试、fixture 与文案核查（tests）
Type: task
Status: resolved
Blocked by: 02, 03

## 背景
规格 R8/R9。补齐服务端与 Web 自动化测试，同步修正受 WorkPlan 新字段影响的既有 fixture，并核查全站文案。
## 改动清单
1. 新建 apps/server/test/monthly-goals.test.ts：CRUD/乐观锁/归档/删除、派生状态矩阵、任务侧关联替换与占用冲突、editor 两种认证方式权限、传输 v3 往返与 v1/v2 兼容、tags 键不随导出重现。
2. 新建 apps/web/src/pages/MonthlyGoalsPage.test.tsx：月份列表渲染与切换、新建/编辑/归档/恢复、关联/解绑任务、月度汇总文案。
3. 扩展 apps/web/src/components/WorkPlanDrawer.test.tsx：目标多选渲染与提交 payload 断言。
4. 修正 5 处 Work Plan fixture（WorkPlansPage.test.tsx、WorkPlanDrawer.test.tsx、GanttTimeline.test.tsx、GanttTimeline.render.test.tsx、OverviewPage.test.tsx）补 monthlyGoalIds: []。
5. 按 R9 文案清单核查并统一新增 UI 文案。
## 验收
- 新增用例全部通过；既有用例无回归。
- pnpm typecheck 与 pnpm test（contracts -> server -> web -> 脚本）全绿。
- 文案与全站现有中文风格一致（状态徽标、抽屉、toast、确认框）。
- 补充或更新 .scratch 内文档以反映实现后的差异（如有）。

## Comments

### 2026-08-22 实现摘要

- **apps/server/test/monthly-goals.test.ts**（新建，10 用例；复用 createContext 模式，fake timers 控制派生状态）：
  - CRUD 与乐观锁：POST/GET/PATCH/DELETE、stale version → 409 VERSION_CONFLICT、422「关联的工作计划不存在」；list 按 year/month 过滤、year desc/month desc/created_at asc 排序、非法查询参数 422「查询参数无效」。
  - 归档/恢复：archived=true 后默认列表隐藏、includeArchived=true 可见；恢复后回到默认列表；删除按 version 物理删除（错版 409、删后 404）。
  - 派生状态矩阵：无关联 → null；automatic 按时间推导 pending/in_progress/completed（fake clock 前移后「进行中」目标变 completed，证明是实时推导非落库快照）；manual 含 cancelled；创建后可改绑/解绑（workPlanId 三态）。
  - 任务侧：创建携带 + PATCH 整体替换/缺省不变/`[]` 清空；占用冲突 422「月目标「X」已关联其他工作任务」+ errors.monthlyGoalIds；未知 goalId 422；系列模板 monthlyGoalIds 继承到 occurrence（count=1 验证——多 occurrence 共享单关联目标会撞占用约束，属正确 422 而非缺陷）。
  - 权限：token editor（Bearer）与 password editor（登录 cookie + CSRF）均可对月目标增删改查，无 admin 限制。
  - 传输：导出 schemaVersion 3 且 data.monthly_goals 含数据、无 tags 键；v2（剥 monthly_goals）与 v1（再剥 owner_account_mappings）导入后 monthly_goals 清空且不报错。
- **apps/web/src/pages/MonthlyGoalsPage.test.tsx**（新建，8 用例）：列表渲染（行内关联计划标题+状态徽标、未关联、汇总「本月已完成 X / Y 个目标」只计非归档）、显示已归档开关、月份切换 refetch（含空态「这个月还没有配置月目标」）、新建（POST body 断言 workPlanId 关联）、编辑（PATCH body：保留现有关联 workPlanId、version）、归档/恢复/删除（confirm 文案断言「删除后该月目标将从所有任务标签中消失」）、关联任务选择器（已占用行 disabled + title「该工作计划已关联该目标」/解除关联）、乐观锁 409 → 表单「数据已被修改，请刷新后重试」且不出成功 toast。
- **WorkPlanDrawer.test.tsx 扩展**（+4 用例）：月目标多选渲染（标签「2026 年 8 月 · 目标标题」，按年/月/createdAt 排序）、被其他任务占用的目标 disabled + tooltip「该目标已关联其他工作任务」、勾选/取消后 **onSave payload 的 monthlyGoalIds 断言**、编辑已有计划回显已勾选、加载态「正在载入月目标…」。
- **WorkPlansPage.test.tsx 扩展**（+2 用例，回应票据 03 的交接点）：补齐 `/monthly-goals` 的 apiMock（原 throw，页面容错掩盖）；断言 PlanRow 目标标签 chips（文本 + href=/monthly-goals + title 完整标签）与传入抽屉的 monthlyGoals 数据。
- **fixture 核查**：5 处 Work Plan fixture 的 `monthlyGoalIds: []` 在 01/03 实现期已就位（grep 复核无遗漏）。**本票额外修复 OverviewPage.test.tsx 的既有日期腐化**：fixture 硬编码 2026-08-17~21（系统日期越过 8-21 后「upcoming」过滤必挂），改为相对 Date.now() 的未来区间，根除日期漂移。
- **R9 文案核查**：逐项吻合（标题/目标名称/所属月份/说明/状态/未关联/关联任务/解除关联/本月已完成 X / Y 个目标/新建、编辑月目标/归档、恢复/删除确认文案/空态/乐观锁提示）。唯一差异：R9 示例写「未开始」，实现沿用全站 statusLabels 的「待开始」（WorkPlan 状态词汇，状态徽标复用同一 StatusBadge），保持全局一致而非照抄示例。
- **验证**：server 70/70（含月度目标 10 用例，migrate 断言此前已在 02 更新）；web 144/144（OverviewPage 修复后全绿）；`pnpm typecheck` 全绿；根级 `pnpm test`（contracts -> server -> web -> 脚本）全绿。
- **遗留说明**：MonthlyGoalsPage 的 archive/delete 失败时经 `showSuccess` 显示错误信息（ToastProvider 仅提供成功 toast，与 CustomFieldsPage 静默处理相比已属更明确反馈；引入 error toast 变体超出本票范围，如需要可另开票据）。