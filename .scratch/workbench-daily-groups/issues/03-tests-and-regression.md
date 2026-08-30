# 03 — 测试与回归
Type: task
Status: resolved
Blocked by: 02
Spec: ../spec.md
Scope: apps/web/src/lib/working-days.test.ts、apps/web/src/pages/OverviewPage.test.tsx

## 背景

规格验收标准 1–7 的自动化覆盖。

## 改动清单

1. `working-days.test.ts`：周末跳过、窗口端点、节假日接缝参数。
2. `OverviewPage.test.tsx`：按新分组改写——今日新开工/今日继续开工/接下来的计划的成员与互斥、已完成排除、窗口外排除、空分组隐藏、全空整体空态；保留今日提醒既有用例；沿用夹具相对时间模式与显式 `unmount()` 约定。
3. 回归：`pnpm --filter @workplan/web test`、全仓 typecheck。

## 验收

- 上述测试全绿；规格验收标准 6（移动端标签）由票据 01 的 CSS 改动 + build 覆盖。

## Answer

- `apps/web/src/lib/working-days.test.ts`（5 用例）：周末排除、节假日接缝参数、周五跨周末计数、周一 7 工作日窗口端点。
- `apps/web/src/pages/OverviewPage.test.tsx` 改写为夹具工厂 + `dayAtOffset` 相对日期：今日新开工/今日继续开工/接下来的计划成员与互斥、7 工作日窗口内外、已完成/已取消排除、空分组隐藏、全空整体空态；今日提醒 4 个既有用例保留。
- 回归：`corepack pnpm --filter @workplan/web test` 245/245（17 文件）；根级 `pnpm typecheck` 通过（contracts/server/web，2026-08-30）。
