# 服务端模型、API 与任务关联（server）
Type: task
Status: ready-for-agent
Blocked by: 01

## 背景
规格 R1/R3/R4/R7。在服务端落地月目标表、派生状态、路由、WorkPlan 集成与导出/导入升级。
## 改动清单
1. apps/server/src/db/schema.ts：新增 monthlyGoals 表定义 + 索引。
2. apps/server/src/db/migrate.ts：迁移 #7（monthly_goals 建表，SQL 见规格 R1）。
3. apps/server/src/modules/monthly-goals.ts：MonthlyGoalService（list/get/create/update/delete/setTaskLinks/getGoalIdsByWorkPlan/validateGoalIds + 派生状态计算，尊重 statusMode 手动覆盖）。
4. apps/server/src/routes/monthly-goals.ts：注册 5 个 REST 路由（无 admin 限制）。
5. apps/server/src/modules/work-plans.ts：serialize 增加 monthlyGoalIds；createInternal/update 事务内维护关联；批量预取避免 N+1；duplicateWorkPlanInput 保留关联。
6. apps/server/src/app.ts：装配 MonthlyGoalService，注入 WorkPlanService，注册路由。
7. apps/server/src/modules/transfer.ts：schemaVersion 升级到 3，business tables 增加 monthly_goals，deleteOrder 先删 monthly_goals；保留 v1/v2 兼容。
8. 更新 apps/server/test/app.test.ts:855 的 schemaVersion 断言（接受 3）；「removes tag...」用例保持 green。
## 验收
- 月目标 CRUD/归档/删除、乐观锁冲突返回 VERSION_CONFLICT。
- 任务创建/更新可整体替换 monthlyGoalIds；目标占用冲突返回 422 且信息明确。
- 派生状态随关联任务状态与时间变化（automatic/manual/cancelled/未关联）正确。
- 编辑者（token 与 password）可访问全部月目标路由；管理员无额外限制。
- 导出 schemaVersion 3 含 monthly_goals；导入 v1/v2 文件不报错。