# 02 — Web：工作台"仅生产类"标注
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/OverviewPage.tsx

## 背景

规格 R5。工作台页头副标题在 `apps/web/src/pages/OverviewPage.tsx:55`（`今天需要关注的工作计划，一眼看清。`）。契约新增 `productionOnly`（票据 01）后，前端据实标注：过滤生效才说"仅生产类"，回退时不说，避免文案与实际口径不符。

## 改动清单

1. `OverviewPage`：页头副标题按 `data?.productionOnly` 切换——true 时显示 `仅展示生产类工作——今天需要关注的工作计划，一眼看清。`；false 或加载中保持现有文案。
2. 不加"查看全部"开关（已决策）；区块渲染、汇总条、今日提醒、空态均不动。

## 验收

- 对应规格 R5 与验收标准 2/4。
- 隔离实例浏览器验收（临时 DATA_DIR，勿动 `./data`）：有 `plan_nature` 字段且计划含非生产类/未填时，工作台不显示它们且副标题带"仅展示生产类工作"；归档"生产类"选项后刷新，回退全量且副标题恢复原文案。
- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿。
