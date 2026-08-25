# 01 — 年度快速编辑契约与原子服务
Type: task
Status: ready-for-agent
Blocked by: none
Spec: ../spec.md
Scope: packages/contracts/src/index.ts、apps/server/src/modules/monthly-goals.ts、apps/server/src/routes/monthly-goals.ts、apps/server/test/monthly-goals.test.ts

## 背景

规格 R2–R6。现有年度 GET 已能返回某年全部 Monthly Goal，但写接口只能逐项更新，无法保证一次年度保存全有或全无。本票新增最小批量契约和事务服务，不修改数据库结构。

## 改动清单

1. 在共享 contracts 中新增并导出年度快速编辑请求/响应 schema 与类型：
   - 请求：`year`、完整 `baseline: { id, version }[]`、`rows: { originalTitle, title, activeMonths }[]`；
   - 响应：`createdCount`、`updatedCount`、保存后含归档项的年度 `goals`；
   - 校验 2000–2100 年、唯一 baseline ID、规范化名称、最终名称唯一、唯一 1–12 月份及新行至少一个月份。
2. 在 `MonthlyGoalService` 增加年度快速编辑方法，并将读取快照、基线比较、分组验证、更新、创建和结果读取放入一个 SQLite transaction。
3. 按 `title.trim()`、区分大小写聚合现有实例；请求必须覆盖每个现有组且不能伪造 `originalTitle`。
4. 以事务快照中捕获的实例 ID 执行变更：
   - 活跃变未勾选时归档全部活跃实例；
   - 未勾选变活跃时恢复全部归档实例，没有实例才创建一个普通目标；
   - 状态未变化时保留混合归档状态；
   - 重命名覆盖该年整个现有组；
   - 重命名与归档变化合并为一次实例更新和一次版本递增。
5. 新实例使用最终名称、空说明、无工作计划关联、无系列属性；已有实例的说明、月份、关联、`seriesId/occurrenceKey` 保持不变。
6. baseline 与事务内完整 `{id, version}` 集合顺序无关地精确比较；并发新增、删除、缺失或版本变化均抛出现有 `VERSION_CONFLICT` 并回滚。
7. 新增静态路由 `PUT /api/v1/monthly-goals/quick-edit`，置于 `/:id` 路由无歧义的位置；权限沿用普通月目标，不增加 admin 限制。
8. 扩展服务端集成测试，直接断言响应、数据库状态和失败后的零部分写入。

## 验收

- 请求/响应可以完整表达 spec R5，非法名称、月份、baseline 和新行被拒绝。
- 普通、归档、系列及同名同月多实例均按 spec R3 更新。
- 已有系列行新增月份只创建普通 Monthly Goal，不改变系列模板或规则。
- 其他年份、说明和 Goal-Plan Link 不受影响。
- 两行互换名称正确；每个既有实例每次保存最多递增一次版本。
- 版本变化、并发新增和并发删除返回 409，事务无部分修改。
- Administrator、Editor、Token-only Editor 均保持现有编辑权限。
- 以下命令通过：
  - `corepack pnpm --filter @workplan/contracts build`
  - `corepack pnpm --filter @workplan/server test -- monthly-goals.test.ts`
  - `corepack pnpm --filter @workplan/server typecheck`

## Comments

- 不新增独立年度行表、唯一索引、数据库迁移或删除 API。

