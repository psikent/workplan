# 领域术语与共享契约（domain + contracts）
Type: task
Status: ready-for-agent

## 背景
规格 R1/R2、术语表：月目标（Monthly Goal）、目标任务标签（Task-Goal Tag）、目标状态派生（Derived Goal Status）需要在 CONTEXT.md 建档；共享契约包先落地，供 02/03 使用。
## 改动清单
1. CONTEXT.md：在「Custom Field」词条后新增三个词条（含 Avoid 清单），沿用现有术语格式。
2. packages/contracts/src/index.ts：
   - 新增 monthlyGoalSchema / createMonthlyGoalSchema / updateMonthlyGoalSchema 及导出类型；
   - workPlanSchema 增加 monthlyGoalIds（数组默认 []）；workPlanValuesSchema 增加可选 monthlyGoalIds；
   - importPayloadSchema 的 schemaVersion 允许 3（配合 R7）。
3. 重新构建 contracts（pnpm --filter @workplan/contracts build），确认 dist 产物更新。
## 验收
- CONTEXT.md 词条与规格术语表一致，无冲突用语（避免：自由标签、手动目标状态、目标进度百分比）。
- 契约构建通过；WorkPlan 类型包含 monthlyGoalIds；新增 schema 的 strict 行为符合 R2。
- 不触碰服务端逻辑与 Web 页面（本票据只做地基）。