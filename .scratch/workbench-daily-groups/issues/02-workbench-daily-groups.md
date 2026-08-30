# 02 — 工作台四分组实现
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/lib/working-days.ts、apps/web/src/pages/OverviewPage.tsx

## 背景

规格 R1/R2/R3/R5。OverviewPage 从「今日提醒 + 接下来的工作计划（前 6 条）」改为四个分组，纯前端派生。

## 改动清单

1. 新增 `apps/web/src/lib/working-days.ts`：`isWorkingDay` / `workingDaysAfter`（周一至周五、本地日粒度、节假日接缝常量空集，口径对齐服务端 reminders 模块）。
2. OverviewPage：删除 `upcoming` 前 6 条计算与区块；新增 今日新开工 / 今日继续开工 / 接下来的计划 三个派生分组（活跃计划过滤 + 本地日比较 + `compareWorkPlansBySchedule` 排序，无上限）。
3. 空分组不渲染；四个分组全空且加载完成时渲染整体空态。
4. 「今日提醒」区块与统计栏保持不变。

## 验收

- 规格验收标准 1–5；web typecheck 通过。

## Answer

- `apps/web/src/lib/working-days.ts`：`isWorkingDay` / `workingDaysAfter`（本地日粒度、节假日接缝常量空集）。
- `apps/web/src/pages/OverviewPage.tsx`：删除原 `upcoming` 前 6 条区块；新增 `planGroups`（今日新开工 / 今日继续开工 / 接下来的计划），统一「活跃计划过滤 + 本地日字典序比较 + `compareWorkPlansBySchedule` 排序、无上限」；空分组不渲染，四个分组全空且加载完成时渲染整体空态「今天没有需要关注的工作计划」；「今日提醒」区块与统计栏未动。
