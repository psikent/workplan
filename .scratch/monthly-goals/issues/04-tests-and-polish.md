# 测试、fixture 与文案核查（tests）
Type: task
Status: ready-for-agent
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