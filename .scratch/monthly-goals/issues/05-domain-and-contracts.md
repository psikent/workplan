# 重复周期契约与领域术语（domain + contracts）
Type: task
Status: resolved

## 背景
规格 R10。新增 Goal Recurrence 词条到 CONTEXT.md；契约包落地 monthlyGoalSeries schema 与 monthlyGoalSchema 扩展；transfer 契约 schemaVersion 允许 4。
## 改动清单
1. CONTEXT.md：在 Derived Goal Status 词条后新增 Goal Recurrence 词条（含 Avoid 清单）。
2. packages/contracts/src/index.ts：
   - 新增 monthlyGoalSeriesSchema / createMonthlyGoalSeriesSchema / updateMonthlyGoalSeriesSchema 及导出类型（MonthlyGoalSeries / CreateMonthlyGoalSeries / UpdateMonthlyGoalSeries / Period）。
   - monthlyGoalSchema 增加 seriesId（uuid 可空）与 occurrenceKey（string 可空）。
   - importPayloadSchema 的 schemaVersion 允许 1 | 2 | 3 | 4。
3. 重新构建 contracts 并确认 dist 产物更新。
## 验收
- CONTEXT.md 词条与规格术语表一致（避免：模板生成任务等冲突用语）。
- 契约构建通过；create 的 superRefine 校验（至少一个结束条件、until ≥ startPeriod）行为正确。
- 不触碰服务端逻辑与 Web 页面（本票据只做地基）。

## Comments

### 2026-08-22 实现摘要

- **CONTEXT.md**：Derived Goal Status 之后新增 **Goal Recurrence** 词条（模板+周期规则、立即生成独立实例、停止仅停生成；Avoid：Goal template / auto-generated task）。
- **contracts 新增**（packages/contracts/src/index.ts）：
  - `monthlyGoalSeriesFrequencies = ["monthly","quarterly","yearly"]` 与 `monthlyGoalSeriesFrequencySchema`、`monthlyGoalPeriodSchema`（year 2000-2100 / month 1-12）。
  - `monthlyGoalSeriesSchema`（响应：template / frequency / interval / startPeriod / occurrenceCount / untilPeriod / active / version / instanceCount / created/updatedAt）；`monthlyGoalSeriesInstanceSchema`（id/title/year/month/archivedAt）；`monthlyGoalSeriesDetailSchema`（series + instances）。
  - `createMonthlyGoalSeriesSchema`（strict；interval 1..12 default 1；occurrenceCount 1..600 可空；untilPeriod 可空；superRefine：至少一个结束条件、until ≥ startPeriod）。
  - `updateMonthlyGoalSeriesSchema`（各字段 optional + version；提供替换、缺省不变；更新后在服务端合并校验「至少一个结束条件」）。
  - `monthlyGoalSchema` 增加 `seriesId` / `occurrenceKey`；`importPayloadSchema.schemaVersion` 允许 1-4。
  - 导出类型：MonthlyGoalSeriesFrequency、MonthlyGoalPeriod、MonthlyGoalSeries、MonthlyGoalSeriesInstance、MonthlyGoalSeriesDetail、Create/UpdateMonthlyGoalSeries。
- **波及**：3 处 Web 测试 fixture 补 `seriesId: null / occurrenceKey: null`（MonthlyGoalsPage、WorkPlanDrawer、WorkPlansPage 的 MonthlyGoal fixture）——保证 typecheck 持续绿。
- **验证**：contracts build 通过；`pnpm -r typecheck` 全绿（服务端 serialize 在 06 同步接入新字段）。
