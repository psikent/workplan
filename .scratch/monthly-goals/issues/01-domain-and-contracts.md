# 领域术语与共享契约（domain + contracts）
Type: task
Status: resolved

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

## Comments

### 2026-08-22 实现摘要

- **CONTEXT.md 词条**：三个词条（Monthly Goal / Task-Goal Tag / Derived Goal Status）已随规格在先前提交 6ee8d28 落地，位置（Custom Field 之后）与 Avoid 清单均符合规格术语表，本次仅核实无改动。
- **contracts 新增**（packages/contracts/src/index.ts）：
  - `monthlyGoalSchema`（响应 DTO，含派生 `status` 与 `linkedWorkPlan`）、`createMonthlyGoalSchema`（strict；description 默认 `""`、workPlanId 默认 `null`、year 2000–2100、month 1–12）、`updateMonthlyGoalSchema`（strict + `version` 乐观锁）；导出 `MonthlyGoal` / `CreateMonthlyGoal` / `UpdateMonthlyGoal` 类型。
  - `workPlanSchema` 增加 `monthlyGoalIds`（响应必含，默认 `[]`）；`workPlanValuesSchema` 增加 `monthlyGoalIds`（optional，**无 default**）。
  - `importPayloadSchema.schemaVersion` 允许 1 | 2 | 3。
- **关键决策（zod v4 语义）**：若 `workPlanValuesSchema` 用 `.default([])`，`updateWorkPlanSchema`（`partial()`）解析缺省键时会被填成 `[]`（zod v4 的 default 在 optional 内同样生效），破坏「更新缺省=保持不变」；故改为 `.optional()`，三态（缺省=不变 / uuid=改绑 / null=解绑）由 02 的 `input.monthlyGoalIds === undefined` 判定，create 缺省 `[]` 由 02 的 `?? []` 落地。同理 `updateMonthlyGoalSchema` 未用 `create.partial()` 而显式展开（否则 `workPlanId` 的 `default(null)` 会破坏三态）。
- **类型检查波及（已最小修复）**：`serialize`（apps/server/src/modules/work-plans.ts）补 `monthlyGoalIds: []`——当前无 monthly_goals 表、不可能存在关联，数据语义正确，02 接入真实查询；5 个 Web 测试 fixture 补 `monthlyGoalIds: []`（GanttTimeline.render / GanttTimeline / WorkPlanDrawer / OverviewPage / WorkPlansPage 的 test，与规格 R8 预告一致）。
- **验证**：contracts build 通过；schema 行为脚本全过（三态/默认/strict/响应解析/importPayload 3 允许、4 拒绝）；`pnpm -r typecheck` 全绿；server 测试 60/60；受影响 Web 测试 96/97（唯一失败为 OverviewPage「links an upcoming plan…」既有日期腐化——fixture 硬编码 2026-08-17~21 周，系统日期越过 8-21 后必挂，与本次无关）。