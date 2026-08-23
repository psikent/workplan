# 01 — 领域术语与月份重叠基础
Type: task
Status: ready-for-agent
Blocked by: none
Spec: ../spec.md
Scope: CONTEXT.md、apps/web/src/lib/period.ts、apps/web/src/lib/period.test.ts

## 背景

规格 R1/R2。`CONTEXT.md` 已明确 Work Plan 是唯一用户可见工作项，但月目标关联仍使用 `Task-Goal Tag`，与领域语言冲突。月目标页和工作计划抽屉还需要共享同一套月份重叠判定，避免两侧规则漂移。

## 改动清单

1. 将 `CONTEXT.md` 的 `Task-Goal Tag` 更新为 `Goal-Plan Link`，保持既有关联基数说明并把 Task 相关叫法列入 Avoid。
2. 新增 `apps/web/src/lib/period.ts`，导出：
   - `rangeOverlapsMonth(startAt, endAt, year, month): boolean`；
   - 月份边界使用本地日历的 `[monthStart, nextMonthStart)`；
   - 工作计划使用 `[startAt, endAt)`；
   - 无效日期、非法年月或 `endAt <= startAt` 返回 `false`。
3. 新增 `period.test.ts`，覆盖同月、跨月、跨年、月初/月末相等边界、无效日期和反向范围。
4. 不在该辅助函数中引入 React、查询或组件状态逻辑。

## 验收

- `Goal-Plan Link` 成为当前领域文档的规范术语。
- 两侧 UI 可以直接复用 `rangeOverlapsMonth`，无需各自实现日期判断。
- 边界测试体现半开区间语义且不受运行时当前日期影响。
- `corepack pnpm --filter @workplan/web test -- period.test.ts` 和 Web typecheck 通过。

## Comments

- 需求访谈已确认使用“时间范围与月份有任何重叠”规则。
