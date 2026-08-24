# 服务端模型、API 与任务关联（server）
Type: task
Status: resolved
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

## Comments

### 2026-08-22 实现摘要

- **迁移 #7**（migrate.ts）+ drizzle schema 的 `monthlyGoals` 表与两个索引（period / work_plan，SQL 与规格 R1 一致）。
- **MonthlyGoalService**（新模块 monthly-goals.ts）：list（year/month 过滤，缺省非归档，year desc, month desc, created_at asc；批量取关联计划避免 N+1）、get/create/update/delete（乐观锁 version；update 的 workPlanId 三态：缺省=不变 / uuid=改绑 / null=解绑）、setTaskLinks（整体替换 + 占用冲突 422「月目标「X」已关联其他工作任务」+ 已归档目标可引用）、getGoalIdsByWorkPlan / indexGoalIdsByWorkPlan / validateGoalIds。派生状态：无关联→null；manual→任务 status（含 cancelled）；automatic→deriveWorkPlanStatus。
- **路由**（新模块 routes/monthly-goals.ts）：GET 列表 / GET :id / POST（201）/ PATCH :id / DELETE :id?version=（204），无 admin 限制（编辑者可达）。
- **WorkPlanService 集成**：构造注入 MonthlyGoalService；serialize 增加 monthlyGoalIds（列表/搜索批量预取，get 单查）；createInternal/update 事务内维护关联（update 缺省不变、提供则整体替换）；周期 Occurrence 经 createInternal 自动继承模板 monthlyGoalIds。
- **TransferService v3**：version3BusinessTables 含 monthly_goals；deleteOrder 先删 monthly_goals；导出版本 3；导入兼容 v1/v2（旧文件导入后 monthly_goals 清空）；app.test.ts 断言改为接受 3（并补 monthly_goals 空数组断言、v1 载荷剥离 monthly_goals 键）。
- **契约补充**：updateMonthlyGoalSchema 增加 `archived: boolean.optional()`——票据 01 的 R2 未含此字段，但规格 R1/R5/R8 要求归档/恢复，故沿用 custom-fields 的 `archived` 模式补上（归档设 archivedAt，恢复置 NULL）。
- **踩坑记录**：fastify 的 AJV（coerceTypes + removeAdditional）会在 handler 前改写 request.query（"true"→boolean、未声明键被剥掉），导致「schema 传给 fastify + handler 内再用 zod parse 同一对象」的模式炸掉（ZodError→500）。月目标列表路由因此**不传 fastify querystring schema**，在 handler 内 safeParse 原始查询串（与 custom-fields 路由模式一致）。
- **验证**：临时冒烟脚本（已删）全绿：CRUD/归档/删除/409/占用 422/派生矩阵（automatic pending、manual cancelled、未关联 null）/任务侧替换与清空/编辑者 password+token 访问/导出 v3/v1 兼容；server 全量测试 60/60（migrate.test 两处 MAX(version) 断言 6→7）；pnpm -r typecheck 全绿。